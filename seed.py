"""Sembrado inicial idempotente: python seed.py

Variables opcionales: ADMIN_PASSWORD (si falta se genera una y se imprime una sola vez).
"""
import os
import secrets

from sqlalchemy import text

from app.core.database import SessionLocal
from app.core.security import hash_password

CATEGORIAS = ("Medicamentos", "Alimentos", "Accesorios")


def main() -> None:
    with SessionLocal() as db, db.begin():
        # GENERATED ALWAYS exige OVERRIDING SYSTEM VALUE para fijar id = 1
        db.execute(
            text(
                "INSERT INTO clientes (id, nombre, activo) "
                "OVERRIDING SYSTEM VALUE VALUES (1, 'Público General', TRUE) "
                "ON CONFLICT (id) DO NOTHING"
            )
        )
        # OVERRIDING no avanza la secuencia: sin esto el próximo cliente chocaría con id = 1
        db.execute(
            text(
                "SELECT setval(pg_get_serial_sequence('clientes', 'id'), "
                "GREATEST((SELECT MAX(id) FROM clientes), 1))"
            )
        )

        if db.scalar(text("SELECT COUNT(*) FROM usuarios")) == 0:
            password = os.getenv("ADMIN_PASSWORD") or secrets.token_urlsafe(12)
            db.execute(
                text(
                    "INSERT INTO usuarios (nombre, usuario, password_hash, rol) "
                    "VALUES ('Administrador', 'admin', :h, 'Admin')"
                ),
                {"h": hash_password(password)},
            )
            if not os.getenv("ADMIN_PASSWORD"):
                print(f"Usuario admin creado. Contraseña generada: {password}")
            else:
                print("Usuario admin creado con ADMIN_PASSWORD.")
        else:
            print("usuarios no está vacía: admin omitido.")

        for nombre in CATEGORIAS:
            db.execute(
                text("INSERT INTO categorias (nombre) VALUES (:n) ON CONFLICT (nombre) DO NOTHING"),
                {"n": nombre},
            )
    print("Seed completado.")


if __name__ == "__main__":
    main()
