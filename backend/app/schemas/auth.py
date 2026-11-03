from pydantic import BaseModel, Field

from app.schemas.types import Entrada


class LoginRequest(Entrada):
    usuario: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=72)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
