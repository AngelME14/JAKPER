from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import Usuario
from app.schemas.inventario import MermaCreate, MermaResponse
from app.services.mermas_service import MermaError, StockInsuficiente, registrar_merma

router = APIRouter(prefix="/mermas", tags=["mermas"])


@router.post("", response_model=MermaResponse, status_code=status.HTTP_201_CREATED)
def dar_de_baja(
    data: MermaCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[Usuario, Depends(get_current_user)],
):
    try:
        return registrar_merma(db, data, user.id)
    except StockInsuficiente as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
    except MermaError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e))
