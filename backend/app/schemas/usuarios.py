from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.schemas.types import Entrada

Rol = Literal["Admin", "Encargado", "Cajero"]

Nombre = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
# Sin espacios: es lo que la persona teclea en el login
NombreUsuario = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=3, max_length=50, pattern=r"^[A-Za-z0-9._-]+$")
]


def _validar_password(valor: str) -> str:
    # bcrypt solo lee los primeros 72 bytes y la libreria rechaza mas
    if len(valor.encode()) > 72:
        raise ValueError("La contraseña no puede pasar de 72 bytes")
    if len(valor) < 8:
        raise ValueError("La contraseña debe tener al menos 8 caracteres")
    return valor


class UsuarioCreate(Entrada):
    nombre: Nombre
    usuario: NombreUsuario
    password: str = Field(max_length=72)
    rol: Rol

    _password = field_validator("password")(_validar_password)


class UsuarioUpdate(Entrada):
    nombre: Nombre | None = None
    usuario: NombreUsuario | None = None
    rol: Rol | None = None


class PasswordUpdate(Entrada):
    password: str = Field(max_length=72)

    _password = field_validator("password")(_validar_password)


class UsuarioResponse(BaseModel):
    """Nunca incluye password_hash."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    usuario: str
    rol: Rol
    activo: bool
    creado_en: datetime
