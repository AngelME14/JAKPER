import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from dotenv import load_dotenv

load_dotenv()

SECRET_KEY = os.environ["SECRET_KEY"]
ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "60"))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:  # >72 bytes o hash malformado
        return False


# Hash de relleno: login con usuario inexistente tarda igual que uno existente
DUMMY_HASH = hash_password("relleno-anti-timing")


def create_access_token(user_id: int, rol: str | None = None) -> str:
    """`rol` es solo informativo para la UI; los permisos se validan en servidor contra la BD."""
    ahora = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": ahora,
        "exp": ahora + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    if rol is not None:
        payload["rol"] = rol
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> int | None:
    """user_id si el token es válido y no expiró; None en cualquier otro caso."""
    try:
        payload = jwt.decode(
            token, SECRET_KEY, algorithms=[ALGORITHM], options={"require": ["exp", "sub"]}
        )
        return int(payload["sub"])
    except (jwt.PyJWTError, ValueError):
        return None
