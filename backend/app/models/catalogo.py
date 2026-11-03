from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    false,
    text,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.types import money, now_tz, pk

if TYPE_CHECKING:
    from app.models.compras import DetalleCompra
    from app.models.inventario import Merma, MovimientoInventario
    from app.models.ventas import DetalleVenta


class Categoria(Base):
    __tablename__ = "categorias"

    id: Mapped[pk]
    nombre: Mapped[str] = mapped_column(String(80), unique=True)
    creado_en: Mapped[now_tz]

    productos: Mapped[list["Producto"]] = relationship(back_populates="categoria")


class Producto(Base):
    __tablename__ = "productos"
    __table_args__ = (
        CheckConstraint("precio_venta >= 0"),
        CheckConstraint("stock_minimo >= 0"),
        Index("idx_productos_categoria_id", "categoria_id"),
        Index(
            "idx_productos_nombre_trgm",
            "nombre",
            postgresql_using="gin",
            postgresql_ops={"nombre": "gin_trgm_ops"},
        ),
    )

    id: Mapped[pk]
    categoria_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("categorias.id", ondelete="RESTRICT")
    )
    codigo_barras_sku: Mapped[str | None] = mapped_column(String(60), unique=True)
    nombre: Mapped[str] = mapped_column(String(150))
    imagen_url: Mapped[str | None] = mapped_column(String(255), default=None)
    precio_venta: Mapped[money]
    stock_minimo: Mapped[Decimal] = mapped_column(
        Numeric(10, 3), server_default=text("0")
    )
    permite_decimales: Mapped[bool] = mapped_column(server_default=false())
    requiere_caducidad: Mapped[bool] = mapped_column(server_default=false())
    activo: Mapped[bool] = mapped_column(server_default=true())
    creado_en: Mapped[now_tz]

    categoria: Mapped[Categoria] = relationship(back_populates="productos")
    lotes: Mapped[list["LoteStock"]] = relationship(back_populates="producto")


class LoteStock(Base):
    __tablename__ = "lotes_stock"
    __table_args__ = (
        CheckConstraint("costo_unitario >= 0"),
        CheckConstraint(
            "cantidad_disponible >= 0", name="chk_lotes_stock_cantidad_positiva"
        ),
        UniqueConstraint("id", "producto_id", name="uq_lotes_stock_id_producto"),
        Index("idx_lotes_producto_id", "producto_id"),
        Index(
            "idx_lotes_fefo_fifo",
            "producto_id",
            text("fecha_caducidad NULLS LAST"),
            text("fecha_recepcion ASC"),
            postgresql_where=text("activo = TRUE AND cantidad_disponible > 0"),
        ),
    )

    id: Mapped[pk]
    producto_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("productos.id", ondelete="RESTRICT")
    )
    codigo_lote: Mapped[str] = mapped_column(String(80))
    fecha_recepcion: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP")
    )
    fecha_caducidad: Mapped[date | None]
    costo_unitario: Mapped[money]
    cantidad_disponible: Mapped[Decimal] = mapped_column(
        Numeric(10, 3), server_default=text("0")
    )
    activo: Mapped[bool] = mapped_column(server_default=true())
    creado_en: Mapped[now_tz]

    producto: Mapped[Producto] = relationship(back_populates="lotes")
    detalles_compra: Mapped[list["DetalleCompra"]] = relationship(
        back_populates="lote", foreign_keys="DetalleCompra.lote_id"
    )
    detalles_venta: Mapped[list["DetalleVenta"]] = relationship(
        back_populates="lote", foreign_keys="DetalleVenta.lote_id"
    )
    mermas: Mapped[list["Merma"]] = relationship(
        back_populates="lote", foreign_keys="Merma.lote_id"
    )
    movimientos: Mapped[list["MovimientoInventario"]] = relationship(
        back_populates="lote", foreign_keys="MovimientoInventario.lote_id"
    )
