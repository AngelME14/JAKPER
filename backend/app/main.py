import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from psycopg2 import errors
from sqlalchemy.exc import DataError, IntegrityError, InternalError, OperationalError

from app.api.routers import (
    auth,
    categorias,
    clientes,
    compras,
    dashboard,
    inventario,
    mermas,
    productos,
    proveedores,
    usuarios,
    ventas,
)

logger = logging.getLogger(__name__)

# Orígenes explícitos (no "*"): con allow_credentials=True el navegador rechaza el comodín
ORIGENES_PERMITIDOS = ["http://localhost:5173", "http://127.0.0.1:5173"]

Path("static/uploads/productos").mkdir(parents=True, exist_ok=True)

app = FastAPI(title="LuckyPet API")
app.mount("/static", StaticFiles(directory="static"), name="static")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGENES_PERMITIDOS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# SQLSTATE -> (status, mensaje). Los mensajes de la BD no se exponen (salvo triggers):
# traen nombres de tablas/valores internos.
_ERRORES_INTEGRIDAD = {
    "23505": (409, "Ya existe un registro con esos datos"),
    "23503": (409, "Referencia inválida o registro en uso por otros datos"),
    "23514": (409, "Los datos violan una regla de integridad"),
    "23502": (400, "Falta un dato obligatorio"),
}


async def error_de_base_de_datos(request: Request, exc: IntegrityError | DataError | InternalError):
    """Traduce errores de PostgreSQL a {"detail": ...} en lugar de un 500 genérico."""
    orig = exc.orig
    pgcode = getattr(orig, "pgcode", None)
    diag = getattr(orig, "diag", None)

    if pgcode == "P0001":
        # RAISE EXCEPTION de un trigger: el texto está escrito para el usuario final
        status, detalle = 409, getattr(diag, "message_primary", None) or str(orig).splitlines()[0]
    elif isinstance(exc, IntegrityError):
        status, detalle = _ERRORES_INTEGRIDAD.get(pgcode, (409, "Violación de integridad de datos"))
        restriccion = getattr(diag, "constraint_name", None)
        if restriccion:
            detalle = f"{detalle} ({restriccion})"
    elif isinstance(exc, DataError):
        status, detalle = 400, "Dato con formato o rango inválido"
    else:
        logger.error("Error interno de base de datos (%s)", pgcode, exc_info=exc)
        status, detalle = 500, "Error interno de base de datos"
    return JSONResponse({"detail": detalle}, status_code=status)


for _clase in (IntegrityError, DataError, InternalError):
    app.add_exception_handler(_clase, error_de_base_de_datos)

# SQLSTATE de conflictos de bloqueo: 40P01 deadlock_detected, 55P03 lock_not_available
_BLOQUEOS_PG = {"40P01", "55P03"}
MENSAJE_CONFLICTO_CONCURRENCIA = (
    "Conflicto de concurrencia: el recurso está bloqueado por otra transacción. Por favor, intenta de nuevo."
)


async def error_operacional(request: Request, exc: OperationalError):
    """Deadlocks y bloqueos no disponibles -> 409 reintentable; el resto (conexión caída, etc.) -> 503.

    Distinto de error_de_base_de_datos: no hereda de IntegrityError/DataError/InternalError,
    así que no se pisan entre sí. Nunca se devuelve ni se registra el SQL, los parámetros ni
    el texto del servidor: solo la clase y el SQLSTATE.
    """
    orig = exc.orig
    pgcode = getattr(orig, "pgcode", None)

    if pgcode in _BLOQUEOS_PG or isinstance(orig, (errors.DeadlockDetected, errors.LockNotAvailable)):
        logger.warning("Conflicto de bloqueo en PostgreSQL (%s)", pgcode)
        return JSONResponse({"detail": MENSAJE_CONFLICTO_CONCURRENCIA}, status_code=409)

    logger.error(
        "Error operacional de base de datos (%s, SQLSTATE %s)",
        type(orig).__name__ if orig is not None else type(exc).__name__,
        pgcode,
    )
    return JSONResponse(
        {"detail": "Servicio de base de datos no disponible. Intenta de nuevo en unos momentos."},
        status_code=503,
    )


app.add_exception_handler(OperationalError, error_operacional)

_ROUTERS = (
    auth.router,
    ventas.router,
    productos.router,
    categorias.router,
    clientes.router,
    proveedores.router,
    compras.router,
    mermas.router,
    inventario.router,
    dashboard.router,
    usuarios.router,
)

# Un solo montaje, sin prefijo: es lo que consume el frontend (baseURL sin /api) y declara OAuth2 (/auth/login)
for _router in _ROUTERS:
    app.include_router(_router)
