from datetime import datetime
from decimal import Decimal
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, model_validator

from app.schemas.types import Cantidad, Dinero, Entrada

TipoMovimiento = Literal[
    "ENTRADA_COMPRA",
    "VENTA",
    "CANCELACION_VENTA",
    "MERMA",
    "DEVOLUCION_STOCK",
    "AJUSTE_ENTRADA",
    "AJUSTE_SALIDA",
]
# Las mermas manuales solo admiten estos motivos; DEVOLUCION_DEFECTUOSA la crea el sistema al devolver
MotivoMerma = Literal["CADUCIDAD", "ROTURA_DAÑO", "CONSUMO_INTERNO_TIENDA"]
# Todo motivo que admite la tabla mermas (mermas_motivo_check), incluidos los que crea el sistema
MotivoMermaRegistrado = Literal[
    "CADUCIDAD", "ROTURA_DAÑO", "CONSUMO_INTERNO_TIENDA", "DEVOLUCION_DEFECTUOSA"
]

_ENTERO = Decimal("1")
_MILESIMA = Decimal("0.001")

# tipo -> única FK de origen que debe venir (chk_movimiento_origen); ajustes: ninguna
_ORIGEN = {
    "ENTRADA_COMPRA": "detalle_compra_id",
    "VENTA": "detalle_venta_id",
    "CANCELACION_VENTA": "detalle_venta_id",
    "MERMA": "merma_id",
    "DEVOLUCION_STOCK": "devolucion_id",
}
_CAMPOS_ORIGEN = ("detalle_compra_id", "detalle_venta_id", "merma_id", "devolucion_id")


def _formatear_cantidad(valor: Decimal, permite_decimales: bool) -> Decimal:
    if not permite_decimales and valor == valor.to_integral_value():
        return valor.quantize(_ENTERO)
    return valor.quantize(_MILESIMA)


class MermaCreate(Entrada):
    producto_id: int
    lote_id: int
    cantidad: Cantidad
    motivo: MotivoMerma
    descripcion: str | None = None


class MermaUpdate(Entrada):
    descripcion: str | None = None


class MermaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    producto_id: int
    lote_id: int
    cantidad: Decimal
    costo_unitario_perdida: Dinero
    motivo: MotivoMermaRegistrado
    descripcion: str | None
    usuario_id: int
    fecha: datetime


class MovimientoInventarioCreate(Entrada):
    producto_id: int
    lote_id: int
    tipo: TipoMovimiento
    cantidad: Cantidad
    motivo: str | None = None
    detalle_compra_id: int | None = None
    detalle_venta_id: int | None = None
    merma_id: int | None = None
    devolucion_id: int | None = None

    @model_validator(mode="after")
    def _origen_coincide_con_tipo(self) -> Self:
        esperado = _ORIGEN.get(self.tipo)
        for campo in _CAMPOS_ORIGEN:
            if (campo == esperado) != (getattr(self, campo) is not None):
                raise ValueError(
                    f"tipo {self.tipo} exige solo {esperado or 'ningún origen'}; "
                    f"revisa {campo}"
                )
        if esperado is None and not self.motivo:
            raise ValueError(f"tipo {self.tipo} exige motivo")
        return self


class MovimientoInventarioResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    producto_id: int
    lote_id: int
    tipo: TipoMovimiento
    cantidad: Decimal
    usuario_id: int
    motivo: str | None
    detalle_compra_id: int | None
    detalle_venta_id: int | None
    merma_id: int | None
    devolucion_id: int | None
    fecha: datetime


class KardexResponse(MovimientoInventarioResponse):
    folio_documento: str
    documento_id: int | None = None
    tipo_movimiento: TipoMovimiento
    permite_decimales: bool = False
    saldo_resultante: Decimal
    usuario_nombre: str
    motivo_legible: str
    nombre_producto: str
    codigo_lote: str
    nombre_usuario: str

    @model_validator(mode="after")
    def _ajustar_precision_cantidades(self) -> Self:
        self.cantidad = _formatear_cantidad(self.cantidad, self.permite_decimales)
        self.saldo_resultante = _formatear_cantidad(
            self.saldo_resultante, self.permite_decimales
        )
        return self

