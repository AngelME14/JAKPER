from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import Cliente, Usuario
from app.schemas.clientes import ClienteResponse

router = APIRouter(prefix="/clientes", tags=["clientes"])


@router.get("", response_model=list[ClienteResponse])
def listar_clientes(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_current_user)],
):
    """Clientes activos para la venta; el id 1 (Público General) va primero."""
    return db.scalars(
        select(Cliente)
        .where(Cliente.activo.is_(True))
        .order_by(Cliente.id != 1, Cliente.nombre)
    ).all()
