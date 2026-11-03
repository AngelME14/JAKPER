"""HTTP (TestClient) sobre el PostgreSQL local real: control de acceso y kardex.

Autenticación real: se firman JWT con create_access_token y se envían como Bearer.
Cada prueba crea sus propios datos (prefijo TEST_PG_) y los borra al terminar.
"""
import re
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal as D

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import make_url, select, text

load_dotenv()

from app.core.database import SessionLocal, engine  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    Categoria,
    Cliente,
    DetalleVenta,
    LoteStock,
    MovimientoInventario,
    Producto,
    Proveedor,
    Usuario,
)
from app.schemas.compras import CompraCreate  # noqa: E402
from app.schemas.inventario import MermaCreate  # noqa: E402
from app.schemas.ventas import DevolucionCreate, VentaCreate  # noqa: E402
from app.services.compras_service import registrar_compra  # noqa: E402
from app.services.mermas_service import registrar_merma  # noqa: E402
from app.services.ventas_service import crear_venta, registrar_devolucion  # noqa: E402

client = TestClient(app)


@pytest.fixture(scope="session", autouse=True)
def _solo_postgres_local():
    url = make_url(str(engine.url))
    assert url.get_backend_name() == "postgresql", "DATABASE_URL debe ser PostgreSQL"
    assert url.host in (None, "localhost", "127.0.0.1", "::1"), (
        f"Las pruebas solo corren contra PostgreSQL local, no {url.host}"
    )


class Datos:
    def __init__(self):
        self.tag = uuid.uuid4().hex[:8]
        with SessionLocal() as db, db.begin():
            cat = db.scalar(select(Categoria).limit(1))
            if cat is None:
                cat = Categoria(nombre=f"TEST_PG_cat_{self.tag}")
                db.add(cat)
                db.flush()
                self.categoria_propia = cat.id
            else:
                self.categoria_propia = None
            prov = Proveedor(razon_social=f"TEST_PG_prov_{self.tag}")
            cli = Cliente(nombre=f"TEST_PG_cli_{self.tag}")
            cajero = Usuario(nombre="TEST_PG cajero", usuario=f"test_pg_c_{self.tag}",
                             password_hash="x", rol="Cajero")
            encargado = Usuario(nombre="TEST_PG encargado", usuario=f"test_pg_e_{self.tag}",
                                password_hash="x", rol="Encargado")
            db.add_all([prov, cli, cajero, encargado])
            db.flush()
            self.categoria_id = cat.id
            self.proveedor_id = prov.id
            self.cliente_id = cli.id
            self.cajero_id, self.encargado_id = cajero.id, encargado.id
        self.producto_ids: list[int] = []

    def headers(self, usuario_id: int) -> dict[str, str]:
        return {"Authorization": f"Bearer {create_access_token(usuario_id)}"}

    def producto(self, *, stock_minimo="0", caducidad=False, decimales=True, nombre=None, sku=None) -> int:
        with SessionLocal() as db, db.begin():
            p = Producto(
                categoria_id=self.categoria_id,
                nombre=nombre or f"TEST_PG_prod_{self.tag}_{len(self.producto_ids)}",
                codigo_barras_sku=sku,
                precio_venta=D("10.00"), stock_minimo=D(stock_minimo),
                requiere_caducidad=caducidad, permite_decimales=decimales,
            )
            db.add(p)
            db.flush()
            self.producto_ids.append(p.id)
            return p.id

    def comprar(self, pid: int, lotes: int, cantidad="2.500", factura: str | None = None):
        """Una compra con `lotes` renglones -> `lotes` movimientos ENTRADA_COMPRA."""
        items = [
            dict(producto_id=pid, codigo_lote=f"L{i}", cantidad=cantidad, costo_unitario="4.25")
            for i in range(lotes)
        ]
        factura_compra = factura or f"F-{self.tag}-{uuid.uuid4().hex[:6].upper()}"
        with SessionLocal() as db:
            return registrar_compra(
                db,
                CompraCreate(factura_proveedor=factura_compra, proveedor_id=self.proveedor_id, items=items),
                self.encargado_id,
            )

    def limpiar(self):
        p = {"p": self.producto_ids, "u": [self.cajero_id, self.encargado_id]}
        with SessionLocal() as db, db.begin():
            db.execute(text("DELETE FROM movimientos_inventario WHERE producto_id = ANY(:p)"), p)
            db.execute(text("DELETE FROM devoluciones WHERE venta_id IN (SELECT id FROM ventas WHERE usuario_id = ANY(:u))"), p)
            db.execute(text("DELETE FROM pagos WHERE venta_id IN (SELECT id FROM ventas WHERE usuario_id = ANY(:u))"), p)
            db.execute(text("DELETE FROM detalle_ventas WHERE producto_id = ANY(:p)"), p)
            db.execute(text("DELETE FROM ventas WHERE usuario_id = ANY(:u)"), p)
            db.execute(text("DELETE FROM mermas WHERE producto_id = ANY(:p)"), p)
            db.execute(text("DELETE FROM detalle_compras WHERE producto_id = ANY(:p)"), p)
            db.execute(text("DELETE FROM compras WHERE usuario_id = ANY(:u)"), p)
            db.execute(text("DELETE FROM lotes_stock WHERE producto_id = ANY(:p)"), p)
            db.execute(text("DELETE FROM productos WHERE id = ANY(:p)"), p)
            db.execute(text("DELETE FROM proveedores WHERE id = :v"), {"v": self.proveedor_id})
            db.execute(text("DELETE FROM clientes WHERE id = :c"), {"c": self.cliente_id})
            db.execute(text("DELETE FROM usuarios WHERE id = ANY(:u)"), p)
            if self.categoria_propia:
                db.execute(text("DELETE FROM categorias WHERE id = :c"), {"c": self.categoria_propia})


