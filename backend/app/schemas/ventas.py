from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.schemas.types import Cantidad, Dinero, Entrada

EstadoVenta = Literal["COMPLETADA", "CANCELADA"]
MetodoPago = Literal["EFECTIVO", "TARJETA", "TRANSFERENCIA"]


class DetalleVentaCreate(Entrada):
    # El lote lo asigna el servidor (FEFO); precio y costo se toman del producto/lote
    producto_id: int
    cantidad: Cantidad


class PagoCreate(Entrada):
    metodo: MetodoPago
    importe: Cantidad
    pago_con: Dinero | None = None
    cambio: Dinero = 0
    referencia: str | None = Field(default=None, max_length=80)

    @field_validator("referencia")
    @classmethod
    def _referencia_vacia_es_nula(cls, valor: str | None) -> str | None:
        return (valor or "").strip() or None

    @model_validator(mode="after")
    def _pago_con_cubre_importe(self) -> Self:
        if self.pago_con is not None and self.pago_con < self.importe:
            raise ValueError("pago_con debe ser >= importe")
        return self


class VentaCreate(Entrada):
    cliente_id: int
    items: list[DetalleVentaCreate] = Field(min_length=1)
    pagos: list[PagoCreate] = Field(min_length=1)


class VentaCancelar(Entrada):
    motivo_cancelacion: str = Field(min_length=1)


class DevolucionCreate(Entrada):
    venta_id: int
    detalle_venta_id: int
    cantidad: Cantidad
    motivo: str = Field(min_length=1)
    reingreso_a_stock: bool = False


class DevolucionVentaCreate(Entrada):
    """Cuerpo de POST /ventas/{venta_id}/devoluciones: la venta va en la ruta."""

    detalle_venta_id: int
    cantidad: Cantidad
    motivo: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    reingreso_a_stock: bool = False


class ClienteResumen(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str


class UsuarioResumen(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str


class DetalleVentaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    producto_id: int
    nombre_producto: str
    lote_id: int
    codigo_lote: str
    cantidad: Decimal
    precio_unitario_aplicado: Dinero
    subtotal: Dinero


class PagoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    metodo: MetodoPago
    importe: Decimal
    pago_con: Dinero | None
    cambio: Dinero | None
    referencia: str | None = None
    fecha_pago: datetime


class DetalleDevolvibleResponse(BaseModel):
    """Renglón de una venta con lo ya devuelto, para decidir cuánto se puede devolver aún."""

    id: int
    producto_id: int
    nombre_producto: str
    codigo_lote: str
    permite_decimales: bool
    cantidad: Decimal
    cantidad_devuelta: Decimal
    cantidad_disponible: Decimal
    precio_unitario_aplicado: Dinero
    subtotal: Dinero


class VentaDevolucionResponse(BaseModel):
    id: int
    folio: str
    fecha_venta: datetime
    total: Dinero
    estado: EstadoVenta
    cliente: ClienteResumen
    usuario: UsuarioResumen
    items: list[DetalleDevolvibleResponse]


class VentaResponse(BaseModel):
    """Ticket completo: cabecera, artículos cobrados y desglose de pagos."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    folio: str
    fecha_venta: datetime
    subtotal: Dinero
    total: Dinero
    estado: EstadoVenta
    motivo_cancelacion: str | None
    cliente: ClienteResumen
    usuario: UsuarioResumen
    items: list[DetalleVentaResponse] = Field(validation_alias="detalles")
    pagos: list[PagoResponse]


class DevolucionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    venta_id: int
    detalle_venta_id: int
    cantidad: Decimal
    motivo: str
    reingreso_a_stock: bool
    usuario_id: int
    fecha: datetime
