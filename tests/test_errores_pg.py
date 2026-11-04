"""Manejadores globales de errores de BD y CORS, con errores reales de PostgreSQL local."""
import asyncio
import json
import uuid
from decimal import Decimal as D

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from psycopg2 import errors as pg_errors
from psycopg2 import OperationalError as PgOperationalError
from sqlalchemy.exc import DataError, DBAPIError, IntegrityError, InternalError, OperationalError

load_dotenv()

from app.core.database import SessionLocal  # noqa: E402
from app.main import MENSAJE_CONFLICTO_CONCURRENCIA, app, error_de_base_de_datos, error_operacional  # noqa: E402
from app.models import Categoria, LoteStock, Producto, Usuario  # noqa: E402


def provocar(db, *objetos) -> DBAPIError:
    db.add_all(objetos)
    with pytest.raises(DBAPIError) as info:
        db.flush()
    db.rollback()
    return info.value


def traducir(exc):
    r = asyncio.run(error_de_base_de_datos(None, exc))
    return r.status_code, json.loads(r.body)


@pytest.fixture
def producto():
    tag = uuid.uuid4().hex[:8]
    with SessionLocal() as db, db.begin():
        cat = db.scalar(select(Categoria).limit(1)) or Categoria(nombre=f"TEST_PG_cat_{tag}")
        db.add(cat)
        db.flush()
        p = Producto(categoria_id=cat.id, nombre=f"TEST_PG_{tag}", precio_venta=D("1"),
                     requiere_caducidad=True)
        db.add(p)
        db.flush()
        pid = p.id
    yield pid
    with SessionLocal() as db, db.begin():
        db.execute(text("DELETE FROM productos WHERE id = :p"), {"p": pid})


def test_trigger_raise_exception_llega_como_409_con_su_mensaje(producto):
    with SessionLocal() as db:
        exc = provocar(db, LoteStock(producto_id=producto, codigo_lote="X",
                                     costo_unitario=D("1"), cantidad_disponible=D("1")))
    status, body = traducir(exc)
    assert status == 409
    assert body == {"detail": f"El producto {producto} requiere obligatoriamente una fecha de caducidad."}


def test_unique_violation_409_sin_filtrar_valores():
    tag = uuid.uuid4().hex[:8]
    with SessionLocal() as db, db.begin():
        db.add(Usuario(nombre="TEST_PG", usuario=f"dup_{tag}", password_hash="secreto", rol="Cajero"))
    try:
        with SessionLocal() as db:
            exc = provocar(db, Usuario(nombre="TEST_PG", usuario=f"dup_{tag}", password_hash="x", rol="Cajero"))
        status, body = traducir(exc)
        assert status == 409
        assert "Ya existe" in body["detail"] and "usuarios_usuario_key" in body["detail"]
        assert tag not in body["detail"]
    finally:
        with SessionLocal() as db, db.begin():
            db.execute(text("DELETE FROM usuarios WHERE usuario = :u"), {"u": f"dup_{tag}"})


def test_check_violation_409(producto):
    with SessionLocal() as db:
        exc = provocar(db, LoteStock(producto_id=producto, codigo_lote="X", costo_unitario=D("1"),
                                     cantidad_disponible=D("-1"), fecha_caducidad="2099-01-01"))
    status, body = traducir(exc)
    assert status == 409 and "chk_lotes_stock_cantidad_positiva" in body["detail"]


def test_data_error_400():
    with SessionLocal() as db:
        exc = provocar(db, Producto(categoria_id=1, nombre="x", precio_venta=D("1e12")))
    assert type(exc).__name__ == "DataError"
    assert traducir(exc) == (400, {"detail": "Dato con formato o rango inválido"})


def traducir_operacional(exc):
    r = asyncio.run(error_operacional(None, exc))
    return r.status_code, json.loads(r.body)


def test_lock_not_available_real_llega_como_409(producto):
    """Conflicto real de PostgreSQL: SELECT ... FOR UPDATE NOWAIT sobre una fila bloqueada (55P03)."""
    with SessionLocal() as retiene, SessionLocal() as espera:
        retiene.execute(text("SELECT 1 FROM productos WHERE id = :p FOR UPDATE"), {"p": producto})
        with pytest.raises(OperationalError) as info:
            espera.execute(text("SELECT 1 FROM productos WHERE id = :p FOR UPDATE NOWAIT"), {"p": producto})
        espera.rollback()
        retiene.rollback()
    assert info.value.orig.pgcode == "55P03"
    assert traducir_operacional(info.value) == (409, {"detail": MENSAJE_CONFLICTO_CONCURRENCIA})
    assert MENSAJE_CONFLICTO_CONCURRENCIA == (
        "Conflicto de concurrencia: el recurso está bloqueado por otra transacción. Por favor, intenta de nuevo."
    )


def test_deadlock_detectado_llega_como_409():
    por_clase = OperationalError("SELECT 1", {}, pg_errors.DeadlockDetected("deadlock detected"))
    assert traducir_operacional(por_clase) == (409, {"detail": MENSAJE_CONFLICTO_CONCURRENCIA})
    por_clase = OperationalError("SELECT 1", {}, pg_errors.LockNotAvailable("lock not available"))
    assert traducir_operacional(por_clase) == (409, {"detail": MENSAJE_CONFLICTO_CONCURRENCIA})


def test_operational_error_de_conexion_503_sin_filtrar_detalles(caplog):
    orig = PgOperationalError("could not connect to server at 10.1.2.3 user=postgres password=ultrasecreto")
    exc = OperationalError("SELECT secreto FROM tabla_interna", {"clave": "ultrasecreto"}, orig)
    with caplog.at_level("ERROR"):
        status, body = traducir_operacional(exc)
    assert status == 503
    cuerpo = json.dumps(body)
    for secreto in ("10.1.2.3", "postgres", "ultrasecreto", "tabla_interna"):
        assert secreto not in cuerpo
    registrado = " ".join(r.getMessage() for r in caplog.records)
    assert "OperationalError" in registrado
    for secreto in ("10.1.2.3", "ultrasecreto", "tabla_interna"):
        assert secreto not in registrado


def test_handlers_de_bd_conviven_sin_pisarse():
    manejadores = app.exception_handlers
    assert manejadores[OperationalError] is error_operacional
    for clase in (IntegrityError, DataError, InternalError):
        assert manejadores[clase] is error_de_base_de_datos
    # Sin relacion de herencia entre OperationalError y las clases del otro handler
    assert not issubclass(OperationalError, (IntegrityError, DataError, InternalError))
    assert not issubclass(IntegrityError, OperationalError)


def test_cors_permite_origen_de_vite_con_credenciales():
    client = TestClient(app)
    r = client.options(
        "/ventas",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert r.headers["access-control-allow-credentials"] == "true"
    assert "authorization" in r.headers["access-control-allow-headers"].lower()

    ajeno = client.options(
        "/ventas",
        headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in ajeno.headers


def test_rutas_huerfanas_y_prefijo_api_ya_no_existen():
    paths = app.openapi()["paths"]
    assert "/devoluciones" not in paths
    assert "/inventario/movimientos" not in paths
    assert "post" in paths["/ventas/{venta_id}/devoluciones"]  # la ruta que sí usa el frontend
    assert "get" in paths["/ventas/{venta_id}"] and "get" in paths["/compras/{compra_id}"]  # los usa ComprobanteModal
    assert not [p for p in paths if p.startswith("/api")]
    # Cada router se monta una sola vez
    montados = [r for r in app.routes if type(r).__name__ == "_IncludedRouter"]
    assert len(montados) == 11