@pytest.fixture
def datos():
    d = Datos()
    try:
        yield d
    finally:
        d.limpiar()


# ------------------------------------------------------------ control de acceso

def test_dashboard_cajero_recibe_403(datos):
    r = client.get("/dashboard/alertas", headers=datos.headers(datos.cajero_id))
    assert r.status_code == 403
    assert r.json()["detail"] == "Permisos insuficientes"


def test_dashboard_sin_token_recibe_401():
    assert client.get("/dashboard/alertas").status_code == 401


def test_dashboard_resumen_permisos_y_forma(datos):
    assert client.get("/dashboard/resumen").status_code == 401
    assert client.get("/dashboard/resumen", headers=datos.headers(datos.cajero_id)).status_code == 403
    r = client.get("/dashboard/resumen", headers=datos.headers(datos.encargado_id))
    assert r.status_code == 200
    body = r.json()
    assert len(body["ventas_ultimos_7_dias"]) == 7
    assert body["ventas_ultimos_7_dias"][-1]["fecha"] == date.today().isoformat()
    assert D(body["stock_total"]) >= 0 and body["productos_activos"] >= 0


def test_dashboard_encargado_ok_y_excluye_stock_minimo_cero(datos):
    con_minimo = datos.producto(stock_minimo="5")
    sin_minimo = datos.producto(stock_minimo="0")  # sin lotes, 0 existencias
    r = client.get("/dashboard/alertas", headers=datos.headers(datos.encargado_id))
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"stock_critico", "lotes_por_caducar", "mermas_mes_actual"}
    criticos = {x["producto_id"] for x in body["stock_critico"]}
    assert con_minimo in criticos
    assert sin_minimo not in criticos
    D(body["mermas_mes_actual"])  # serializa como número/cadena decimal válido


def test_dashboard_lote_por_caducar_y_stock_critico_con_existencias(datos):
    pid = datos.producto(stock_minimo="5", caducidad=True)
    with SessionLocal() as db:
        registrar_compra(
            db,
            CompraCreate(
                factura_proveedor=f"F-CAD-{datos.tag}",
                proveedor_id=datos.proveedor_id,
                items=[dict(producto_id=pid, codigo_lote="V1", cantidad="3", costo_unitario="1.00",
                            fecha_caducidad=date.today() + timedelta(days=10))],
            ),
            datos.encargado_id,
        )
    body = client.get("/dashboard/alertas", headers=datos.headers(datos.encargado_id)).json()
    critico = next(x for x in body["stock_critico"] if x["producto_id"] == pid)
    assert D(str(critico["stock_actual"])) == D("3")
    lote = next(x for x in body["lotes_por_caducar"] if x["producto_id"] == pid)
    assert lote["dias_restantes"] == 10
    assert date.fromisoformat(lote["fecha_caducidad"]) == date.today() + timedelta(days=10)


# ---------------------------------------------------------------------- kardex

def test_kardex_requiere_autenticacion():
    assert client.get("/inventario/kardex").status_code == 401


