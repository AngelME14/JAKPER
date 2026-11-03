from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_manager_user
from app.core.database import get_db
from app.models import Usuario
from app.schemas.ventas import DevolucionCreate, DevolucionResponse
from app.services.ventas_service import (
    DevolucionError,
    DevolucionExcedida,
    VentaNoEncontrada,
    registrar_devolucion,
)

router = APIRouter(prefix="/devoluciones", tags=["devoluciones"])


@router.post("", response_model=DevolucionResponse, status_code=status.HTTP_201_CREATED)
def devolver(
    data: DevolucionCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Usuario, Depends(get_manager_user)],
):
    try:
        return registrar_devolucion(db, data, user.id)
    except VentaNoEncontrada as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    except DevolucionExcedida as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
    except DevolucionError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e))
