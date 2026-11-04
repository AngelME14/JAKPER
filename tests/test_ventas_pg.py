"""Integración contra el PostgreSQL local real (triggers, CHECKs, FOR UPDATE).

Cada prueba crea sus propios datos (prefijo TEST_PG_) y los borra al terminar;
no toca filas ajenas. Requiere DATABASE_URL en .env apuntando a localhost.
"""
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal as D

import pytest
from dotenv import load_dotenv
from sqlalchemy import make_url, select, text
from sqlalchemy.exc import DBAPIError

load_dotenv()

from app.core.database import SessionLocal, engine  # noqa: E402
from app.models import (  # noqa: E402
    Categoria, Cliente, DetalleVenta, Devolucion, LoteStock, Merma, Producto, Usuario,
)
from app.models import MovimientoInventario  # noqa: E402
from app.api.routers.inventario import kardex  # noqa: E402
from app.schemas.ventas import DevolucionCreate, VentaCreate  # noqa: E402
from app.services import ventas_service  # noqa: E402
from app.services.ventas_service import (  # noqa: E402
    DevolucionError,
    DevolucionExcedida,
    StockInsuficiente,
    VentaNoEncontrada,
    VentaYaCancelada,
    cancelar_venta,
    consultar_venta_por_folio,
    crear_venta,
    registrar_devolucion,
)

HOY = date.today()
AHORA = datetime.now(timezone.utc)


@pytest.fixture(scope="session", autouse=True)
def _solo_postgres_local():
    url = make_url(str(engine.url))
    assert url.get_backend_name() == "postgresql", "DATABASE_URL debe ser PostgreSQL"
    assert url.host in (None, "localhost", "127.0.0.1", "::1"), (
        f"Las pruebas solo corren contra PostgreSQL local, no {url.host}"
    )


class Datos:
    """Crea filas de prueba y las borra (orden inverso de FKs) en el teardown."""

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
            self.categoria_id = cat.id
            u = Usuario(
                nombre="TEST_PG", usuario=f"test_pg_{self.tag}",
                password_hash="x", rol="Cajero",
            )
            c = Cliente(nombre=f"TEST_PG_{self.tag}")
            db.add_all([u, c])
            db.flush()
            self.usuario_id, self.cliente_id = u.id, c.id
        self.producto_ids: list[int] = []

    def producto(self, *, caducidad: bool, precio="10.00") -> int:
        with SessionLocal() as db, db.begin():
            p = Producto(
                categoria_id=self.categoria_id,
                nombre=f"TEST_PG_prod_{self.tag}_{len(self.producto_ids)}",
                precio_venta=D(precio),
                requiere_caducidad=caducidad,
                permite_decimales=False,
            )
            db.add(p)
            db.flush()
            self.producto_ids.append(p.id)
            return p.id

    def lote(self, producto_id, codigo, cantidad, *, caduca=None, recibido=None) -> int:
        with SessionLocal() as db, db.begin():
            l = LoteStock(
                producto_id=producto_id, codigo_lote=codigo,
                costo_unitario=D("4.00"), cantidad_disponible=D(cantidad),
                fecha_caducidad=caduca,
                **({"fecha_recepcion": recibido} if recibido else {}),
            )
            db.add(l)
            db.flush()
            return l.id

    def venta_payload(self, producto_id, cantidad, precio="10.00") -> VentaCreate:
        total = D(precio) * D(cantidad)
        return VentaCreate(
            cliente_id=self.cliente_id,
            items=[{"producto_id": producto_id, "cantidad": cantidad}],
            pagos=[{"metodo": "EFECTIVO", "importe": total, "pago_con": total, "cambio": 0}],
        )

    def vender(self, producto_id, cantidad):
        with SessionLocal() as db:
            return crear_venta(db, self.venta_payload(producto_id, cantidad), self.usuario_id)

    def limpiar(self):
        pids = self.producto_ids
        with SessionLocal() as db, db.begin():
            p = {"p": pids, "u": self.usuario_id}
            # El Kardex es inmutable por trigger: solo la limpieza de pruebas lo salta (requiere superusuario)
            db.execute(text("SET LOCAL session_replication_role = replica"))
            db.execute(text("DELETE FROM movimientos_inventario WHERE producto_id = ANY(:p)"), p)
            db.execute(text("SET LOCAL session_replication_role = origin"))
            db.execute(text("DELETE FROM mermas WHERE producto_id = ANY(:p)"), p)
            db.execute(text("DELETE FROM devoluciones WHERE venta_id IN (SELECT id FROM ventas WHERE usuario_id = :u)"), p)
            db.execute(text("DELETE FROM pagos WHERE venta_id IN (SELECT id FROM ventas WHERE usuario_id = :u)"), p)
            db.execute(text("DELETE FROM detalle_ventas WHERE venta_id IN (SELECT id FROM ventas WHERE usuario_id = :u)"), p)
            db.execute(text("DELETE FROM ventas WHERE usuario_id = :u"), p)
            db.execute(text("DELETE FROM lotes_stock WHERE producto_id = ANY(:p)"), p)
            db.execute(text("DELETE FROM productos WHERE id = ANY(:p)"), p)
            db.execute(text("DELETE FROM usuarios WHERE id = :u"), p)
            db.execute(text("DELETE FROM clientes WHERE id = :c"), {"c": self.cliente_id})
            if self.categoria_propia:
                db.execute(text("DELETE FROM categorias WHERE id = :c"), {"c": self.categoria_propia})


