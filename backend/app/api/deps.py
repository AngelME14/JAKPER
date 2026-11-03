from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models import Usuario

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def get_current_user(
    token: Annotated[str | None, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> Usuario:
    no_autenticado = HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "Credenciales inválidas",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if token is None:
        raise no_autenticado
    user_id = decode_access_token(token)
    if user_id is None:
        raise no_autenticado
    user = db.get(Usuario, user_id)
    if user is None or not user.activo:
        raise no_autenticado
    return user


def require_roles(*roles: str):
    def dependency(user: Annotated[Usuario, Depends(get_current_user)]) -> Usuario:
        if user.rol not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Permisos insuficientes")
        return user

    return dependency


get_admin_user = require_roles("Admin")
get_manager_user = require_roles("Admin", "Encargado")
