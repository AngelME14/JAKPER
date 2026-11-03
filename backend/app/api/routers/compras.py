from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_manager_user
from app.core.database import get_db
from app.models import Compra, Usuario
from app.schemas.compras import CompraComprobante, CompraCreate, CompraResponse
from app.services.compras_service import CompraError, registrar_compra

router = APIRouter(prefix="/compras", tags=["compras"])


@router.post("", response_model=CompraResponse, status_code=status.HTTP_201_CREATED)
def ingresar_mercancia(
    data: CompraCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Usuario, Depends(get_manager_user)],
):
    try:
        return registrar_compra(db, data, user.id)
    except CompraError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e))


@router.get("/{compra_id}", response_model=CompraComprobante)
def consultar_compra(
    compra_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_manager_user)],
):
    """Comprobante de una compra, con costos: solo Admin y Encargado."""
    compra = db.get(Compra, compra_id)
    if compra is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Compra no encontrada")
    return compra