@pytest.fixture
def datos():
    d = Datos()
    try:
        yield d
    finally:
        d.limpiar()


def codigos_despachados(venta_id):
    with SessionLocal() as db:
        return [
            (dv.lote.codigo_lote, dv.cantidad)
            for dv in db.scalars(
                select(DetalleVenta).where(DetalleVenta.venta_id == venta_id).order_by(DetalleVenta.id)
            )
        ]


# ---------------------------------------------------------------- concurrencia

def test_concurrencia_for_update_rechaza_segunda_venta(datos, monkeypatch):
    pid = datos.producto(caducidad=False)
    lote_id = datos.lote(pid, "REMANENTE", "5")

    # Cada transacción retiene el bloqueo de fila un rato antes de hacer commit,
    # para que la otra llegue al SELECT ... FOR UPDATE mientras la fila está bloqueada.
    original = ventas_service._validar_pagos

    def lento(*a, **kw):
        time.sleep(1.0)
        return original(*a, **kw)

    monkeypatch.setattr(ventas_service, "_validar_pagos", lento)

    barrera = threading.Barrier(2)
    resultados: dict[int, tuple[str, float, object]] = {}

    def comprar(n):
        with SessionLocal() as db:
            barrera.wait()
            t0 = time.monotonic()
            try:
                v = crear_venta(db, datos.venta_payload(pid, 5), datos.usuario_id)
                resultados[n] = ("ok", time.monotonic() - t0, v.id)
            except Exception as e:  # noqa: BLE001
                resultados[n] = ("error", time.monotonic() - t0, e)

    hilos = [threading.Thread(target=comprar, args=(i,)) for i in (1, 2)]
    [h.start() for h in hilos]
    [h.join(timeout=30) for h in hilos]

    estados = sorted(r[0] for r in resultados.values())
    assert estados == ["error", "ok"], resultados

    ganador = next(r for r in resultados.values() if r[0] == "ok")
    perdedor = next(r for r in resultados.values() if r[0] == "error")
    # rechazo limpio: StockInsuficiente de negocio, no IntegrityError/CheckViolation
    assert isinstance(perdedor[2], StockInsuficiente), repr(perdedor[2])
    # el perdedor esperó el bloqueo de fila (no leyó el stock antes del commit del ganador)
    assert perdedor[1] >= 1.0, f"perdedor no esperó el lock ({perdedor[1]:.2f}s)"

    with SessionLocal() as db:
        lote = db.get(LoteStock, lote_id)
        assert lote.cantidad_disponible == D("0.000")
        vendidas = db.scalar(
            text("SELECT COALESCE(SUM(cantidad),0) FROM detalle_ventas WHERE lote_id = :l"),
            {"l": lote_id},
        )
        assert vendidas == D("5")
        assert db.scalar(
            text("SELECT COUNT(*) FROM ventas WHERE usuario_id = :u"), {"u": datos.usuario_id}
        ) == 1
    assert ganador[2]


