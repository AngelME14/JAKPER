from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, select, text
from sqlalchemy.orm import Session, contains_eager

from app.api.deps import get_manager_user
from app.core.database import get_db
from app.models import LoteStock, Merma, Producto, Usuario, Venta
from app.schemas.dashboard import (
    AlertasResponse,
    LotePorCaducarItem,
    ResumenResponse,
    StockCriticoItem,
    VentaDia,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

DIAS_ALERTA_CADUCIDAD = 30
CENTAVO = Decimal("0.01")


@router.get("/alertas", response_model=AlertasResponse)
def alertas(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_manager_user)],
):
    hoy = date.today()
    return AlertasResponse(
        stock_critico=_stock_critico(db),
        lotes_por_caducar=_lotes_por_caducar(db, hoy),
        mermas_mes_actual=_mermas_mes_actual(db),
    )


@router.get("/resumen", response_model=ResumenResponse)
def resumen(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_manager_user)],
):
    # La fecha sale de la BD: así las ventas y el "hoy" comparten la misma zona horaria
    hoy = db.scalar(select(func.current_date()))
    inicio_mes = hoy.replace(day=1)
    inicio_mes_anterior = (inicio_mes - timedelta(days=1)).replace(day=1)
    return ResumenResponse(
        stock_total=_stock_total(db),
        productos_activos=db.scalar(select(func.count(Producto.id)).where(Producto.activo.is_(True))) or 0,
        ventas_mes=_ventas_entre(db, inicio_mes, hoy + timedelta(days=1)),
        ventas_mes_anterior=_ventas_entre(db, inicio_mes_anterior, inicio_mes),
        ventas_ultimos_7_dias=_ventas_por_dia(db, hoy, dias=7),
    )


def _stock_total(db: Session) -> Decimal:
    total = db.scalar(
        select(func.coalesce(func.sum(LoteStock.cantidad_disponible), 0))
        .join(LoteStock.producto)
        .where(LoteStock.activo.is_(True), Producto.activo.is_(True))
    )
    return Decimal(total)


def _ventas_entre(db: Session, desde: date, hasta: date) -> Decimal:
    """Suma de ventas completadas con fecha en [desde, hasta)."""
    total = db.scalar(
        select(func.coalesce(func.sum(Venta.total), 0)).where(
            Venta.estado == "COMPLETADA",
            func.date(Venta.fecha_venta) >= desde,
            func.date(Venta.fecha_venta) < hasta,
        )
    )
    return Decimal(total).quantize(CENTAVO, ROUND_HALF_UP)


def _ventas_por_dia(db: Session, hoy: date, dias: int) -> list[VentaDia]:
    primero = hoy - timedelta(days=dias - 1)
    dia = func.date(Venta.fecha_venta)
    filas = db.execute(
        select(dia.label("dia"), func.sum(Venta.total).label("total"))
        .where(Venta.estado == "COMPLETADA", dia >= primero, dia <= hoy)
        .group_by(dia)
    )
    por_dia = {f.dia: Decimal(f.total) for f in filas}
    return [
        VentaDia(
            fecha=primero + timedelta(days=i),
            total=por_dia.get(primero + timedelta(days=i), Decimal(0)).quantize(CENTAVO, ROUND_HALF_UP),
        )
        for i in range(dias)
    ]


def _stock_critico(db: Session) -> list[StockCriticoItem]:
    stock = func.coalesce(func.sum(LoteStock.cantidad_disponible), 0)
    # LEFT JOIN con el filtro de lote activo en el ON: un producto sin lotes activos cuenta stock 0
    stmt = (
        select(Producto.id, Producto.nombre, Producto.stock_minimo, stock.label("stock_actual"))
        .outerjoin(
            LoteStock,
            and_(LoteStock.producto_id == Producto.id, LoteStock.activo.is_(True)),
        )
        # stock_minimo = 0 significa "sin stock de seguridad": no alerta aunque no haya existencias
        .where(Producto.activo.is_(True), Producto.stock_minimo > 0)
        .group_by(Producto.id)
        .having(stock <= Producto.stock_minimo)
        .order_by((Producto.stock_minimo - stock).desc(), Producto.nombre)
    )
    return [
        StockCriticoItem(
            producto_id=r.id, nombre=r.nombre,
            stock_minimo=r.stock_minimo, stock_actual=r.stock_actual,
        )
        for r in db.execute(stmt)
    ]


def _lotes_por_caducar(db: Session, hoy: date) -> list[LotePorCaducarItem]:
    limite = hoy + timedelta(days=DIAS_ALERTA_CADUCIDAD)
    stmt = (
        select(LoteStock)
        .join(LoteStock.producto)
        # El JOIN ya filtra por producto; contains_eager lo reutiliza en vez de un segundo JOIN
        .options(contains_eager(LoteStock.producto))
        .where(
            Producto.requiere_caducidad.is_(True),
            LoteStock.activo.is_(True),
            LoteStock.cantidad_disponible > 0,
            LoteStock.fecha_caducidad <= limite,
        )
        .order_by(LoteStock.fecha_caducidad, LoteStock.id)
    )
    return [
        LotePorCaducarItem(
            lote_id=l.id, producto_id=l.producto_id, nombre_producto=l.producto.nombre,
            codigo_lote=l.codigo_lote, fecha_caducidad=l.fecha_caducidad,
            dias_restantes=(l.fecha_caducidad - hoy).days,
            cantidad_disponible=l.cantidad_disponible,
        )
        for l in db.scalars(stmt)
    ]


def _mermas_mes_actual(db: Session) -> Decimal:
    inicio_mes = func.date_trunc("month", func.now())
    total = db.scalar(
        select(func.coalesce(func.sum(Merma.cantidad * Merma.costo_unitario_perdida), 0)).where(
            Merma.fecha >= inicio_mes,
            Merma.fecha < inicio_mes + text("interval '1 month'"),
        )
    )
    return Decimal(total).quantize(CENTAVO, ROUND_HALF_UP)
