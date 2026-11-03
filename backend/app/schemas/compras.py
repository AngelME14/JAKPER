from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.types import Cantidad, Dinero, Entrada


class DetalleCompraCreate(Entrada):
    # Cada renglón genera su propio lote; codigo_lote y fecha_caducidad obligatorios si requiere_caducidad=True
    producto_id: int
    codigo_lote: str | None = Field(default=None, max_length=80)
    fecha_caducidad: date | None = None
    cantidad: Cantidad
    costo_unitario: Dinero

    @field_validator("codigo_lote")
    @classmethod
    def _normalizar_lote(cls, v: str | None) -> str | None:
        if v is None:
            return None
        limpio = v.strip()
        return limpio or None


class CompraCreate(Entrada):
    # El folio interno lo asigna el servidor; aqui solo viaja el comprobante del proveedor
    factura_proveedor: str | None = Field(default=None, max_length=60)
    proveedor_id: int
    items: list[DetalleCompraCreate] = Field(min_length=1)

    @field_validator("factura_proveedor")
    @classmethod
    def _limpiar_factura(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip() or None


class DetalleCompraResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    producto_id: int
    lote_id: int
    cantidad: Decimal
    costo_unitario: Dinero
    subtotal: Dinero


class CompraResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    folio: str
    factura_proveedor: str | None = None
    proveedor_id: int
    usuario_id: int
    estado: Literal["RECIBIDA", "CANCELADA"]
    total: Dinero
    fecha_compra: datetime
    items: list[DetalleCompraResponse] = Field(validation_alias="detalles")


class DetalleCompraComprobante(DetalleCompraResponse):
    nombre_producto: str
    codigo_lote: str


class CompraComprobante(CompraResponse):
    """Compra con nombres legibles, para consultarla desde el Kardex."""

    proveedor_nombre: str
    usuario_nombre: str
    items: list[DetalleCompraComprobante] = Field(validation_alias="detalles")
