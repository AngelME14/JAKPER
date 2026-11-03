from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.types import money, now_tz, pk, qty

if TYPE_CHECKING:
    from app.models.catalogo import LoteStock, Producto
    from app.models.compras import DetalleCompra
    from app.models.personas import Usuario
    from app.models.ventas import DetalleVenta, Devolucion


class Merma(Base):
    __tablename__ = "mermas"
    __table_args__ = (
        CheckConstraint("cantidad > 0"),
        CheckConstraint("costo_unitario_perdida >= 0"),
        CheckConstraint(
            "motivo IN ('CADUCIDAD', 'ROTURA_DAÑO', 'CONSUMO_INTERNO_TIENDA', 'DEVOLUCION_DEFECTUOSA')"
        ),
        ForeignKeyConstraint(
            ["lote_id", "producto_id"],
            ["lotes_stock.id", "lotes_stock.producto_id"],
            name="fk_mermas_lote_producto",
        ),
        Index("idx_mermas_lote_id", "lote_id"),
    )

    id: Mapped[pk]
    producto_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("productos.id", ondelete="RESTRICT")
    )
    lote_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lotes_stock.id", ondelete="RESTRICT")
    )
    cantidad: Mapped[qty]
    costo_unitario_perdida: Mapped[money]
    motivo: Mapped[str] = mapped_column(String(30))
    descripcion: Mapped[str | None] = mapped_column(Text)
    usuario_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("usuarios.id", ondelete="RESTRICT")
    )
    fecha: Mapped[now_tz]

    producto: Mapped["Producto"] = relationship()
    lote: Mapped["LoteStock"] = relationship(
        back_populates="mermas", foreign_keys=[lote_id]
    )
    usuario: Mapped["Usuario"] = relationship()
    movimientos: Mapped[list["MovimientoInventario"]] = relationship(
        back_populates="merma"
    )


class MovimientoInventario(Base):
    __tablename__ = "movimientos_inventario"
    __table_args__ = (
        CheckConstraint(
            "tipo IN ('ENTRADA_COMPRA', 'VENTA', 'CANCELACION_VENTA', 'MERMA', "
            "'DEVOLUCION_STOCK', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA')"
        ),
        CheckConstraint("cantidad > 0"),
        ForeignKeyConstraint(
            ["lote_id", "producto_id"],
            ["lotes_stock.id", "lotes_stock.producto_id"],
            name="fk_movimientos_lote_producto",
        ),
        CheckConstraint(
            "(tipo = 'ENTRADA_COMPRA' AND detalle_compra_id IS NOT NULL AND detalle_venta_id IS NULL AND merma_id IS NULL AND devolucion_id IS NULL) OR "
            "(tipo IN ('VENTA', 'CANCELACION_VENTA') AND detalle_venta_id IS NOT NULL AND detalle_compra_id IS NULL AND merma_id IS NULL AND devolucion_id IS NULL) OR "
            "(tipo = 'MERMA' AND merma_id IS NOT NULL AND detalle_compra_id IS NULL AND detalle_venta_id IS NULL AND devolucion_id IS NULL) OR "
            "(tipo = 'DEVOLUCION_STOCK' AND devolucion_id IS NOT NULL AND detalle_compra_id IS NULL AND detalle_venta_id IS NULL AND merma_id IS NULL) OR "
            "(tipo IN ('AJUSTE_ENTRADA', 'AJUSTE_SALIDA') AND motivo IS NOT NULL AND detalle_compra_id IS NULL AND detalle_venta_id IS NULL AND merma_id IS NULL AND devolucion_id IS NULL)",
            name="chk_movimiento_origen",
        ),
        Index("idx_movimientos_producto_lote", "producto_id", "lote_id"),
    )

    id: Mapped[pk]
    producto_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("productos.id", ondelete="RESTRICT")
    )
    lote_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lotes_stock.id", ondelete="RESTRICT")
    )
    tipo: Mapped[str] = mapped_column(String(30))
    cantidad: Mapped[qty]
    usuario_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("usuarios.id", ondelete="RESTRICT")
    )
    motivo: Mapped[str | None] = mapped_column(Text)
    detalle_compra_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("detalle_compras.id", ondelete="RESTRICT")
    )
    detalle_venta_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("detalle_ventas.id", ondelete="RESTRICT")
    )
    merma_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("mermas.id", ondelete="RESTRICT")
    )
    devolucion_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("devoluciones.id", ondelete="RESTRICT")
    )
    fecha: Mapped[now_tz]

    producto: Mapped["Producto"] = relationship()
    lote: Mapped["LoteStock"] = relationship(
        back_populates="movimientos", foreign_keys=[lote_id]
    )
    usuario: Mapped["Usuario"] = relationship()
    detalle_compra: Mapped["DetalleCompra | None"] = relationship(
        back_populates="movimientos"
    )
    detalle_venta: Mapped["DetalleVenta | None"] = relationship(
        back_populates="movimientos"
    )
    merma: Mapped[Merma | None] = relationship(back_populates="movimientos")
    devolucion: Mapped["Devolucion | None"] = relationship(
        back_populates="movimientos"
    )
