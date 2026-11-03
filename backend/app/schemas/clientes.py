from pydantic import BaseModel, ConfigDict


class ClienteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    telefono: str | None
    correo: str | None
    activo: bool
