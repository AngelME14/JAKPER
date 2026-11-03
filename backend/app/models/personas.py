from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, String, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.types import now_tz, pk

if TYPE_CHECKING:
    from app.models.compras import Compra
    from app.models.ventas import Venta


class Usuario(Base):
    __tablename__ = "usuarios"
    __table_args__ = (
        CheckConstraint("rol IN ('Admin', 'Encargado', 'Cajero')"),
    )

    id: Mapped[pk]
    nombre: Mapped[str] = mapped_column(String(120))
    usuario: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    rol: Mapped[str] = mapped_column(String(20))
    activo: Mapped[bool] = mapped_column(server_default=true())
    creado_en: Mapped[now_tz]

    ventas: Mapped[list["Venta"]] = relationship(back_populates="usuario")
    compras: Mapped[list["Compra"]] = relationship(back_populates="usuario")


class Cliente(Base):
    __tablename__ = "clientes"

    id: Mapped[pk]
    nombre: Mapped[str] = mapped_column(String(150))
    telefono: Mapped[str | None] = mapped_column(String(20))
    correo: Mapped[str | None] = mapped_column(String(120))
    activo: Mapped[bool] = mapped_column(server_default=true())
    creado_en: Mapped[now_tz]

    ventas: Mapped[list["Venta"]] = relationship(back_populates="cliente")


class Proveedor(Base):
    __tablename__ = "proveedores"

    id: Mapped[pk]
    razon_social: Mapped[str] = mapped_column(String(150))
    rfc: Mapped[str | None] = mapped_column(String(15))
    telefono: Mapped[str | None] = mapped_column(String(20))
    correo: Mapped[str | None] = mapped_column(String(120))
    activo: Mapped[bool] = mapped_column(server_default=true())
    creado_en: Mapped[now_tz]

    compras: Mapped[list["Compra"]] = relationship(back_populates="proveedor")
