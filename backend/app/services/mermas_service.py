from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import LoteStock, Merma, MovimientoInventario, Producto
from app.schemas.inventario import MermaCreate


class MermaError(Exception):
    pass


class StockInsuficiente(MermaError):
    pass


def registrar_merma(db: Session, data: MermaCreate, usuario_id: int) -> Merma:
    """Única frontera transaccional: un commit al final, rollback ante cualquier error."""
    try:
        merma = _registrar_merma(db, data, usuario_id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return merma


def _registrar_merma(db: Session, data: MermaCreate, usuario_id: int) -> Merma:
    producto = db.get(Producto, data.producto_id)
    if producto is None:
        raise MermaError(f"Producto {data.producto_id} inexistente")
    if not producto.permite_decimales and data.cantidad != data.cantidad.to_integral_value():
        raise MermaError(f"Producto {data.producto_id} no admite cantidades decimales")

    # Se permite mermar lotes inactivos o vencidos: es justo el caso de CADUCIDAD
    lote = db.scalar(
        select(LoteStock)
        .where(LoteStock.id == data.lote_id, LoteStock.producto_id == data.producto_id)
        .with_for_update()
    )
    if lote is None:
        raise MermaError(
            f"Lote {data.lote_id} inexistente o no pertenece al producto {data.producto_id}"
        )
    if lote.cantidad_disponible < data.cantidad:
        raise StockInsuficiente(
            f"Lote {lote.codigo_lote}: solo hay {lote.cantidad_disponible} disponibles, "
            f"se pidió {data.cantidad}"
        )

    lote.cantidad_disponible -= data.cantidad
    merma = Merma(
        producto_id=data.producto_id,
        lote_id=lote.id,
        cantidad=data.cantidad,
        costo_unitario_perdida=lote.costo_unitario,
        motivo=data.motivo,
        descripcion=data.descripcion,
        usuario_id=usuario_id,
    )
    db.add(merma)
    db.flush()

    db.add(
        MovimientoInventario(
            producto_id=merma.producto_id,
            lote_id=merma.lote_id,
            tipo="MERMA",
            cantidad=merma.cantidad,
            usuario_id=usuario_id,
            motivo=data.motivo,
            merma_id=merma.id,
        )
    )
    return merma
