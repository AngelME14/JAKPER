from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import Categoria, Usuario
from app.schemas.productos import CategoriaResponse

router = APIRouter(prefix="/categorias", tags=["categorias"])


@router.get("", response_model=list[CategoriaResponse])
def listar_categorias(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_current_user)],
):
    """Categorías por nombre, para filtrar y clasificar productos."""
    return db.scalars(select(Categoria).order_by(Categoria.nombre)).all()
