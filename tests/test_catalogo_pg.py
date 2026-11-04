"""Catálogo de productos, categorías y clientes contra PostgreSQL local."""
import uuid

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import delete

load_dotenv()

from app.api.deps import get_current_user  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Categoria, Cliente, Producto, Usuario  # noqa: E402


def como(rol: str):
    app.dependency_overrides[get_current_user] = lambda: Usuario(id=1, nombre="t", usuario="t", rol=rol, activo=True)


@pytest.fixture
def entorno():
    marca = uuid.uuid4().hex[:8]
    with SessionLocal() as db:
        categoria = Categoria(nombre=f"Cat {marca}")
        db.add(categoria)
        db.commit()
        categoria_id = categoria.id
    como("Admin")
    yield TestClient(app), categoria_id, marca
    app.dependency_overrides.clear()
    with SessionLocal() as db:
        db.execute(delete(Producto).where(Producto.categoria_id == categoria_id))
        db.execute(delete(Categoria).where(Categoria.id == categoria_id))
        db.commit()


def cuerpo(categoria_id, marca, **extra):
    return {
        "categoria_id": categoria_id,
        "codigo_barras_sku": f"SKU{marca}",
        "nombre": f"Croquetas {marca}",
        "precio_venta": "120.50",
        **extra,
    }


def test_crear_listar_y_alternar(entorno):
    c, categoria_id, marca = entorno
    creado = c.post("/productos", json=cuerpo(categoria_id, marca))
    assert creado.status_code == 201
    pid = creado.json()["id"]

    # Texto parcial corto y SKU por prefijo
    for q in (marca, f"SKU{marca[:4]}"):
        filas = c.get("/productos", params={"q": q, "categoria_id": categoria_id}).json()
        assert [f["id"] for f in filas] == [pid]
    fila = filas[0]
    assert fila["categoria"].startswith("Cat ")
    assert fila["stock_total"] == "0"
    assert fila["lotes"] == []

    assert c.patch(f"/productos/{pid}", json={"activo": False}).json()["activo"] is False
    assert c.get("/productos", params={"categoria_id": categoria_id, "activo": True}).json() == []
    assert len(c.get("/productos", params={"categoria_id": categoria_id, "activo": False}).json()) == 1
    assert len(c.get("/productos", params={"categoria_id": categoria_id}).json()) == 1


def test_patch_quita_sku_e_ignora_null_en_lo_demas(entorno):
    c, categoria_id, marca = entorno
    pid = c.post("/productos", json=cuerpo(categoria_id, marca)).json()["id"]
    r = c.patch(f"/productos/{pid}", json={"codigo_barras_sku": None, "nombre": None})
    assert r.status_code == 200
    assert r.json()["codigo_barras_sku"] is None
    assert r.json()["nombre"] == f"Croquetas {marca}"


def test_sku_duplicado_es_409_con_detail(entorno):
    c, categoria_id, marca = entorno
    assert c.post("/productos", json=cuerpo(categoria_id, marca)).status_code == 201
    r = c.post("/productos", json=cuerpo(categoria_id, marca, nombre="Otro"))
    assert r.status_code == 409
    assert isinstance(r.json()["detail"], str)


def test_precio_negativo_rechazado(entorno):
    c, categoria_id, marca = entorno
    assert c.post("/productos", json=cuerpo(categoria_id, marca, precio_venta="-1")).status_code == 422


def test_cajero_no_escribe_pero_consulta(entorno):
    c, categoria_id, marca = entorno
    como("Cajero")
    assert c.post("/productos", json=cuerpo(categoria_id, marca)).status_code == 403
    assert c.patch("/productos/1", json={"activo": False}).status_code == 403
    assert c.get("/productos", params={"limite": 1}).status_code == 200
    assert c.get("/categorias").status_code == 200


def test_clientes_publico_general_primero(entorno):
    c, *_ = entorno
    with SessionLocal() as db:
        uno = db.get(Cliente, 1)
        if uno is None or not uno.activo:
            pytest.skip("Sin Público General activo: falta correr seed.py")
    assert c.get("/clientes").json()[0]["id"] == 1


def test_crear_y_editar_producto_multipart_con_imagen_y_booleano_puro(entorno):
    from pathlib import Path

    c, categoria_id, marca = entorno
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
        b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    archivos_creados: list[Path] = []
    try:
        # 1. Crear producto con Form + UploadFile (multipart/form-data)
        r = c.post(
            "/productos",
            data={
                "categoria_id": str(categoria_id),
                "codigo_barras_sku": f"IMG-{marca}",
                "nombre": f"Shampoo Hipoalergénico {marca}",
                "precio_venta": "185.00",
                "stock_minimo": "3",
                "permite_decimales": "false",
                "requiere_caducidad": "true",
            },
            files={"imagen": ("Mi Foto Original!!.png", png_bytes, "image/png")},
        )
        assert r.status_code == 201, r.text
        prod = r.json()
        pid = prod["id"]
        assert prod["requiere_caducidad"] is True
        assert prod["permite_decimales"] is False
        assert prod["imagen_url"] is not None
        assert prod["imagen_url"].startswith("static/uploads/productos/")
        assert prod["imagen_url"].endswith(".png")
        assert "Mi Foto" not in prod["imagen_url"]
        archivos_creados.append(Path(prod["imagen_url"]))

        # Verificar que StaticFiles sirve el archivo en /static/...
        r_static = c.get(f"/{prod['imagen_url']}")
        assert r_static.status_code == 200
        assert r_static.content == png_bytes

        # 2. PUT /productos/{id} con nueva imagen .webp
        r_put = c.put(
            f"/productos/{pid}",
            data={
                "nombre": f"Shampoo Renovado {marca}",
                "precio_venta": "199.50",
                "requiere_caducidad": "false",
            },
            files={"imagen": ("nueva.webp", b"RIFF\x00\x00\x00\x00WEBP", "image/webp")},
        )
        assert r_put.status_code == 200, r_put.text
        actualizado = r_put.json()
        assert actualizado["nombre"] == f"Shampoo Renovado {marca}"
        assert actualizado["requiere_caducidad"] is False
        assert actualizado["imagen_url"].endswith(".webp")
        archivos_creados.append(Path(actualizado["imagen_url"]))

        # 3. Rechazar formato de archivo no permitido (ej. .txt / text/plain)
        r_bad_img = c.post(
            "/productos",
            data={
                "categoria_id": str(categoria_id),
                "nombre": f"Invalido {marca}",
                "precio_venta": "50.00",
            },
            files={"imagen": ("script.txt", b"no soy imagen", "text/plain")},
        )
        assert r_bad_img.status_code == 422

        # 4. Rechazar fecha en requiere_caducidad (solo booleano puro)
        r_bad_bool = c.post(
            "/productos",
            data={
                "categoria_id": str(categoria_id),
                "nombre": f"FechaEnBool {marca}",
                "precio_venta": "50.00",
                "requiere_caducidad": "2027-12-31",
            },
        )
        assert r_bad_bool.status_code == 422
    finally:
        for ruta in archivos_creados:
            ruta.unlink(missing_ok=True)

