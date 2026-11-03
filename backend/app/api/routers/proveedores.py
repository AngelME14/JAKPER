from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_manager_user
from app.core.database import get_db
from app.models import Proveedor, Usuario
from app.schemas.proveedores import ProveedorCreate, ProveedorResponse

router = APIRouter(prefix="/proveedores", tags=["proveedores"])


@router.get("", response_model=list[ProveedorResponse])
def listar_proveedores(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_current_user)],
    incluir_inactivos: bool = False,
):
    """Proveedores por razón social, para elegir el origen de una compra."""
    stmt = select(Proveedor).order_by(Proveedor.razon_social, Proveedor.id)
    if not incluir_inactivos:
        stmt = stmt.where(Proveedor.activo.is_(True))
    return db.scalars(stmt).all()


@router.post("", response_model=ProveedorResponse, status_code=status.HTTP_201_CREATED)
def crear_proveedor(
    data: ProveedorCreate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_manager_user)],
):
    """Registra un nuevo proveedor en el catálogo."""
    proveedor = Proveedor(**data.model_dump())
    db.add(proveedor)
    db.commit()
    db.refresh(proveedor)
    return proveedor
