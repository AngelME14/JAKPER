from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.types import Entrada


class ProveedorCreate(Entrada):
    razon_social: str = Field(min_length=1, max_length=150)
    rfc: str | None = Field(default=None, max_length=15)
    telefono: str | None = Field(default=None, max_length=20)
    correo: str | None = Field(default=None, max_length=120)

    @field_validator("razon_social")
    @classmethod
    def _limpiar_razon_social(cls, v: str) -> str:
        limpio = v.strip()
        if not limpio:
            raise ValueError("La razón social no puede estar vacía")
        return limpio

    @field_validator("rfc", "telefono", "correo")
    @classmethod
    def _normalizar_opcionales(cls, v: str | None) -> str | None:
        if v is None:
            return None
        limpio = v.strip()
        return limpio or None


class ProveedorResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    razon_social: str
    rfc: str | None
    telefono: str | None
    correo: str | None
    activo: bool
