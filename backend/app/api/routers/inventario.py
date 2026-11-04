import csv
import io
from collections.abc import Iterator
from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import case, func, literal, or_, select
from sqlalchemy.orm import Session, aliased

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import (
    Compra,
    DetalleCompra,
    DetalleVenta,
    Devolucion,
    LoteStock,
    Merma,
    MovimientoInventario,
    Producto,
    Usuario,
    Venta,
)
from app.schemas.inventario import KardexResponse, TipoMovimiento

router = APIRouter(prefix="/inventario", tags=["inventario"])

_TIPOS_ENTRADA = (
    "ENTRADA_COMPRA",
    "CANCELACION_VENTA",
    "DEVOLUCION_STOCK",
    "AJUSTE_ENTRADA",
)

_ETIQUETAS_MOTIVO_MERMA = {
    "CADUCIDAD": "Caducidad",
    "ROTURA_DAÑO": "Rotura o daño",
    "CONSUMO_INTERNO_TIENDA": "Consumo interno de tienda",
    "DEVOLUCION_DEFECTUOSA": "Devolución defectuosa",
}


def _construir_motivo_legible(
    *,
    tipo: str,
    folio_documento: str,
    motivo_movimiento: str | None,
    merma_motivo: str | None,
    merma_descripcion: str | None,
    devolucion_motivo: str | None,
    venta_motivo_cancelacion: str | None,
) -> str:
    if tipo == "MERMA":
        codigo_merma = merma_motivo or motivo_movimiento or "MERMA"
        etiqueta = _ETIQUETAS_MOTIVO_MERMA.get(codigo_merma, codigo_merma)
        if merma_descripcion and merma_descripcion.strip():
            return f"{etiqueta}: {merma_descripcion.strip()}"
        return etiqueta
    if tipo == "DEVOLUCION_STOCK":
        detalle = (devolucion_motivo or motivo_movimiento or "").strip()
        if detalle:
            return f"Devolución de ticket {folio_documento}: {detalle}"
        return f"Devolución de ticket {folio_documento}"
    if tipo == "CANCELACION_VENTA":
        detalle = (motivo_movimiento or venta_motivo_cancelacion or "").strip()
        if detalle:
            return f"Cancelación de ticket {folio_documento}: {detalle}"
        return f"Cancelación de ticket {folio_documento}"
    if tipo == "VENTA":
        if motivo_movimiento and motivo_movimiento.strip():
            return motivo_movimiento.strip()
        return f"Venta en ticket {folio_documento}"
    if tipo == "ENTRADA_COMPRA":
        if motivo_movimiento and motivo_movimiento.strip():
            return motivo_movimiento.strip()
        return f"Recepción de compra {folio_documento}"
    # AJUSTE_ENTRADA / AJUSTE_SALIDA
    return (motivo_movimiento or "Ajuste de inventario").strip()


