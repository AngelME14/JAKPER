from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import DUMMY_HASH, create_access_token, verify_password
from app.models import Usuario
from app.schemas.auth import TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(
    data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[Session, Depends(get_db)],
):
    user = db.scalar(select(Usuario).where(Usuario.usuario == data.username))
    # Siempre se verifica un hash, exista o no el usuario
    ok = verify_password(data.password, user.password_hash if user else DUMMY_HASH)
    if not (user and ok and user.activo):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario o contraseña incorrectos")
    return TokenResponse(access_token=create_access_token(user.id, user.rol))