def test_bloqueo_de_lotes_por_id_evita_deadlock_entre_venta_y_cancelacion(datos):
    """El orden de consumo FEFO no puede ser el orden de los candados.

    Lote A (id menor) caduca despues que lote B (id mayor): FEFO consume B y luego A.
    `holder` imita a una cancelacion (candados por id: A y luego B). Con candados en orden FEFO
    la venta retiene B esperando A mientras `holder` retiene A esperando B -> deadlock.
    """
    pid = datos.producto(caducidad=True)
    lote_a = datos.lote(pid, "A-TARDE", "3", caduca=HOY + timedelta(days=60))
    lote_b = datos.lote(pid, "B-PRONTO", "3", caduca=HOY + timedelta(days=10))
    assert lote_a < lote_b

    resultado: dict[str, object] = {}

    def vender():
        with SessionLocal() as db:
            try:
                resultado["venta"] = crear_venta(db, datos.venta_payload(pid, 6), datos.usuario_id).id
            except Exception as e:  # noqa: BLE001
                resultado["venta_error"] = e

    with SessionLocal() as holder:
        holder.execute(text("SET LOCAL lock_timeout = '10s'"))
        holder.execute(text("SELECT 1 FROM lotes_stock WHERE id = :l FOR UPDATE"), {"l": lote_a})
        hilo = threading.Thread(target=vender)
        hilo.start()
        time.sleep(2.5)  # supera deadlock_timeout (1 s): un ciclo ya se habria detectado
        try:
            holder.execute(text("SELECT 1 FROM lotes_stock WHERE id = :l FOR UPDATE"), {"l": lote_b})
            holder.commit()
        except DBAPIError as e:
            holder.rollback()
            resultado["holder_error"] = e
        hilo.join(timeout=30)

    assert "holder_error" not in resultado, repr(resultado.get("holder_error"))
    assert "venta_error" not in resultado, repr(resultado.get("venta_error"))
    assert resultado["venta"]


def test_check_cantidad_disponible_nunca_negativa(datos):
    pid = datos.producto(caducidad=False)
    lote_id = datos.lote(pid, "L1", "1")
    with SessionLocal() as db:
        with pytest.raises(DBAPIError, match="chk_lotes_stock_cantidad_positiva"):
            db.execute(
                text("UPDATE lotes_stock SET cantidad_disponible = -1 WHERE id = :l"), {"l": lote_id}
            )
        db.rollback()


# -------------------------------------------------------------------- triggers

def test_trigger_lote_sin_caducidad_para_producto_perecedero(datos):
    pid = datos.producto(caducidad=True)
    with SessionLocal() as db:
        db.add(LoteStock(
            producto_id=pid, codigo_lote="SIN_FECHA",
            costo_unitario=D("1"), cantidad_disponible=D("1"), fecha_caducidad=None,
        ))
        with pytest.raises(DBAPIError, match="requiere obligatoriamente una fecha de caducidad"):
            db.flush()
        db.rollback()
    # con fecha, el mismo producto sí acepta el lote
    datos.lote(pid, "CON_FECHA", "1", caduca=HOY + timedelta(days=30))


def test_trigger_devolucion_acumulada_supera_lo_vendido(datos):
    pid = datos.producto(caducidad=False)
    datos.lote(pid, "L1", "10")
    venta = datos.vender(pid, 3)
    with SessionLocal() as db:
        detalle_id = db.scalar(select(DetalleVenta.id).where(DetalleVenta.venta_id == venta.id))

    def devolver(db, cantidad):
        db.add(Devolucion(
            venta_id=venta.id, detalle_venta_id=detalle_id, cantidad=D(cantidad),
            motivo="prueba", usuario_id=datos.usuario_id,
        ))
        db.flush()

    with SessionLocal() as db:
        devolver(db, 2)          # 2 <= 3 ok
        db.commit()
    with SessionLocal() as db:
        with pytest.raises(DBAPIError, match="supera lo vendido"):
            devolver(db, 2)      # acumulado 4 > 3
        db.rollback()
    with SessionLocal() as db:
        devolver(db, 1)          # acumulado 3 == 3 ok (borde)
        db.commit()
        assert db.scalar(
            text("SELECT SUM(cantidad) FROM devoluciones WHERE detalle_venta_id = :d"),
            {"d": detalle_id},
        ) == D("3")