def _consulta_kardex(
    db: Session,
    *,
    producto_id: int | None,
    lote_id: int | None,
    tipo: str | None,
    inicio: date | None,
    fin: date | None,
    q: str | None,
):
    """Consulta del Kardex sin paginar: la comparten el listado y la exportación a CSV."""
    venta_directa = aliased(Venta, name="venta_directa")
    venta_devolucion = aliased(Venta, name="venta_devolucion")

    # Saldo acumulado por lote calculado en subconsulta antes de filtrar por fecha/tipo/q
    delta_stock = case(
        (MovimientoInventario.tipo.in_(_TIPOS_ENTRADA), MovimientoInventario.cantidad),
        else_=-MovimientoInventario.cantidad,
    )
    saldos_sq = select(
        MovimientoInventario.id.label("movimiento_id"),
        func.sum(delta_stock)
        .over(
            partition_by=MovimientoInventario.lote_id,
            order_by=(MovimientoInventario.fecha.asc(), MovimientoInventario.id.asc()),
        )
        .label("saldo_resultante"),
    )
    if producto_id is not None:
        saldos_sq = saldos_sq.where(MovimientoInventario.producto_id == producto_id)
    if lote_id is not None:
        saldos_sq = saldos_sq.where(MovimientoInventario.lote_id == lote_id)
    saldos = saldos_sq.subquery("saldos_movimiento")

    folio_documento_col = case(
        (venta_directa.folio.is_not(None), venta_directa.folio),
        (Compra.folio.is_not(None), Compra.folio),
        (venta_devolucion.folio.is_not(None), venta_devolucion.folio),
        (Merma.id.is_not(None), func.concat("MERMA-", Merma.id)),
        else_=literal("AJUSTE"),
    ).label("folio_documento")

    documento_id_col = func.coalesce(
        venta_directa.id,
        Compra.id,
        venta_devolucion.id,
        Merma.id,
    ).label("documento_id")

    stmt = (
        select(
            MovimientoInventario,
            Producto.nombre.label("nombre_producto"),
            Producto.permite_decimales.label("permite_decimales"),
            LoteStock.codigo_lote.label("codigo_lote"),
            Usuario.nombre.label("usuario_nombre"),
            folio_documento_col,
            documento_id_col,
            saldos.c.saldo_resultante,
            Merma.motivo.label("merma_motivo"),
            Merma.descripcion.label("merma_descripcion"),
            Devolucion.motivo.label("devolucion_motivo"),
            venta_directa.motivo_cancelacion.label("venta_motivo_cancelacion"),
        )
        .join(saldos, saldos.c.movimiento_id == MovimientoInventario.id)
        .outerjoin(Producto, MovimientoInventario.producto)
        .outerjoin(LoteStock, MovimientoInventario.lote)
        .outerjoin(Usuario, MovimientoInventario.usuario)
        .outerjoin(DetalleVenta, MovimientoInventario.detalle_venta)
        .outerjoin(venta_directa, DetalleVenta.venta)
        .outerjoin(DetalleCompra, MovimientoInventario.detalle_compra)
        .outerjoin(Compra, DetalleCompra.compra)
        .outerjoin(Merma, MovimientoInventario.merma)
        .outerjoin(Devolucion, MovimientoInventario.devolucion)
        .outerjoin(venta_devolucion, Devolucion.venta)
        .order_by(MovimientoInventario.fecha.desc(), MovimientoInventario.id.desc())
    )

    if producto_id is not None:
        stmt = stmt.where(MovimientoInventario.producto_id == producto_id)
    if lote_id is not None:
        stmt = stmt.where(MovimientoInventario.lote_id == lote_id)
    if tipo is not None:
        stmt = stmt.where(MovimientoInventario.tipo == tipo)
    if inicio is not None:
        stmt = stmt.where(MovimientoInventario.fecha >= inicio)
    if fin is not None:
        stmt = stmt.where(MovimientoInventario.fecha < fin + timedelta(days=1))
    if q is not None and q.strip():
        termino = q.strip()
        db.execute(
            select(func.set_config("pg_trgm.similarity_threshold", "0.3", True))
        )
        db.execute(
            select(func.set_config("pg_trgm.word_similarity_threshold", "0.3", True))
        )
        stmt = stmt.where(
            or_(
                Producto.nombre.op("%")(termino),
                literal(termino).op("<%")(Producto.nombre),
                Producto.codigo_barras_sku == termino,
                LoteStock.codigo_lote == termino,
                venta_directa.folio == termino,
                Compra.folio == termino,
                venta_devolucion.folio == termino,
                folio_documento_col == termino,
            )
        )
    return stmt


def _a_respuesta(fila) -> KardexResponse:
    mov: MovimientoInventario = fila[0]
    motivo_legible = _construir_motivo_legible(
        tipo=mov.tipo,
        folio_documento=fila.folio_documento,
        motivo_movimiento=mov.motivo,
        merma_motivo=fila.merma_motivo,
        merma_descripcion=fila.merma_descripcion,
        devolucion_motivo=fila.devolucion_motivo,
        venta_motivo_cancelacion=fila.venta_motivo_cancelacion,
    )
    return KardexResponse(
        id=mov.id,
        producto_id=mov.producto_id,
        lote_id=mov.lote_id,
        tipo=mov.tipo,
        tipo_movimiento=mov.tipo,
        folio_documento=fila.folio_documento,
        documento_id=fila.documento_id,
        cantidad=mov.cantidad,
        saldo_resultante=fila.saldo_resultante,
        permite_decimales=bool(fila.permite_decimales),
        usuario_id=mov.usuario_id,
        usuario_nombre=fila.usuario_nombre,
        nombre_usuario=fila.usuario_nombre,
        nombre_producto=fila.nombre_producto,
        codigo_lote=fila.codigo_lote,
        motivo=mov.motivo,
        motivo_legible=motivo_legible,
        detalle_compra_id=mov.detalle_compra_id,
        detalle_venta_id=mov.detalle_venta_id,
        merma_id=mov.merma_id,
        devolucion_id=mov.devolucion_id,
        fecha=mov.fecha,
    )


def _validar_rango(inicio: date | None, fin: date | None) -> None:
    if inicio is not None and fin is not None and inicio > fin:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "'fecha_inicio' ('desde') no puede ser posterior a 'fecha_fin' ('hasta')",
        )