def test_kardex_pagina_y_serializa_tipos(datos):
    pid = datos.producto()
    datos.comprar(pid, lotes=5)
    h = datos.headers(datos.cajero_id)  # cualquier rol activo puede ver el kardex

    def pagina(**params):
        r = client.get("/inventario/kardex", params={"producto_id": pid, **params}, headers=h)
        assert r.status_code == 200, r.text
        return r.json()

    p1 = pagina(limite=2, desplazamiento=0)
    p2 = pagina(limite=2, desplazamiento=2)
    p3 = pagina(limite=2, desplazamiento=4)
    assert [len(p1), len(p2), len(p3)] == [2, 2, 1]
    assert pagina(limite=2, desplazamiento=5) == []

    ids = [m["id"] for m in p1 + p2 + p3]
    assert len(set(ids)) == 5, "las páginas no deben solaparse"
    assert ids == sorted(ids, reverse=True), "orden: más reciente primero"

    m = p1[0]
    assert isinstance(m["id"], int) and isinstance(m["lote_id"], int)
    assert D(str(m["cantidad"])) == D("2.5")
    assert D(str(m["saldo_resultante"])) == D("2.5")
    assert m["tipo"] == "ENTRADA_COMPRA"
    assert m["tipo_movimiento"] == "ENTRADA_COMPRA"
    assert m["folio_documento"].startswith("COM-")
    assert isinstance(m["documento_id"], int)
    assert datetime.fromisoformat(m["fecha"]).tzinfo is not None
    assert m["detalle_compra_id"] is not None and m["merma_id"] is None
    assert m["nombre_producto"].startswith("TEST_PG_prod_")
    assert m["codigo_lote"].startswith("L")
    assert m["nombre_usuario"] == "TEST_PG encargado"
    assert m["usuario_nombre"] == "TEST_PG encargado"


def test_kardex_filtros_y_validacion(datos):
    pid = datos.producto()
    compra = datos.comprar(pid, lotes=2)
    lote_id = compra.detalles[0].lote_id
    h = datos.headers(datos.cajero_id)

    por_lote = client.get("/inventario/kardex", params={"lote_id": lote_id}, headers=h).json()
    assert [m["lote_id"] for m in por_lote] == [lote_id]

    solo_mermas = client.get(
        "/inventario/kardex", params={"producto_id": pid, "tipo": "MERMA"}, headers=h
    )
    assert solo_mermas.status_code == 200 and solo_mermas.json() == []

    assert client.get("/inventario/kardex", params={"tipo": "INVENTADO"}, headers=h).status_code == 422
    assert client.get("/inventario/kardex", params={"tipo_movimiento": "INVENTADO"}, headers=h).status_code == 422
    assert client.get("/inventario/kardex", params={"limite": 0}, headers=h).status_code == 422
    assert client.get("/inventario/kardex", params={"desplazamiento": -1}, headers=h).status_code == 422


