from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user
from app.core.database import get_db
from app.core.security import hash_password
from app.models import Usuario
from app.schemas.usuarios import PasswordUpdate, UsuarioCreate, UsuarioResponse, UsuarioUpdate

# Todo el modulo es solo para Admin
router = APIRouter(
    prefix="/usuarios",
    tags=["usuarios"],
    dependencies=[Depends(get_admin_user)],
)

_ULTIMO_ADMIN = "Debe quedar al menos un Admin activo en el sistema"


def _obtener(db: Session, usuario_id: int) -> Usuario:
    usuario = db.get(Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Usuario {usuario_id} inexistente")
    return usuario


def _es_unico_admin_activo(db: Session, usuario: Usuario) -> bool:
    """True si `usuario` es hoy el unico Admin activo.

    Las filas de los Admin activos se bloquean hasta el commit: dos peticiones que intenten
    desactivar o degradar a los dos ultimos Admin no pueden pasar a la vez.
    """
    if usuario.rol != "Admin" or not usuario.activo:
        return False
    ids = db.scalars(
        select(Usuario.id).where(Usuario.rol == "Admin", Usuario.activo.is_(True)).with_for_update()
    ).all()
    return ids == [usuario.id]


def _validar_usuario_libre(db: Session, nombre_usuario: str, ignorar_id: int | None = None) -> None:
    existente = db.scalar(select(Usuario.id).where(Usuario.usuario == nombre_usuario))
    if existente is not None and existente != ignorar_id:
        raise HTTPException(status.HTTP_409_CONFLICT, f"El usuario '{nombre_usuario}' ya existe")


@router.get("", response_model=list[UsuarioResponse])
def listar_usuarios(db: Annotated[Session, Depends(get_db)]):
    return db.scalars(select(Usuario).order_by(Usuario.id.asc())).all()


@router.post("", response_model=UsuarioResponse, status_code=status.HTTP_201_CREATED)
def crear_usuario(data: UsuarioCreate, db: Annotated[Session, Depends(get_db)]):
    _validar_usuario_libre(db, data.usuario)
    usuario = Usuario(
        nombre=data.nombre,
        usuario=data.usuario,
        password_hash=hash_password(data.password),
        rol=data.rol,
    )
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return usuario


@router.patch("/{usuario_id}", response_model=UsuarioResponse)
def editar_usuario(usuario_id: int, data: UsuarioUpdate, db: Annotated[Session, Depends(get_db)]):
    """Nombre, nombre de usuario y rol. La contraseña y el estado tienen su propio endpoint."""
    usuario = _obtener(db, usuario_id)
    if data.usuario is not None and data.usuario != usuario.usuario:
        _validar_usuario_libre(db, data.usuario, ignorar_id=usuario.id)
        usuario.usuario = data.usuario
    if data.nombre is not None:
        usuario.nombre = data.nombre
    if data.rol is not None and data.rol != usuario.rol:
        if _es_unico_admin_activo(db, usuario):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, _ULTIMO_ADMIN)
        usuario.rol = data.rol
    db.commit()
    db.refresh(usuario)
    return usuario


@router.patch("/{usuario_id}/toggle-activo", response_model=UsuarioResponse)
def alternar_activo(usuario_id: int, db: Annotated[Session, Depends(get_db)]):
    usuario = _obtener(db, usuario_id)
    if usuario.activo and _es_unico_admin_activo(db, usuario):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, _ULTIMO_ADMIN)
    usuario.activo = not usuario.activo
    db.commit()
    db.refresh(usuario)
    return usuario


@router.patch("/{usuario_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def cambiar_password(usuario_id: int, data: PasswordUpdate, db: Annotated[Session, Depends(get_db)]):
    usuario = _obtener(db, usuario_id)
    usuario.password_hash = hash_password(data.password)
    db.commit()
