from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.types import Dinero, Entrada, Stock


class CategoriaCreate(Entrada):
    nombre: str = Field(min_length=1, max_length=80)


class CategoriaUpdate(Entrada):
    nombre: str | None = Field(default=None, min_length=1, max_length=80)


class CategoriaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    creado_en: datetime


class ProductoCreate(Entrada):
    categoria_id: int
    codigo_barras_sku: str | None = Field(default=None, min_length=1, max_length=60)
    nombre: str = Field(min_length=1, max_length=150)
    precio_venta: Dinero
    stock_minimo: Stock = Decimal(0)
    permite_decimales: bool = False
    requiere_caducidad: bool = False


class ProductoUpdate(Entrada):
    categoria_id: int | None = None
    codigo_barras_sku: str | None = Field(default=None, min_length=1, max_length=60)
    nombre: str | None = Field(default=None, min_length=1, max_length=150)
    precio_venta: Dinero | None = None
    stock_minimo: Stock | None = None
    permite_decimales: bool | None = None
    requiere_caducidad: bool | None = None
    activo: bool | None = None


class ProductoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    categoria_id: int
    codigo_barras_sku: str | None
    nombre: str
    imagen_url: str | None = None
    precio_venta: Dinero
    stock_minimo: Stock
    permite_decimales: bool
    requiere_caducidad: bool
    activo: bool
    creado_en: datetime


class LoteDisponibleResponse(BaseModel):
    """Lote vendible, sin costos: lo consume el mostrador."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    codigo_lote: str
    fecha_caducidad: date | None
    cantidad_disponible: Stock


class ProductoBusquedaResponse(ProductoResponse):
    similitud: float
    # Solo lotes activos, con existencia y no vencidos, en el orden en que se despachan
    stock_total: Stock
    lotes: list[LoteDisponibleResponse]


class ProductoCatalogoResponse(ProductoResponse):
    categoria: str
    stock_total: Stock
    lotes: list[LoteDisponibleResponse]


class LoteStockCreate(Entrada):
    producto_id: int
    codigo_lote: str = Field(min_length=1, max_length=80)
    fecha_caducidad: date | None = None
    costo_unitario: Dinero
    cantidad_disponible: Stock = 0


class LoteStockUpdate(Entrada):
    fecha_caducidad: date | None = None
    activo: bool | None = None


class LoteStockResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    producto_id: int
    codigo_lote: str
    fecha_recepcion: datetime
    fecha_caducidad: date | None
    costo_unitario: Dinero
    cantidad_disponible: Stock
    activo: bool
    creado_en: datetime


class UltimoCostoResponse(BaseModel):
    producto_id: int
    ultimo_costo: Dinero
    costo_unitario: Dinero