# ----------------------------------------------------------------- FEFO / FIFO

def test_fefo_perecedero_toma_caducidad_mas_cercana(datos):
    pid = datos.producto(caducidad=True)
    # el lote que caduca antes se recibió DESPUÉS: FEFO debe ganarle a FIFO
    datos.lote(pid, "LEJANO", "5", caduca=HOY + timedelta(days=90), recibido=AHORA - timedelta(days=20))
    datos.lote(pid, "SIN_FECHA_LIMITE", "5", caduca=HOY + timedelta(days=400), recibido=AHORA - timedelta(days=30))
    datos.lote(pid, "CERCANO", "5", caduca=HOY + timedelta(days=10), recibido=AHORA - timedelta(days=1))

    venta = datos.vender(pid, 2)
    assert codigos_despachados(venta.id) == [("CERCANO", D("2.000"))]

    # al agotarse el cercano, desborda al siguiente por caducidad (no por recepción)
    venta2 = datos.vender(pid, 5)
    assert codigos_despachados(venta2.id) == [("CERCANO", D("3.000")), ("LEJANO", D("2.000"))]


def test_fifo_sin_caducidad_toma_lote_mas_antiguo(datos):
    pid = datos.producto(caducidad=False)
    datos.lote(pid, "NUEVO", "5", recibido=AHORA - timedelta(days=1))
    datos.lote(pid, "VIEJO", "5", recibido=AHORA - timedelta(days=20))
    datos.lote(pid, "MEDIO", "5", recibido=AHORA - timedelta(days=10))

    venta = datos.vender(pid, 7)
    assert codigos_despachados(venta.id) == [("VIEJO", D("5.000")), ("MEDIO", D("2.000"))]


# ------------------------------------------------- cancelaciones y devoluciones

def stock(lote_id):
    with SessionLocal() as db:
        return db.get(LoteStock, lote_id).cantidad_disponible


def movs(pid, tipo):
    with SessionLocal() as db:
        return db.scalars(
            select(MovimientoInventario.cantidad).where(
                MovimientoInventario.producto_id == pid, MovimientoInventario.tipo == tipo
            )
        ).all()


def detalle_de(venta_id):
    with SessionLocal() as db:
        return db.scalar(select(DetalleVenta.id).where(DetalleVenta.venta_id == venta_id))


def devolver(datos, venta_id, detalle_id, cantidad, reingreso):
    with SessionLocal() as db:
        return registrar_devolucion(
            db,
            DevolucionCreate(
                venta_id=venta_id, detalle_venta_id=detalle_id, cantidad=cantidad,
                motivo="prueba", reingreso_a_stock=reingreso,
            ),
            datos.usuario_id,
        )


def test_cancelar_repone_stock_y_registra_movimientos(datos):
    pid = datos.producto(caducidad=False)
    lote_id = datos.lote(pid, "L1", "10")
    venta = datos.vender(pid, 4)
    assert stock(lote_id) == D("6")
    with SessionLocal() as db:
        v = cancelar_venta(db, venta.id, "cliente se arrepintió", datos.usuario_id)
        assert v.estado == "CANCELADA" and v.motivo_cancelacion == "cliente se arrepintió"
    assert stock(lote_id) == D("10")
    assert movs(pid, "CANCELACION_VENTA") == [D("4.000")]
    with SessionLocal() as db, pytest.raises(VentaYaCancelada):
        cancelar_venta(db, venta.id, "otra vez", datos.usuario_id)
    assert stock(lote_id) == D("10")


