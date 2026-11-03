from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.types import money, now_tz, pk, qty

if TYPE_CHECKING:
    from app.models.catalogo import LoteStock, Producto
    from app.models.inventario import MovimientoInventario
    from app.models.personas import Proveedor, Usuario


class Compra(Base):
    __tablename__ = "compras"
    __table_args__ = (
        CheckConstraint("estado IN ('RECIBIDA', 'CANCELADA')"),
        CheckConstraint("total >= 0"),
        Index("idx_compras_proveedor_id", "proveedor_id"),
    )

    id: Mapped[pk]
    # Consecutivo interno que asigna el sistema (COM-2026-00001); nadie lo teclea
    folio: Mapped[str] = mapped_column(String(30), unique=True)
    # Factura o remision que trae el repartidor
    factura_proveedor: Mapped[str | None] = mapped_column(String(60))
    proveedor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("proveedores.id", ondelete="RESTRICT")
    )
    usuario_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("usuarios.id", ondelete="RESTRICT")
    )
    estado: Mapped[str] = mapped_column(String(20), server_default="RECIBIDA")
    total: Mapped[money]
    fecha_compra: Mapped[now_tz]

    proveedor: Mapped["Proveedor"] = relationship(back_populates="compras")
    usuario: Mapped["Usuario"] = relationship(back_populates="compras")
    detalles: Mapped[list["DetalleCompra"]] = relationship(back_populates="compra")

    @property
    def proveedor_nombre(self) -> str:
        return self.proveedor.razon_social

    @property
    def usuario_nombre(self) -> str:
        return self.usuario.nombre


class DetalleCompra(Base):
    __tablename__ = "detalle_compras"
    __table_args__ = (
        CheckConstraint("cantidad > 0"),
        CheckConstraint("costo_unitario >= 0"),
        CheckConstraint("subtotal >= 0"),
        ForeignKeyConstraint(
            ["lote_id", "producto_id"],
            ["lotes_stock.id", "lotes_stock.producto_id"],
            name="fk_detalle_compras_lote_producto",
        ),
        UniqueConstraint("id", "compra_id", name="uq_detalle_compras_id_compra"),
        Index("idx_detalle_compras_compra_id", "compra_id"),
    )

    id: Mapped[pk]
    compra_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("compras.id", ondelete="RESTRICT")
    )
    producto_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("productos.id", ondelete="RESTRICT")
    )
    lote_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lotes_stock.id", ondelete="RESTRICT")
    )
    cantidad: Mapped[qty]
    costo_unitario: Mapped[money]
    subtotal: Mapped[money]

    compra: Mapped[Compra] = relationship(back_populates="detalles")
    producto: Mapped["Producto"] = relationship()
    lote: Mapped["LoteStock"] = relationship(
        back_populates="detalles_compra", foreign_keys=[lote_id]
    )
    movimientos: Mapped[list["MovimientoInventario"]] = relationship(
        back_populates="detalle_compra"
    )

    @property
    def nombre_producto(self) -> str:
        return self.producto.nombre

    @property
    def codigo_lote(self) -> str:
        return self.lote.codigo_lote
