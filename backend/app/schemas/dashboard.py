from datetime import date
from pydantic import BaseModel

from app.schemas.types import Dinero, Stock


class StockCriticoItem(BaseModel):
    producto_id: int
    nombre: str
    stock_minimo: Stock
    stock_actual: Stock


class LotePorCaducarItem(BaseModel):
    lote_id: int
    producto_id: int
    nombre_producto: str
    codigo_lote: str
    fecha_caducidad: date
    dias_restantes: int  # negativo = ya vencido
    cantidad_disponible: Stock


class AlertasResponse(BaseModel):
    stock_critico: list[StockCriticoItem]
    lotes_por_caducar: list[LotePorCaducarItem]
    mermas_mes_actual: Dinero


class VentaDia(BaseModel):
    fecha: date
    total: Dinero


class ResumenResponse(BaseModel):
    stock_total: Stock  # unidades vendibles: lotes activos de productos activos
    productos_activos: int
    ventas_mes: Dinero
    ventas_mes_anterior: Dinero
    ventas_ultimos_7_dias: list[VentaDia]  # del más antiguo a hoy, con ceros en días sin ventas