def test_cancelar_no_repone_lo_ya_devuelto(datos):
    pid = datos.producto(caducidad=False)
    lote_id = datos.lote(pid, "L1", "10")
    venta = datos.vender(pid, 4)
    det = detalle_de(venta.id)
    devolver(datos, venta.id, det, 1, True)    # reingresa: stock 7
    devolver(datos, venta.id, det, 1, False)   # merma física: stock sigue 7
    assert stock(lote_id) == D("7")
    with SessionLocal() as db:
        cancelar_venta(db, venta.id, "error de captura", datos.usuario_id)
    assert stock(lote_id) == D("9")  # solo repone 4 - 2
    assert movs(pid, "CANCELACION_VENTA") == [D("2.000")]


def test_devolucion_con_y_sin_reingreso(datos):
    pid = datos.producto(caducidad=False)
    lote_id = datos.lote(pid, "L1", "10")
    venta = datos.vender(pid, 5)
    det = detalle_de(venta.id)
    devolver(datos, venta.id, det, 2, True)
    assert stock(lote_id) == D("7")
    assert movs(pid, "DEVOLUCION_STOCK") == [D("2.000")]
    devolver(datos, venta.id, det, 1, False)
    assert stock(lote_id) == D("7")  # la defectuosa no cambia el stock
    # Sin reingreso la devolucion tambien queda en el Kardex, seguida de su merma
    assert movs(pid, "DEVOLUCION_STOCK") == [D("2.000"), D("1.000")]
    assert movs(pid, "MERMA") == [D("1.000")]


def test_consulta_por_folio_trae_lo_devuelto_por_renglon(datos):
    pid = datos.producto(caducidad=False)
    datos.lote(pid, "L1", "10")
    venta = datos.vender(pid, 5)
    det = detalle_de(venta.id)
    devolver(datos, venta.id, det, 2, True)
    with SessionLocal() as db:
        for folio in (venta.folio, f"#{venta.folio.lower()}", f"Ticket #{venta.folio}"):
            r = consultar_venta_por_folio(db, folio)
            assert r.id == venta.id
        (item,) = r.items
        assert (item.cantidad, item.cantidad_devuelta, item.cantidad_disponible) == (D("5"), D("2"), D("3"))
        assert item.codigo_lote == "L1"
        with pytest.raises(VentaNoEncontrada):
            consultar_venta_por_folio(db, "V-NO-EXISTE")


def test_devolucion_sin_reingreso_deja_entrada_y_merma_en_el_kardex(datos):
    pid = datos.producto(caducidad=False)
    lote_id = datos.lote(pid, "L1", "10")  # costo_unitario 4.00
    venta = datos.vender(pid, 5)
    det = detalle_de(venta.id)
    assert stock(lote_id) == D("5")

    devolver(datos, venta.id, det, 2, False)

    assert stock(lote_id) == D("5")  # +2 y -2: el neto del lote no cambia
    assert movs(pid, "DEVOLUCION_STOCK") == [D("2.000")]
    assert movs(pid, "MERMA") == [D("2.000")]
    with SessionLocal() as db:
        (merma,) = db.scalars(select(Merma).where(Merma.lote_id == lote_id)).all()
        mov_merma = db.scalar(select(MovimientoInventario).where(MovimientoInventario.merma_id == merma.id))
        assert mov_merma.tipo == "MERMA" and mov_merma.lote_id == lote_id and mov_merma.cantidad == D("2")
        mov_dev = db.scalar(
            select(MovimientoInventario).where(
                MovimientoInventario.producto_id == pid, MovimientoInventario.tipo == "DEVOLUCION_STOCK"
            )
        )
        assert mov_dev.lote_id == lote_id and mov_dev.devolucion_id is not None
        assert mov_dev.id < mov_merma.id  # entra primero, sale despues
        assert merma.motivo == "DEVOLUCION_DEFECTUOSA"
        assert merma.cantidad == D("2")
        assert merma.costo_unitario_perdida == D("4.00")
        assert merma.producto_id == pid
        assert merma.usuario_id == datos.usuario_id
        assert venta.folio in merma.descripcion and "prueba" in merma.descripcion
    # Cuenta como devuelto: ya no se puede devolver mas de lo vendido
    with SessionLocal() as db:
        (item,) = consultar_venta_por_folio(db, venta.folio).items
        assert (item.cantidad_devuelta, item.cantidad_disponible) == (D("2"), D("3"))