def test_kardex_folios_saldo_acumulado_y_busqueda_trgm(datos):
    sku = f"SKU-{datos.tag}"
    nombre = f"Amoxicilina Veterinaria {datos.tag}"
    pid = datos.producto(decimales=False, nombre=nombre, sku=sku)
    h = datos.headers(datos.encargado_id)

    # 1. ENTRADA_COMPRA (+10 -> saldo 10)
    compra = datos.comprar(pid, lotes=1, cantidad="10")
    lote_id = compra.detalles[0].lote_id

    # 2. VENTA (-4 -> saldo 6)
    with SessionLocal() as db:
        venta = crear_venta(
            db,
            VentaCreate(
                cliente_id=datos.cliente_id,
                items=[{"producto_id": pid, "cantidad": "4"}],
                pagos=[{"metodo": "EFECTIVO", "importe": D("40.00"), "pago_con": D("40.00"), "cambio": D("0")}],
            ),
            datos.cajero_id,
        )
        detalle_venta_id = db.scalar(select(DetalleVenta.id).where(DetalleVenta.venta_id == venta.id))

    # 3. DEVOLUCION_STOCK (+1 -> saldo 7)
    with SessionLocal() as db:
        registrar_devolucion(
            db,
            DevolucionCreate(
                venta_id=venta.id,
                detalle_venta_id=detalle_venta_id,
                cantidad="1",
                motivo="Caja abollada",
                reingreso_a_stock=True,
            ),
            datos.cajero_id,
        )

    # 4. MERMA (-2 -> saldo 5)
    with SessionLocal() as db:
        merma = registrar_merma(
            db,
            MermaCreate(
                producto_id=pid,
                lote_id=lote_id,
                cantidad="2",
                motivo="ROTURA_DAÑO",
                descripcion="Frasco estrellado",
            ),
            datos.encargado_id,
        )

    # 5. AJUSTE_ENTRADA (+3 -> saldo 8)
    with SessionLocal() as db, db.begin():
        db.add(
            MovimientoInventario(
                producto_id=pid,
                lote_id=lote_id,
                tipo="AJUSTE_ENTRADA",
                cantidad=D("3"),
                usuario_id=datos.encargado_id,
                motivo="Conteo cíclico anual",
            )
        )

    # Consulta del historial completo (más reciente a más antiguo)
    r = client.get("/inventario/kardex", params={"producto_id": pid}, headers=h)
    assert r.status_code == 200, r.text
    movs = r.json()
    assert len(movs) == 5

    # Con permite_decimales=False, cantidad y saldo_resultante se formatean como enteros sin '.000'
    assert [(m["tipo_movimiento"], m["cantidad"], m["saldo_resultante"]) for m in movs] == [
        ("AJUSTE_ENTRADA", "3", "8"),
        ("MERMA", "2", "5"),
        ("DEVOLUCION_STOCK", "1", "7"),
        ("VENTA", "4", "6"),
        ("ENTRADA_COMPRA", "10", "10"),
    ]

    # Verificación de folios legibles, documento_id y motivos legibles
    m_ajuste, m_merma, m_dev, m_venta, m_compra = movs
    assert m_ajuste["folio_documento"] == "AJUSTE"
    assert m_ajuste["documento_id"] is None
    assert m_ajuste["motivo_legible"] == "Conteo cíclico anual"

    assert m_merma["folio_documento"] == f"MERMA-{merma.id}"
    assert m_merma["documento_id"] == merma.id
    assert m_merma["motivo_legible"] == "Rotura o daño: Frasco estrellado"

    assert m_dev["folio_documento"] == venta.folio
    assert m_dev["documento_id"] == venta.id
    assert venta.folio in m_dev["motivo_legible"] and "Caja abollada" in m_dev["motivo_legible"]

    assert m_venta["folio_documento"] == venta.folio
    assert m_venta["documento_id"] == venta.id
    assert m_venta["usuario_nombre"] == "TEST_PG cajero"

    assert m_compra["folio_documento"] == compra.folio
    assert m_compra["documento_id"] == compra.id

    # Filtrar por tipo_movimiento NO altera el saldo_resultante histórico
    solo_merma = client.get(
        "/inventario/kardex",
        params={"producto_id": pid, "tipo_movimiento": "MERMA"},
        headers=h,
    ).json()
    assert len(solo_merma) == 1
    assert solo_merma[0]["saldo_resultante"] == "5"

    # Búsqueda q por nombre difuso (pg_trgm), SKU exacto y folio exacto
    por_trgm = client.get("/inventario/kardex", params={"q": f"Amoxisilna {datos.tag}"}, headers=h).json()
    assert len(por_trgm) == 5

    por_sku = client.get("/inventario/kardex", params={"q": sku}, headers=h).json()
    assert len(por_sku) == 5

    por_folio_venta = client.get("/inventario/kardex", params={"q": venta.folio}, headers=h).json()
    # Coincide tanto la VENTA como la DEVOLUCION_STOCK ligada al mismo ticket
    assert {m["tipo_movimiento"] for m in por_folio_venta} == {"VENTA", "DEVOLUCION_STOCK"}


# ----------------------------------------- proveedores, último costo y compras

