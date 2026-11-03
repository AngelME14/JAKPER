from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

# NUMERIC(10, 3) y NUMERIC(12, 2); Cantidad exige > 0 (CHECK cantidad > 0)
Cantidad = Annotated[Decimal, Field(gt=0, max_digits=10, decimal_places=3)]
Stock = Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=3)]
Dinero = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]


class Entrada(BaseModel):
    model_config = ConfigDict(extra="forbid")