def test_kardex_proyecta_el_saldo_de_la_devolucion_sin_reingreso(datos):
    pid = datos.producto(caducidad=False)
    datos.lote(pid, "L1", "10")
    venta = datos.vender(pid, 5)
    devolver(datos, venta.id, detalle_de(venta.id), 2, False)
    with SessionLocal() as db:
        filas = kardex(
            db=db, _user=None, producto_id=pid, lote_id=None, tipo_movimiento=None, tipo=None,
            fecha_inicio=None, fecha_fin=None, desde=None, hasta=None, q=None,
            limite=100, desplazamiento=0,
        )
    # Del mas reciente al mas antiguo: MERMA, DEVOLUCION_STOCK, VENTA
    assert [f.tipo for f in filas] == ["MERMA", "DEVOLUCION_STOCK", "VENTA"]
    merma, devolucion, venta_mov = filas
    assert devolucion.saldo_resultante == venta_mov.saldo_resultante + D("2")
    assert merma.saldo_resultante == venta_mov.saldo_resultante  # vuelve al saldo previo a la devolucion
    assert devolucion.folio_documento == venta.folio
    assert merma.motivo_legible.startswith("Devolución defectuosa")


def test_devolucion_con_reingreso_no_crea_merma(datos):
    pid = datos.producto(caducidad=False)
    lote_id = datos.lote(pid, "L1", "10")
    venta = datos.vender(pid, 5)
    devolver(datos, venta.id, detalle_de(venta.id), 2, True)
    with SessionLocal() as db:
        assert db.scalars(select(Merma).where(Merma.lote_id == lote_id)).all() == []


def test_devolucion_excedida_la_rechaza_la_bd_y_hace_rollback(datos):
    pid = datos.producto(caducidad=False)
    lote_id = datos.lote(pid, "L1", "10")
    venta = datos.vender(pid, 3)
    det = detalle_de(venta.id)
    devolver(datos, venta.id, det, 2, True)
    with pytest.raises(DevolucionExcedida, match="supera lo vendido"):
        devolver(datos, venta.id, det, 2, True)  # acumulado 4 > 3
    assert stock(lote_id) == D("9")
    assert movs(pid, "DEVOLUCION_STOCK") == [D("2.000")]
    with SessionLocal() as db:
        assert db.scalar(
            text("SELECT SUM(cantidad) FROM devoluciones WHERE detalle_venta_id = :d"), {"d": det}
        ) == D("2")


def test_devolucion_rechazada_en_venta_cancelada_o_detalle_ajeno(datos):
    pid = datos.producto(caducidad=False)
    datos.lote(pid, "L1", "10")
    v1, v2 = datos.vender(pid, 2), datos.vender(pid, 2)
    with pytest.raises(DevolucionError, match="no pertenece"):
        devolver(datos, v1.id, detalle_de(v2.id), 1, True)
    with SessionLocal() as db:
        cancelar_venta(db, v1.id, "x", datos.usuario_id)
    with pytest.raises(DevolucionError, match="cancelada"):
        devolver(datos, v1.id, detalle_de(v1.id), 1, True)


# ------------------------------------------------------ rendimiento de consultas

def _contar_sentencias(accion):
    """Ejecuta `accion` y devuelve (resultado, sentencias SQL emitidas)."""
    from sqlalchemy import event

    sentencias: list[str] = []

    def registrar(conn, cursor, statement, *a):
        sentencias.append(statement)

    event.listen(engine, "before_cursor_execute", registrar)
    try:
        resultado = accion()
    finally:
        event.remove(engine, "before_cursor_execute", registrar)
    return resultado, sentencias