@router.get("/kardex", response_model=list[KardexResponse])
def kardex(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_current_user)],
    producto_id: int | None = None,
    lote_id: int | None = None,
    tipo_movimiento: TipoMovimiento | None = None,
    tipo: TipoMovimiento | None = None,
    fecha_inicio: date | None = None,
    fecha_fin: date | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    q: Annotated[str | None, Query(max_length=150)] = None,
    limite: Annotated[int, Query(ge=1, le=1000)] = 100,
    desplazamiento: Annotated[int, Query(ge=0)] = 0,
):
    """Historial de movimientos de inventario (Kardex), del más reciente al más antiguo.

    Soporta `fecha_inicio`/`fecha_fin` (y alias `desde`/`hasta`), `tipo_movimiento` (y alias `tipo`),
    `producto_id`, `lote_id`, y búsqueda `q` con `pg_trgm` por nombre de producto o coincidencia
    exacta de SKU / código de lote / folio de documento.
    """
    inicio = fecha_inicio if fecha_inicio is not None else desde
    fin = fecha_fin if fecha_fin is not None else hasta
    tipo_efectivo = tipo_movimiento if tipo_movimiento is not None else tipo
    _validar_rango(inicio, fin)

    stmt = _consulta_kardex(
        db, producto_id=producto_id, lote_id=lote_id, tipo=tipo_efectivo, inicio=inicio, fin=fin, q=q
    ).limit(limite).offset(desplazamiento)
    return [_a_respuesta(fila) for fila in db.execute(stmt).all()]


_ETIQUETA_TIPO = {
    "ENTRADA_COMPRA": "Entrada por compra",
    "VENTA": "Venta",
    "CANCELACION_VENTA": "Cancelación de venta",
    "MERMA": "Merma",
    "DEVOLUCION_STOCK": "Devolución de cliente",
    "AJUSTE_ENTRADA": "Ajuste de entrada",
    "AJUSTE_SALIDA": "Ajuste de salida",
}

_CABECERA_CSV = (
    "Fecha",
    "Tipo Movimiento",
    "Folio Comprobante",
    "Producto",
    "Lote",
    "Entrada/Salida",
    "Cantidad",
    "Saldo Resultante",
    "Usuario",
    "Motivo",
)


def _texto_seguro(valor: object) -> str:
    """Evita inyección de fórmulas: Excel ejecuta las celdas de texto que empiezan con = + - @."""
    texto = "" if valor is None else str(valor)
    return f"'{texto}" if texto[:1] in ("=", "+", "-", "@", "\t", "\r") else texto


def _filas_csv(filas) -> Iterator[str]:
    # BOM: sin él Excel abre el UTF-8 como ANSI y deforma los acentos
    yield "﻿"
    buffer = io.StringIO()
    escritor = csv.writer(buffer, lineterminator="\r\n")
    escritor.writerow(_CABECERA_CSV)
    yield buffer.getvalue()
    for fila in filas:
        r = _a_respuesta(fila)
        buffer.seek(0)
        buffer.truncate()
        escritor.writerow(
            (
                r.fecha.astimezone().strftime("%Y-%m-%d %H:%M:%S"),
                _ETIQUETA_TIPO.get(r.tipo, r.tipo),
                _texto_seguro(r.folio_documento),
                _texto_seguro(r.nombre_producto),
                _texto_seguro(r.codigo_lote),
                "Entrada" if r.tipo in _TIPOS_ENTRADA else "Salida",
                r.cantidad,
                r.saldo_resultante,
                _texto_seguro(r.usuario_nombre),
                _texto_seguro(r.motivo_legible),
            )
        )
        yield buffer.getvalue()


@router.get("/kardex/export")
def exportar_kardex(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_current_user)],
    fecha_inicio: date | None = None,
    fecha_fin: date | None = None,
    producto_id: int | None = None,
    tipo_movimiento: TipoMovimiento | None = None,
):
    """Descarga el Kardex filtrado como CSV UTF-8 con BOM (abre con acentos en Excel)."""
    _validar_rango(fecha_inicio, fecha_fin)
    stmt = _consulta_kardex(
        db,
        producto_id=producto_id,
        lote_id=None,
        tipo=tipo_movimiento,
        inicio=fecha_inicio,
        fin=fecha_fin,
        q=None,
    )
    # Se leen las filas antes de responder: la sesión de BD se cierra al terminar el endpoint
    filas = db.execute(stmt).all()
    nombre = f"kardex_{datetime.now():%Y%m%d_%H%M%S}.csv"
    return StreamingResponse(
        _filas_csv(filas),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )
