from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_manager_user
from app.core.database import get_db
from app.models import Usuario, Venta
from app.schemas.ventas import (
    DevolucionCreate,
    DevolucionResponse,
    DevolucionVentaCreate,
    VentaCancelar,
    VentaCreate,
    VentaDevolucionResponse,
    VentaResponse,
)
from app.services.ventas_service import (
    DevolucionError,
    DevolucionExcedida,
    StockInsuficiente,
    VentaError,
    VentaNoEncontrada,
    VentaYaCancelada,
    cancelar_venta,
    consultar_venta_por_folio,
    crear_venta,
    registrar_devolucion,
)

router = APIRouter(prefix="/ventas", tags=["ventas"])


@router.post("", response_model=VentaResponse, status_code=status.HTTP_201_CREATED)
def registrar_venta(
    data: VentaCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Usuario, Depends(get_current_user)],
):
    try:
        return crear_venta(db, data, user.id)
    except StockInsuficiente as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
    except VentaError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e))


@router.get("/folio/{folio}", response_model=VentaDevolucionResponse)
def consultar_por_folio(
    folio: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_current_user)],
):
    """Busca un ticket por su folio y devuelve cada renglón con lo ya devuelto."""
    try:
        return consultar_venta_por_folio(db, folio)
    except VentaNoEncontrada as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))


@router.post("/{venta_id}/devoluciones", response_model=DevolucionResponse, status_code=status.HTTP_201_CREATED)
def devolver(
    venta_id: int,
    data: DevolucionVentaCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Usuario, Depends(get_manager_user)],
):
    """Devuelve artículos de una venta. Con reingreso suben las existencias del lote; sin él, nace una merma."""
    try:
        return registrar_devolucion(db, DevolucionCreate(venta_id=venta_id, **data.model_dump()), user.id)
    except VentaNoEncontrada as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    except DevolucionExcedida as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
    except DevolucionError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e))


@router.get("/{venta_id}", response_model=VentaResponse)
def consultar_venta(
    venta_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_current_user)],
):
    venta = db.get(Venta, venta_id)
    if venta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Venta no encontrada")
    return venta


@router.post("/{venta_id}/cancelar", response_model=VentaResponse)
def cancelar(
    venta_id: int,
    data: VentaCancelar,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Usuario, Depends(get_manager_user)],
):
    try:
        return cancelar_venta(db, venta_id, data.motivo_cancelacion, user.id)
    except VentaNoEncontrada as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    except VentaYaCancelada as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