def test_consulta_por_folio_no_hace_n_mas_1(datos):
    def folio_de_venta(n_renglones):
        items, pagos_total = [], D(0)
        for _ in range(n_renglones):
            pid = datos.producto(caducidad=False)
            datos.lote(pid, "L", "5")
            items.append({"producto_id": pid, "cantidad": 1})
            pagos_total += D("10.00")
        payload = VentaCreate(
            cliente_id=datos.cliente_id, items=items,
            pagos=[{"metodo": "EFECTIVO", "importe": pagos_total, "pago_con": pagos_total, "cambio": 0}],
        )
        with SessionLocal() as db:
            return crear_venta(db, payload, datos.usuario_id).folio

    def consultar(folio):
        with SessionLocal() as db:  # sesión nueva: nada en el mapa de identidad
            return consultar_venta_por_folio(db, folio)

    folio_chico, folio_grande = folio_de_venta(1), folio_de_venta(6)
    chica, sql_chica = _contar_sentencias(lambda: consultar(folio_chico))
    grande, sql_grande = _contar_sentencias(lambda: consultar(folio_grande))
    assert len(chica.items) == 1 and len(grande.items) == 6
    assert {i.nombre_producto for i in grande.items}  # el producto llegó sin lazy-load fallido
    # venta + detalles + productos + lotes + devuelto: constante, no crece con los renglones
    assert len(sql_grande) == len(sql_chica) <= 5, sql_grande


def test_dashboard_filtra_por_rango_y_respeta_los_limites_del_dia(datos):
    from app.api.routers.dashboard import _ventas_entre, _ventas_por_dia

    with SessionLocal() as db:
        hoy = db.scalar(text("SELECT current_date"))
        base_hoy = _ventas_entre(db, hoy, hoy + timedelta(days=1))
        base_manana = _ventas_entre(db, hoy + timedelta(days=1), hoy + timedelta(days=2))
        base_dias = {d.fecha: d.total for d in _ventas_por_dia(db, hoy, dias=7)}

    pid = datos.producto(caducidad=False)
    datos.lote(pid, "L", "20")
    ids = []
    for cantidad in (1, 2, 3):  # totales 10, 20 y 30
        with SessionLocal() as db:
            ids.append(crear_venta(db, datos.venta_payload(pid, cantidad), datos.usuario_id).id)
    inicio = "date_trunc('day', now())"
    with SessionLocal() as db, db.begin():
        for venta_id, fecha in zip(
            ids,
            (inicio, f"{inicio} - interval '1 second'", f"{inicio} + interval '1 day'"),
        ):
            db.execute(text(f"UPDATE ventas SET fecha_venta = {fecha} WHERE id = :i"), {"i": venta_id})

    with SessionLocal() as db:
        # 00:00:00 de hoy entra en hoy; 23:59:59 de ayer no; 00:00:00 de mañana es de mañana
        assert _ventas_entre(db, hoy, hoy + timedelta(days=1)) - base_hoy == D("10.00")
        assert _ventas_entre(db, hoy + timedelta(days=1), hoy + timedelta(days=2)) - base_manana == D("30.00")
        dias = {d.fecha: d.total for d in _ventas_por_dia(db, hoy, dias=7)}
    assert dias[hoy] - base_dias[hoy] == D("10.00")
    assert dias[hoy - timedelta(days=1)] - base_dias[hoy - timedelta(days=1)] == D("20.00")
    assert hoy + timedelta(days=1) not in dias  # la ventana termina hoy


def test_dashboard_no_usa_func_date_en_el_filtro():
    from app.api.routers.dashboard import _ventas_entre, _ventas_por_dia

    with SessionLocal() as db:
        hoy = db.scalar(text("SELECT current_date"))
        _, sql = _contar_sentencias(
            lambda: (_ventas_entre(db, hoy, hoy), _ventas_por_dia(db, hoy, dias=7))
        )
    for sentencia in sql:
        donde = sentencia.split("WHERE", 1)[-1].split("GROUP BY", 1)[0].lower()
        assert "date(" not in donde, sentencia
        assert "ventas.fecha_venta >=" in donde