def test_crear_proveedor_y_validaciones(datos):
    h = datos.headers(datos.encargado_id)
    # Sin razon_social -> 422
    assert client.post("/api/proveedores", json={"rfc": "XAXX010101000"}, headers=h).status_code == 422
    assert client.post("/api/proveedores", json={"razon_social": "   "}, headers=h).status_code == 422

    r = client.post(
        "/api/proveedores",
        json={
            "razon_social": f"TEST_PG Proveedor Nuevo {datos.tag}",
            "rfc": "LPN261102AB1",
            "telefono": "8112345678",
            "correo": "ventas@luckypet.mx",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    creado = r.json()
    try:
        assert isinstance(creado["id"], int)
        assert creado["razon_social"] == f"TEST_PG Proveedor Nuevo {datos.tag}"
        assert creado["rfc"] == "LPN261102AB1"
        assert creado["activo"] is True
    finally:
        with SessionLocal() as db, db.begin():
            db.execute(text("DELETE FROM proveedores WHERE id = :id"), {"id": creado["id"]})


def test_ultimo_costo_y_recepcion_compras_autolote_y_caducidad(datos):
    h = datos.headers(datos.encargado_id)
    pid_no_cad = datos.producto(caducidad=False, decimales=False)
    pid_cad = datos.producto(caducidad=True, decimales=False)

    # Sin compras previas -> 0.00
    r0 = client.get(f"/api/productos/{pid_no_cad}/ultimo-costo", headers=h)
    assert r0.status_code == 200
    assert D(str(r0.json()["ultimo_costo"])) == D("0.00")

    # El folio interno lo asigna el servidor: si el cliente intenta mandarlo -> 422
    con_folio = client.post(
        "/api/compras",
        json={
            "folio": "COM-1999-00001",
            "proveedor_id": datos.proveedor_id,
            "items": [{"producto_id": pid_no_cad, "cantidad": "5", "costo_unitario": "12.50"}],
        },
        headers=h,
    )
    assert con_folio.status_code == 422

    # Producto con requiere_caducidad=True exige codigo_lote y fecha_caducidad -> 422
    for item_invalido in (
        {"producto_id": pid_cad, "cantidad": "2", "costo_unitario": "8.00", "fecha_caducidad": "2027-05-01"},
        {"producto_id": pid_cad, "cantidad": "2", "costo_unitario": "8.00", "codigo_lote": "LOTE-CAD-1"},
    ):
        r_inv = client.post(
            "/api/compras",
            json={"factura_proveedor": f"FAC-INV-{datos.tag}", "proveedor_id": datos.proveedor_id, "items": [item_invalido]},
            headers=h,
        )
        assert r_inv.status_code == 422

    # Compra 1: producto sin caducidad ni lote manual -> autogenera AUT-{YYYYMMDD}-{producto_id}
    r1 = client.post(
        "/api/compras",
        json={
            "factura_proveedor": f"FAC-001-{datos.tag}",
            "proveedor_id": datos.proveedor_id,
            "items": [
                # Sin caducidad: la fecha que llegue se descarta
                {"producto_id": pid_no_cad, "cantidad": "5", "costo_unitario": "12.50",
                 "fecha_caducidad": (date.today() + timedelta(days=5)).isoformat()},
                {
                    "producto_id": pid_cad,
                    "codigo_lote": "LOTE-EXP-1",
                    "fecha_caducidad": (date.today() + timedelta(days=60)).isoformat(),
                    "cantidad": "3",
                    "costo_unitario": "20.00",
                },
            ],
        },
        headers=h,
    )
    assert r1.status_code == 201, r1.text
    c1 = r1.json()
    # Folio interno consecutivo; la factura del proveedor va en su propio campo
    assert re.fullmatch(rf"COM-{date.today().year}-\d{{5}}", c1["folio"])
    assert c1["factura_proveedor"] == f"FAC-001-{datos.tag}"
    assert D(str(c1["total"])) == D("122.50")

    # Verificar el código de lote autogenerado en kardex
    kardex_no_cad = client.get("/inventario/kardex", params={"producto_id": pid_no_cad}, headers=h).json()
    assert len(kardex_no_cad) == 1
    assert kardex_no_cad[0]["codigo_lote"] == f"AUT-{date.today():%Y%m%d}-{pid_no_cad}"
    assert kardex_no_cad[0]["folio_documento"] == c1["folio"]
    with SessionLocal() as db:
        lote_no_cad = db.scalar(select(LoteStock).where(LoteStock.producto_id == pid_no_cad))
        assert lote_no_cad.fecha_caducidad is None

    # Compra 2 más reciente con distinto costo -> ultimo-costo devuelve el más reciente
    r2 = client.post(
        "/api/compras",
        json={
            "factura_proveedor": f"FAC-002-{datos.tag}",
            "proveedor_id": datos.proveedor_id,
            "items": [{"producto_id": pid_no_cad, "cantidad": "2", "costo_unitario": "15.75"}],
        },
        headers=h,
    )
    assert r2.status_code == 201, r2.text
    # El consecutivo avanza de uno en uno
    assert int(r2.json()["folio"].rsplit("-", 1)[1]) == int(c1["folio"].rsplit("-", 1)[1]) + 1

    r_costo = client.get(f"/api/productos/{pid_no_cad}/ultimo-costo", headers=h)
    assert r_costo.status_code == 200
    assert D(str(r_costo.json()["ultimo_costo"])) == D("15.75")

