from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session

from app.models import (
    Compra,
    DetalleCompra,
    LoteStock,
    MovimientoInventario,
    Producto,
    Proveedor,
)
from app.schemas.compras import CompraCreate

CENTAVO = Decimal("0.01")

# Llave del candado que serializa la asignacion de folios de compra
_CANDADO_FOLIO_COMPRA = 7_310_001


class CompraError(Exception):
    pass


def _siguiente_folio(db: Session) -> str:
    """COM-<año>-<consecutivo de 5 digitos>, reiniciado cada año.

    El candado de asesoria vive hasta el commit: dos compras simultaneas no pueden leer el mismo
    ultimo numero, asi que el consecutivo no se repite ni tiene huecos por carrera.
    """
    db.execute(select(func.pg_advisory_xact_lock(_CANDADO_FOLIO_COMPRA)))
    prefijo = f"COM-{date.today().year}-"
    ultimo = db.scalar(
        select(func.max(cast(func.substr(Compra.folio, len(prefijo) + 1), Integer))).where(
            Compra.folio.op("~")(f"^{prefijo}[0-9]+$")
        )
    )
    return f"{prefijo}{(ultimo or 0) + 1:05d}"


def registrar_compra(db: Session, data: CompraCreate, usuario_id: int) -> Compra:
    """Única frontera transaccional: un commit al final, rollback ante cualquier error."""
    try:
        compra = _registrar_compra(db, data, usuario_id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return compra


def _registrar_compra(db: Session, data: CompraCreate, usuario_id: int) -> Compra:
    proveedor = db.get(Proveedor, data.proveedor_id)
    if proveedor is None or not proveedor.activo:
        raise CompraError("Proveedor inexistente o inactivo")

    ids = {i.producto_id for i in data.items}
    productos = {
        p.id: p for p in db.scalars(select(Producto).where(Producto.id.in_(ids)))
    }
    fecha_hoy = f"{date.today():%Y%m%d}"
    lotes: list[LoteStock] = []

    for item in data.items:
        producto = productos.get(item.producto_id)
        if producto is None or not producto.activo:
            raise CompraError(f"Producto {item.producto_id} inexistente o inactivo")
        if not producto.permite_decimales and item.cantidad != item.cantidad.to_integral_value():
            raise CompraError(f"Producto {item.producto_id} no admite cantidades decimales")

        codigo_lote = item.codigo_lote.strip() if item.codigo_lote else None
        if producto.requiere_caducidad:
            if not codigo_lote or item.fecha_caducidad is None:
                raise CompraError(
                    f"Producto {item.producto_id} requiere código de lote y fecha de caducidad obligatorios"
                )
            fecha_caducidad = item.fecha_caducidad
        else:
            # Sin control de caducidad no se guarda fecha; el lote se autogenera si no llega uno
            if not codigo_lote:
                codigo_lote = f"AUT-{fecha_hoy}-{producto.id}"
            fecha_caducidad = None

        lotes.append(
            LoteStock(
                producto_id=item.producto_id,
                codigo_lote=codigo_lote,
                fecha_caducidad=fecha_caducidad,
                costo_unitario=item.costo_unitario,
                cantidad_disponible=item.cantidad,
            )
        )

    db.add_all(lotes)
    db.flush()

    detalles = [
        DetalleCompra(
            producto_id=i.producto_id,
            lote_id=lote.id,
            cantidad=i.cantidad,
            costo_unitario=i.costo_unitario,
            subtotal=(i.cantidad * i.costo_unitario).quantize(CENTAVO, ROUND_HALF_UP),
        )
        for i, lote in zip(data.items, lotes)
    ]
    compra = Compra(
        folio=_siguiente_folio(db),
        factura_proveedor=data.factura_proveedor,
        proveedor_id=data.proveedor_id,
        usuario_id=usuario_id,
        total=sum((d.subtotal for d in detalles), Decimal(0)),
        detalles=detalles,
    )
    db.add(compra)
    db.flush()

    db.add_all(
        MovimientoInventario(
            producto_id=d.producto_id,
            lote_id=d.lote_id,
            tipo="ENTRADA_COMPRA",
            cantidad=d.cantidad,
            usuario_id=usuario_id,
            detalle_compra_id=d.id,
        )
        for d in detalles
    )
    return compra
