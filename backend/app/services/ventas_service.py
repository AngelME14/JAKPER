import uuid
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.models import (
    Cliente,
    DetalleVenta,
    Devolucion,
    LoteStock,
    Merma,
    MovimientoInventario,
    Pago,
    Producto,
    Venta,
)
from app.schemas.ventas import (
    DetalleDevolvibleResponse,
    DevolucionCreate,
    VentaCreate,
    VentaDevolucionResponse,
)

CENTAVO = Decimal("0.01")
# Motivo de la merma que nace de una devolución sin reingreso (ver main.py: mermas_motivo_check)
MOTIVO_MERMA_DEVOLUCION = "DEVOLUCION_DEFECTUOSA"


class VentaError(Exception):
    pass


class StockInsuficiente(VentaError):
    pass


class VentaNoEncontrada(VentaError):
    pass


class VentaYaCancelada(VentaError):
    pass


class DevolucionError(VentaError):
    pass


class DevolucionExcedida(DevolucionError):
    """La BD (trg_verificar_devolucion_acumulada) rechazó superar lo vendido."""


class LoteVencido(StockInsuficiente):
    """El faltante está en lotes caducados: deben pasar por mermas antes de vender."""


def crear_venta(db: Session, data: VentaCreate, usuario_id: int) -> Venta:
    """Única frontera transaccional: un commit al final, rollback ante cualquier error."""
    try:
        venta = _registrar_venta(db, data, usuario_id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return venta


def _registrar_venta(db: Session, data: VentaCreate, usuario_id: int) -> Venta:
    cliente = db.get(Cliente, data.cliente_id)
    if cliente is None or not cliente.activo:
        raise VentaError("Cliente inexistente o inactivo")

    pedido: dict[int, Decimal] = {}
    for item in data.items:
        pedido[item.producto_id] = pedido.get(item.producto_id, Decimal(0)) + item.cantidad

    # Orden estable por producto_id: dos ventas concurrentes bloquean en el mismo orden
    salidas: list[tuple[Producto, LoteStock, Decimal]] = []
    for producto_id in sorted(pedido):
        salidas += _despachar(db, producto_id, pedido[producto_id])

    lineas = [
        (producto, lote, cantidad, (cantidad * producto.precio_venta).quantize(CENTAVO, ROUND_HALF_UP))
        for producto, lote, cantidad in salidas
    ]
    total = sum((subtotal for *_, subtotal in lineas), Decimal(0))
    _validar_pagos(data, total)

    venta = Venta(
        folio=f"V-{datetime.now():%Y%m%d%H%M%S}-{uuid.uuid4().hex[:6].upper()}",
        cliente_id=data.cliente_id,
        usuario_id=usuario_id,
        subtotal=total,
        total=total,
    )
    db.add(venta)
    db.flush()

    detalles = [
        DetalleVenta(
            venta_id=venta.id,
            producto_id=producto.id,
            lote_id=lote.id,
            cantidad=cantidad,
            precio_unitario_aplicado=producto.precio_venta,
            costo_unitario_aplicado=lote.costo_unitario,
            subtotal=subtotal,
        )
        for producto, lote, cantidad, subtotal in lineas
    ]
    db.add_all(detalles)
    db.flush()

    db.add_all(
        Pago(
            venta_id=venta.id,
            metodo=p.metodo,
            importe=p.importe,
            pago_con=p.pago_con,
            cambio=p.cambio,
            referencia=p.referencia,
        )
        for p in data.pagos
    )
    db.add_all(
        MovimientoInventario(
            producto_id=d.producto_id,
            lote_id=d.lote_id,
            tipo="VENTA",
            cantidad=d.cantidad,
            usuario_id=usuario_id,
            detalle_venta_id=d.id,
        )
        for d in detalles
    )
    return venta


def _despachar(db: Session, producto_id: int, cantidad: Decimal):
    """FEFO si el producto requiere caducidad, FIFO si no. Bloquea los lotes con FOR UPDATE."""
    producto = db.get(Producto, producto_id)
    if producto is None or not producto.activo:
        raise VentaError(f"Producto {producto_id} inexistente o inactivo")
    if not producto.permite_decimales and cantidad != cantidad.to_integral_value():
        raise VentaError(f"Producto {producto_id} no admite cantidades decimales")

    if producto.requiere_caducidad:
        orden = (LoteStock.fecha_caducidad.asc().nulls_last(), LoteStock.fecha_recepcion.asc())
    else:
        orden = (LoteStock.fecha_recepcion.asc(),)

    todos = db.scalars(
        select(LoteStock)
        .where(
            LoteStock.producto_id == producto_id,
            LoteStock.activo.is_(True),
            LoteStock.cantidad_disponible > 0,
        )
        .order_by(*orden)
        .with_for_update()
    ).all()
    hoy = date.today()
    vencidos = [l for l in todos if l.fecha_caducidad is not None and l.fecha_caducidad < hoy]
    lotes = [l for l in todos if l not in vencidos]

    salidas = []
    restante = cantidad
    for lote in lotes:
        if restante == 0:
            break
        tomar = min(lote.cantidad_disponible, restante)
        lote.cantidad_disponible -= tomar
        restante -= tomar
        salidas.append((producto, lote, tomar))
    if restante > 0 and vencidos:
        detalle = ", ".join(
            f"{l.codigo_lote} (venció {l.fecha_caducidad}, {l.cantidad_disponible} en existencia)"
            for l in vencidos
        )
        raise LoteVencido(
            f"Producto {producto_id}: faltan {restante} y el inventario restante está vencido: "
            f"{detalle}. Registre el lote en mermas (motivo CADUCIDAD) antes de despachar."
        )
    if restante > 0:
        raise StockInsuficiente(
            f"Stock insuficiente para producto {producto_id}: faltan {restante}"
        )
    return salidas


def _validar_pagos(data: VentaCreate, total: Decimal) -> None:
    if sum((p.importe for p in data.pagos), Decimal(0)) != total:
        raise VentaError(f"La suma de pagos no coincide con el total {total}")
    for p in data.pagos:
        cambio = p.pago_con - p.importe if p.pago_con is not None else Decimal(0)
        if p.cambio != cambio:
            raise VentaError(f"Cambio incorrecto: esperado {cambio}")


def cancelar_venta(db: Session, venta_id: int, motivo: str, usuario_id: int) -> Venta:
    """Única frontera transaccional: un commit al final, rollback ante cualquier error."""
    try:
        venta = _cancelar_venta(db, venta_id, motivo, usuario_id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return venta


def _cancelar_venta(db: Session, venta_id: int, motivo: str, usuario_id: int) -> Venta:
    venta = db.scalar(select(Venta).where(Venta.id == venta_id).with_for_update())
    if venta is None:
        raise VentaNoEncontrada(f"Venta {venta_id} inexistente")
    if venta.estado == "CANCELADA":
        raise VentaYaCancelada(f"La venta {venta.folio} ya está cancelada")

    detalles = db.scalars(
        select(DetalleVenta).where(DetalleVenta.venta_id == venta_id).order_by(DetalleVenta.id)
    ).all()
    # Lotes bloqueados en orden de id: orden estable, sin deadlocks entre cancelaciones
    lotes = {
        l.id: l
        for l in db.scalars(
            select(LoteStock)
            .where(LoteStock.id.in_({d.lote_id for d in detalles}))
            .order_by(LoteStock.id)
            .with_for_update()
        )
    }
    # Lo ya devuelto (con o sin reingreso) no vuelve a reponerse: lo reingresado ya está
    # en el lote y lo no reingresado se declaró pérdida física.
    devuelto = dict(
        db.execute(
            select(Devolucion.detalle_venta_id, func.sum(Devolucion.cantidad))
            .where(Devolucion.venta_id == venta_id)
            .group_by(Devolucion.detalle_venta_id)
        ).all()
    )

    for d in detalles:
        reponer = d.cantidad - devuelto.get(d.id, Decimal(0))
        if reponer <= 0:
            continue
        lotes[d.lote_id].cantidad_disponible += reponer
        db.add(
            MovimientoInventario(
                producto_id=d.producto_id,
                lote_id=d.lote_id,
                tipo="CANCELACION_VENTA",
                cantidad=reponer,
                usuario_id=usuario_id,
                motivo=motivo,
                detalle_venta_id=d.id,
            )
        )
    venta.estado = "CANCELADA"
    venta.motivo_cancelacion = motivo
    db.flush()
    return venta


def registrar_devolucion(db: Session, data: DevolucionCreate, usuario_id: int) -> Devolucion:
    """Única frontera transaccional: un commit al final, rollback ante cualquier error.

    El límite acumulado lo impone el trigger de la BD; aquí solo se traduce su error.
    """
    try:
        dev = _registrar_devolucion(db, data, usuario_id)
        db.commit()
    except DBAPIError as e:
        db.rollback()  # tras un error de BD la transacción PG queda abortada
        if getattr(e.orig, "pgcode", None) == "P0001" and "supera lo vendido" in str(e.orig):
            raise DevolucionExcedida(str(e.orig).splitlines()[0]) from e
        raise
    except Exception:
        db.rollback()
        raise
    return dev


def _registrar_devolucion(db: Session, data: DevolucionCreate, usuario_id: int) -> Devolucion:
    # Orden de bloqueo venta -> detalle -> lote, compatible con cancelar (venta -> lotes)
    venta = db.scalar(select(Venta).where(Venta.id == data.venta_id).with_for_update())
    if venta is None:
        raise VentaNoEncontrada(f"Venta {data.venta_id} inexistente")
    if venta.estado == "CANCELADA":
        raise DevolucionError(f"La venta {venta.folio} está cancelada; no admite devoluciones")

    detalle = db.scalar(
        select(DetalleVenta)
        .where(DetalleVenta.id == data.detalle_venta_id, DetalleVenta.venta_id == data.venta_id)
        .with_for_update()
    )
    if detalle is None:
        raise DevolucionError(
            f"El detalle {data.detalle_venta_id} no pertenece a la venta {data.venta_id}"
        )
    if data.cantidad != data.cantidad.to_integral_value() and not detalle.producto.permite_decimales:
        raise DevolucionError(f"Producto {detalle.producto_id} no admite cantidades decimales")

    dev = Devolucion(
        venta_id=data.venta_id,
        detalle_venta_id=data.detalle_venta_id,
        cantidad=data.cantidad,
        motivo=data.motivo,
        reingreso_a_stock=data.reingreso_a_stock,
        usuario_id=usuario_id,
    )
    db.add(dev)
    db.flush()  # dispara trg_verificar_devolucion_acumulada

    lote = db.scalar(select(LoteStock).where(LoteStock.id == detalle.lote_id).with_for_update())
    # La devolución entra al Kardex siempre, con o sin reingreso
    if data.reingreso_a_stock:
        lote.cantidad_disponible += data.cantidad
    db.add(
        MovimientoInventario(
            producto_id=detalle.producto_id,
            lote_id=detalle.lote_id,
            tipo="DEVOLUCION_STOCK",
            cantidad=data.cantidad,
            usuario_id=usuario_id,
            motivo=data.motivo,
            devolucion_id=dev.id,
        )
    )
    db.flush()

    if not data.reingreso_a_stock:
        # Vuelve defectuoso: entra y sale de inmediato por merma. El saldo neto del lote no cambia
        # (+cantidad -cantidad) y el Kardex deja ambos movimientos, en ese orden (fecha, id).
        merma = Merma(
            producto_id=detalle.producto_id,
            lote_id=detalle.lote_id,
            cantidad=data.cantidad,
            costo_unitario_perdida=lote.costo_unitario,
            motivo=MOTIVO_MERMA_DEVOLUCION,
            descripcion=f"Devolución del ticket {venta.folio}: {data.motivo}",
            usuario_id=usuario_id,
        )
        db.add(merma)
        db.flush()
        db.add(
            MovimientoInventario(
                producto_id=detalle.producto_id,
                lote_id=detalle.lote_id,
                tipo="MERMA",
                cantidad=data.cantidad,
                usuario_id=usuario_id,
                motivo=MOTIVO_MERMA_DEVOLUCION,
                merma_id=merma.id,
            )
        )
        db.flush()
    return dev


def consultar_venta_por_folio(db: Session, folio: str) -> VentaDevolucionResponse:
    """Venta con cada renglón y lo devuelto hasta ahora. Acepta el folio con '#' o 'Ticket'."""
    limpio = folio.strip().upper().removeprefix("TICKET").strip().lstrip("#").strip()
    venta = db.scalar(select(Venta).where(Venta.folio == limpio)) if limpio else None
    if venta is None:
        raise VentaNoEncontrada(f"No hay ninguna venta con el folio {folio.strip()}")

    devuelto = dict(
        db.execute(
            select(Devolucion.detalle_venta_id, func.sum(Devolucion.cantidad))
            .where(Devolucion.venta_id == venta.id)
            .group_by(Devolucion.detalle_venta_id)
        ).all()
    )
    items = []
    for d in sorted(venta.detalles, key=lambda x: x.id):
        ya = devuelto.get(d.id, Decimal(0))
        items.append(
            DetalleDevolvibleResponse(
                id=d.id,
                producto_id=d.producto_id,
                nombre_producto=d.nombre_producto,
                codigo_lote=d.codigo_lote,
                permite_decimales=d.producto.permite_decimales,
                cantidad=d.cantidad,
                cantidad_devuelta=ya,
                cantidad_disponible=max(d.cantidad - ya, Decimal(0)),
                precio_unitario_aplicado=d.precio_unitario_aplicado,
                subtotal=d.subtotal,
            )
        )
    return VentaDevolucionResponse(
        id=venta.id,
        folio=venta.folio,
        fecha_venta=venta.fecha_venta,
        total=venta.total,
        estado=venta.estado,
        cliente=venta.cliente,
        usuario=venta.usuario,
        items=items,
    )
