import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError, InternalError

from app.api.routers import (
    auth,
    categorias,
    clientes,
    compras,
    dashboard,
    devoluciones,
    inventario,
    mermas,
    productos,
    proveedores,
    usuarios,
    ventas,
)
from app.core.database import engine

logger = logging.getLogger(__name__)

# Orígenes explícitos (no "*"): con allow_credentials=True el navegador rechaza el comodín
ORIGENES_PERMITIDOS = ["http://localhost:5173", "http://127.0.0.1:5173"]

Path("static/uploads/productos").mkdir(parents=True, exist_ok=True)
with engine.begin() as _conn:
    _conn.execute(text("ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(255)"))
    _conn.execute(text("ALTER TABLE compras ADD COLUMN IF NOT EXISTS factura_proveedor VARCHAR(60)"))
    _conn.execute(text("ALTER TABLE pagos ADD COLUMN IF NOT EXISTS referencia VARCHAR(80)"))
    # Las devoluciones sin reingreso registran una merma con un motivo que la restricción original no admite
    _def_motivo = _conn.execute(
        text("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'mermas_motivo_check'")
    ).scalar()
    if _def_motivo is not None and "DEVOLUCION_DEFECTUOSA" not in _def_motivo:
        _conn.execute(text("ALTER TABLE mermas DROP CONSTRAINT mermas_motivo_check"))
        _conn.execute(
            text(
                "ALTER TABLE mermas ADD CONSTRAINT mermas_motivo_check CHECK (motivo IN "
                "('CADUCIDAD', 'ROTURA_DAÑO', 'CONSUMO_INTERNO_TIENDA', 'DEVOLUCION_DEFECTUOSA'))"
            )
        )

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

_ROUTERS = (
    auth.router,
    ventas.router,
    productos.router,
    categorias.router,
    clientes.router,
    proveedores.router,
    compras.router,
    mermas.router,
    devoluciones.router,
    inventario.router,
    dashboard.router,
    usuarios.router,
)

for _router in _ROUTERS:
    app.include_router(_router)
    app.include_router(_router, prefix="/api", include_in_schema=False)
