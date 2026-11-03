from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    false,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.types import money, now_tz, pk, qty

if TYPE_CHECKING:
    from app.models.catalogo import LoteStock, Producto
    from app.models.inventario import MovimientoInventario
    from app.models.personas import Cliente, Usuario


class Venta(Base):
    __tablename__ = "ventas"
    __table_args__ = (
        CheckConstraint("subtotal >= 0"),
        CheckConstraint("total >= 0"),
        CheckConstraint("estado IN ('COMPLETADA', 'CANCELADA')"),
        CheckConstraint(
            "(estado = 'COMPLETADA') OR (estado = 'CANCELADA' AND motivo_cancelacion IS NOT NULL)",
            name="chk_ventas_cancelacion_motivo",
        ),
        Index("idx_ventas_cliente_id", "cliente_id"),
        Index("idx_ventas_usuario_id", "usuario_id"),
        # Dashboard y reportes: solo ventas vigentes, por rango de fecha
        Index(
            "idx_ventas_fecha_completadas",
            "fecha_venta",
            postgresql_where=text("estado = 'COMPLETADA'"),
        ),
    )

    id: Mapped[pk]
    folio: Mapped[str] = mapped_column(String(30), unique=True)
    cliente_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("clientes.id", ondelete="RESTRICT")
    )
    usuario_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("usuarios.id", ondelete="RESTRICT")
    )
    subtotal: Mapped[money]
    total: Mapped[money]
    estado: Mapped[str] = mapped_column(String(20), server_default="COMPLETADA")
    motivo_cancelacion: Mapped[str | None] = mapped_column(Text)
    fecha_venta: Mapped[now_tz]

    cliente: Mapped["Cliente"] = relationship(back_populates="ventas")
    usuario: Mapped["Usuario"] = relationship(back_populates="ventas")
    detalles: Mapped[list["DetalleVenta"]] = relationship(back_populates="venta")
    pagos: Mapped[list["Pago"]] = relationship(back_populates="venta")
    devoluciones: Mapped[list["Devolucion"]] = relationship(back_populates="venta")


class DetalleVenta(Base):
    __tablename__ = "detalle_ventas"
    __table_args__ = (
        CheckConstraint("cantidad > 0"),
        CheckConstraint("precio_unitario_aplicado >= 0"),
        CheckConstraint("costo_unitario_aplicado >= 0"),
        CheckConstraint("subtotal >= 0"),
        ForeignKeyConstraint(
            ["lote_id", "producto_id"],
            ["lotes_stock.id", "lotes_stock.producto_id"],
            name="fk_detalle_ventas_lote_producto",
        ),
        UniqueConstraint("id", "venta_id", name="uq_detalle_ventas_id_venta"),
        Index("idx_detalle_ventas_venta_id", "venta_id"),
        Index("idx_detalle_ventas_producto_id", "producto_id"),
        Index("idx_detalle_ventas_lote_id", "lote_id"),
    )

    id: Mapped[pk]
    venta_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ventas.id", ondelete="RESTRICT")
    )
    producto_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("productos.id", ondelete="RESTRICT")
    )
    lote_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lotes_stock.id", ondelete="RESTRICT")
    )
    cantidad: Mapped[qty]
    precio_unitario_aplicado: Mapped[money]
    costo_unitario_aplicado: Mapped[money]
    subtotal: Mapped[money]

    venta: Mapped[Venta] = relationship(back_populates="detalles")
    producto: Mapped["Producto"] = relationship()
    lote: Mapped["LoteStock"] = relationship(
        back_populates="detalles_venta", foreign_keys=[lote_id]
    )
    devoluciones: Mapped[list["Devolucion"]] = relationship(
        back_populates="detalle_venta", foreign_keys="Devolucion.detalle_venta_id"
    )
    movimientos: Mapped[list["MovimientoInventario"]] = relationship(
        back_populates="detalle_venta"
    )

    @property
    def nombre_producto(self) -> str:
        return self.producto.nombre

    @property
    def codigo_lote(self) -> str:
        return self.lote.codigo_lote


class Pago(Base):
    __tablename__ = "pagos"
    __table_args__ = (
        CheckConstraint("metodo IN ('EFECTIVO', 'TARJETA', 'TRANSFERENCIA')"),
        CheckConstraint("importe > 0"),
        CheckConstraint("pago_con >= importe"),
        CheckConstraint("cambio >= 0"),
        Index("idx_pagos_venta_id", "venta_id"),
    )

    id: Mapped[pk]
    venta_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ventas.id", ondelete="RESTRICT")
    )
    metodo: Mapped[str] = mapped_column(String(20))
    importe: Mapped[money]
    pago_con: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    cambio: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), server_default=text("0")
    )
    # Voucher / autorización de la terminal (TARJETA) o clave de rastreo (TRANSFERENCIA); solo auditoría
    referencia: Mapped[str | None] = mapped_column(String(80))
    fecha_pago: Mapped[now_tz]

    venta: Mapped[Venta] = relationship(back_populates="pagos")


class Devolucion(Base):
    __tablename__ = "devoluciones"
    __table_args__ = (
        CheckConstraint("cantidad > 0"),
        ForeignKeyConstraint(
            ["detalle_venta_id", "venta_id"],
            ["detalle_ventas.id", "detalle_ventas.venta_id"],
            name="fk_devoluciones_detalle_venta",
        ),
        Index("idx_devoluciones_venta_id", "venta_id"),
        Index("idx_devoluciones_detalle_venta_id", "detalle_venta_id"),
    )

    id: Mapped[pk]
    venta_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ventas.id", ondelete="RESTRICT")
    )
    detalle_venta_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("detalle_ventas.id", ondelete="RESTRICT")
    )
    cantidad: Mapped[qty]
    motivo: Mapped[str] = mapped_column(Text)
    reingreso_a_stock: Mapped[bool] = mapped_column(server_default=false())
    usuario_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("usuarios.id", ondelete="RESTRICT")
    )
    fecha: Mapped[now_tz]

    venta: Mapped[Venta] = relationship(
        back_populates="devoluciones", foreign_keys=[venta_id]
    )
    detalle_venta: Mapped[DetalleVenta] = relationship(
        back_populates="devoluciones", foreign_keys=[detalle_venta_id]
    )
    usuario: Mapped["Usuario"] = relationship()
    movimientos: Mapped[list["MovimientoInventario"]] = relationship(
        back_populates="devolucion"
    )
