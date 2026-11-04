"""Modulo Equipo (/usuarios) sobre el PostgreSQL local real.

Cada prueba corre dentro de una transaccion que se revierte al terminar: el endpoint hace commit,
pero sobre un SAVEPOINT, asi que ni los usuarios de prueba ni los cambios a los Admin reales
llegan a persistir.
"""
import uuid

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import make_url, select, update
from sqlalchemy.orm import Session

load_dotenv()

from app.core.database import engine, get_db  # noqa: E402
from app.core.security import create_access_token, verify_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Usuario  # noqa: E402

client = TestClient(app)


@pytest.fixture(scope="session", autouse=True)
def _solo_postgres_local():
    url = make_url(str(engine.url))
    assert url.get_backend_name() == "postgresql", "DATABASE_URL debe ser PostgreSQL"
    assert url.host in (None, "localhost", "127.0.0.1", "::1"), (
        f"Las pruebas solo corren contra PostgreSQL local, no {url.host}"
    )


@pytest.fixture
def db():
    conexion = engine.connect()
    transaccion = conexion.begin()
    sesion = Session(
        bind=conexion, join_transaction_mode="create_savepoint", autoflush=False, expire_on_commit=False
    )
    app.dependency_overrides[get_db] = lambda: sesion
    try:
        yield sesion
    finally:
        app.dependency_overrides.pop(get_db, None)
        sesion.close()
        transaccion.rollback()
        conexion.close()


def _usuario(db: Session, rol: str, activo: bool = True) -> Usuario:
    u = Usuario(
        nombre=f"TEST_PG {rol}",
        usuario=f"test_pg_{uuid.uuid4().hex[:10]}",
        password_hash="x",
        rol=rol,
        activo=activo,
    )
    db.add(u)
    db.flush()
    return u


def _h(usuario: Usuario) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(usuario.id, usuario.rol)}"}


def _nuevo(**cambios):
    cuerpo = {
        "nombre": "Juan Morales",
        "usuario": f"jmorales_{uuid.uuid4().hex[:8]}",
        "password": "Secreta123",
        "rol": "Cajero",
    }
    return {**cuerpo, **cambios}


def test_solo_admin_entra_al_modulo(db):
    admin = _usuario(db, "Admin")
    objetivo = _usuario(db, "Cajero")
    assert client.get("/usuarios").status_code == 401
    for rol in ("Encargado", "Cajero"):
        h = _h(_usuario(db, rol))
        assert client.get("/usuarios", headers=h).status_code == 403
        assert client.post("/usuarios", json=_nuevo(), headers=h).status_code == 403
        assert client.patch(f"/usuarios/{objetivo.id}", json={"nombre": "X"}, headers=h).status_code == 403
        assert client.patch(f"/usuarios/{objetivo.id}/toggle-activo", headers=h).status_code == 403
        assert (
            client.patch(f"/usuarios/{objetivo.id}/password", json={"password": "Otra12345"}, headers=h).status_code
            == 403
        )
    assert client.get("/usuarios", headers=_h(admin)).status_code == 200


def test_listado_ordenado_y_sin_hash(db):
    admin = _usuario(db, "Admin")
    r = client.get("/usuarios", headers=_h(admin))
    assert r.status_code == 200
    filas = r.json()
    ids = [u["id"] for u in filas]
    assert ids == sorted(ids)
    assert admin.id in ids
    for u in filas:
        assert set(u) == {"id", "nombre", "usuario", "rol", "activo", "creado_en"}


def test_crear_usuario_valida_y_hashea(db):
    h = _h(_usuario(db, "Admin"))
    cuerpo = _nuevo()
    r = client.post("/usuarios", json=cuerpo, headers=h)
    assert r.status_code == 201, r.text
    creado = r.json()
    assert creado["activo"] is True and creado["rol"] == "Cajero"
    assert "password" not in creado and "password_hash" not in creado
    guardado = db.scalar(select(Usuario).where(Usuario.id == creado["id"]))
    assert guardado.password_hash != cuerpo["password"]
    assert verify_password(cuerpo["password"], guardado.password_hash)

    # La contraseña recien creada sirve para entrar
    login = client.post("/auth/login", data={"username": cuerpo["usuario"], "password": cuerpo["password"]})
    assert login.status_code == 200

    # Duplicado, rol fuera del catalogo, contraseña corta o larga, campo ajeno
    assert client.post("/usuarios", json=cuerpo, headers=h).status_code == 409
    assert client.post("/usuarios", json=_nuevo(rol="Dueño"), headers=h).status_code == 422
    assert client.post("/usuarios", json=_nuevo(password="corta"), headers=h).status_code == 422
    assert client.post("/usuarios", json=_nuevo(password="a" * 73), headers=h).status_code == 422
    assert client.post("/usuarios", json=_nuevo(usuario="con espacio"), headers=h).status_code == 422
    assert client.post("/usuarios", json=_nuevo(password_hash="x"), headers=h).status_code == 422


