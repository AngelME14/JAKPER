from datetime import datetime
from decimal import Decimal
from typing import Annotated

from sqlalchemy import BigInteger, DateTime, Identity, Numeric, text
from sqlalchemy.orm import mapped_column

pk = Annotated[
    int, mapped_column(BigInteger, Identity(always=True), primary_key=True)
]
now_tz = Annotated[
    datetime,
    mapped_column(DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP")),
]
money = Annotated[Decimal, mapped_column(Numeric(12, 2))]
qty = Annotated[Decimal, mapped_column(Numeric(10, 3))]