def test_editar_nombre_usuario_y_rol(db):
    h = _h(_usuario(db, "Admin"))
    otro = _usuario(db, "Cajero")
    ocupado = _usuario(db, "Cajero")
    nuevo_usuario = f"renombrado_{uuid.uuid4().hex[:6]}"
    r = client.patch(
        f"/usuarios/{otro.id}",
        json={"nombre": "  Ana López ", "usuario": nuevo_usuario, "rol": "Encargado"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["nombre"] == "Ana López"
    assert r.json()["usuario"] == nuevo_usuario and r.json()["rol"] == "Encargado"
    assert client.patch(f"/usuarios/{otro.id}", json={"usuario": ocupado.usuario}, headers=h).status_code == 409
    assert client.patch(f"/usuarios/{otro.id}", json={"rol": "Jefe"}, headers=h).status_code == 422
    assert client.patch("/usuarios/999999999", json={"nombre": "X"}, headers=h).status_code == 404


def test_toggle_activo_y_login_bloqueado(db):
    h = _h(_usuario(db, "Admin"))
    creado = client.post("/usuarios", json=_nuevo(), headers=h).json()
    r = client.patch(f"/usuarios/{creado['id']}/toggle-activo", headers=h)
    assert r.status_code == 200 and r.json()["activo"] is False
    login = client.post("/auth/login", data={"username": creado["usuario"], "password": "Secreta123"})
    assert login.status_code == 401
    r = client.patch(f"/usuarios/{creado['id']}/toggle-activo", headers=h)
    assert r.status_code == 200 and r.json()["activo"] is True
    assert client.patch("/usuarios/999999999/toggle-activo", headers=h).status_code == 404


def test_no_se_puede_dejar_el_sistema_sin_admin_activo(db):
    admin = _usuario(db, "Admin")
    # Dentro de la transaccion de prueba, el unico Admin activo es el de la prueba
    db.execute(update(Usuario).where(Usuario.rol == "Admin", Usuario.id != admin.id).values(activo=False))
    db.flush()
    h = _h(admin)

    r = client.patch(f"/usuarios/{admin.id}/toggle-activo", headers=h)
    assert r.status_code == 400
    assert "Admin" in r.json()["detail"]
    assert client.patch(f"/usuarios/{admin.id}", json={"rol": "Cajero"}, headers=h).status_code == 400
    # Renombrarlo o dejarle el mismo rol si se permite
    assert client.patch(f"/usuarios/{admin.id}", json={"nombre": "Nuevo", "rol": "Admin"}, headers=h).status_code == 200

    # Con un segundo Admin activo ya se puede desactivar al primero
    segundo = client.post("/usuarios", json=_nuevo(rol="Admin"), headers=h).json()
    r = client.patch(f"/usuarios/{admin.id}/toggle-activo", headers=_h(Usuario(id=segundo["id"], rol="Admin")))
    assert r.status_code == 200 and r.json()["activo"] is False


def test_cambiar_password(db):
    h = _h(_usuario(db, "Admin"))
    creado = client.post("/usuarios", json=_nuevo(), headers=h).json()
    ruta = f"/usuarios/{creado['id']}/password"
    assert client.patch(ruta, json={"password": "corta"}, headers=h).status_code == 422
    assert client.patch(ruta, json={"password": "NuevaClave456", "extra": 1}, headers=h).status_code == 422
    r = client.patch(ruta, json={"password": "NuevaClave456"}, headers=h)
    assert r.status_code == 204
    viejo = client.post("/auth/login", data={"username": creado["usuario"], "password": "Secreta123"})
    nuevo = client.post("/auth/login", data={"username": creado["usuario"], "password": "NuevaClave456"})
    assert viejo.status_code == 401 and nuevo.status_code == 200
    assert client.patch("/usuarios/999999999/password", json={"password": "NuevaClave456"}, headers=h).status_code == 404
