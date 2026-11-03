import json
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Callable
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy import func, literal, or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, get_manager_user
from app.core.database import get_db
from app.models import Compra, DetalleCompra, LoteStock, Producto, Usuario
from app.schemas.productos import (
    LoteStockResponse,
    ProductoBusquedaResponse,
    ProductoCatalogoResponse,
    ProductoResponse,
    ProductoUpdate,
    UltimoCostoResponse,
)
from app.schemas.types import Dinero, Stock

DIRECTORIO_IMAGENES_PRODUCTOS = Path("static/uploads/productos")
# Tope duro de la foto: 5 MB. Se aplica antes de parsear el multipart (Content-Length) y de nuevo al leer
LIMITE_IMAGEN_BYTES = 5 * 1024 * 1024
_MARGEN_MULTIPART_BYTES = 256 * 1024  # campos del formulario y delimitadores
MENSAJE_IMAGEN_GRANDE = "La imagen supera el límite de 5 MB."
_EXTENSIONES_IMAGEN = {
    ".jpg": ".jpg",
    ".jpeg": ".jpg",
    ".png": ".png",
    ".webp": ".webp",
}
_CONTENT_TYPES_IMAGEN = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


class _FormOrJsonRoute(APIRoute):
    """Permite que endpoints Form/Multipart también acepten payloads JSON existentes."""

    def get_route_handler(self) -> Callable:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            content_type = request.headers.get("content-type", "")
            if request.method in ("POST", "PUT") and content_type.startswith("multipart/form-data"):
                # Rechazo temprano: el cuerpo no se parsea ni se vuelca a disco si ya declara ser demasiado grande
                declarado = request.headers.get("content-length", "")
                if declarado.isdigit() and int(declarado) > LIMITE_IMAGEN_BYTES + _MARGEN_MULTIPART_BYTES:
                    return JSONResponse({"detail": MENSAJE_IMAGEN_GRANDE}, status_code=413)
            if request.method in ("POST", "PUT") and content_type.startswith("application/json"):
                raw = await request.body()
                if raw:
                    try:
                        payload = json.loads(raw)
                    except ValueError:
                        payload = None
                    if isinstance(payload, dict):
                        pares = {
                            k: ("true" if v else "false") if isinstance(v, bool) else str(v)
                            for k, v in payload.items()
                            if v is not None
                        }
                        encoded = urlencode(pares).encode("utf-8")
                        request._body = encoded
                        nuevos_headers = [
                            (k, v)
                            for k, v in request.scope["headers"]
                            if k.lower() not in (b"content-type", b"content-length")
                        ]
                        nuevos_headers.append(
                            (b"content-type", b"application/x-www-form-urlencoded")
                        )
                        nuevos_headers.append(
                            (b"content-length", str(len(encoded)).encode("latin-1"))
                        )
                        request.scope["headers"] = nuevos_headers
                        if hasattr(request, "_headers"):
                            delattr(request, "_headers")
            return await original(request)

        return handler


def _validar_booleano_puro(valor: str | bool, nombre_campo: str) -> bool:
    if isinstance(valor, bool):
        return valor
    texto = str(valor).strip().lower()
    if texto in ("true", "1"):
        return True
    if texto in ("false", "0"):
        return False
    raise HTTPException(
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        f"El campo '{nombre_campo}' debe ser un booleano puro (true/false), no '{valor}'",
    )


def _guardar_imagen_producto(imagen: UploadFile | None) -> str | None:
    if imagen is None or not imagen.filename:
        return None
    sufijo = Path(imagen.filename).suffix.lower()
    content_type = (imagen.content_type or "").lower()
    ext = _EXTENSIONES_IMAGEN.get(sufijo)
    if ext is None or (content_type and content_type not in _CONTENT_TYPES_IMAGEN):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Formato de imagen inválido. Solo se admiten archivos JPG, PNG o WEBP.",
        )
    DIRECTORIO_IMAGENES_PRODUCTOS.mkdir(parents=True, exist_ok=True)
    nombre_sanitizado = f"{uuid.uuid4().hex}{ext}"
    destino = DIRECTORIO_IMAGENES_PRODUCTOS / nombre_sanitizado
    # Se lee un byte de más: basta para saber que se excedió sin cargar el archivo completo en memoria
    contenido = imagen.file.read(LIMITE_IMAGEN_BYTES + 1)
    if len(contenido) > LIMITE_IMAGEN_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, MENSAJE_IMAGEN_GRANDE)
    if not contenido:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "El archivo de imagen está vacío.",
        )
    destino.write_bytes(contenido)
    return f"static/uploads/productos/{nombre_sanitizado}"


router = APIRouter(prefix="/productos", tags=["productos"], route_class=_FormOrJsonRoute)


@router.get("", response_model=list[ProductoCatalogoResponse])
def listar_productos(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_current_user)],
    q: Annotated[str | None, Query(min_length=2, max_length=150)] = None,
    categoria_id: int | None = None,
    activo: bool | None = None,
    limite: Annotated[int, Query(ge=1, le=200)] = 100,
    desplazamiento: Annotated[int, Query(ge=0)] = 0,
):
    """Catálogo con existencia vendible. `activo` sin definir devuelve activos e inactivos.

    Con `q` combina pg_trgm (errores ortográficos) con coincidencia parcial de nombre y SKU.
    """
    stmt = select(Producto).options(joinedload(Producto.categoria))
    if q is not None:
        # word_similarity compara contra la mejor palabra: un nombre largo no diluye la coincidencia
        db.execute(select(func.set_config("pg_trgm.word_similarity_threshold", "0.3", True)))
        stmt = stmt.where(
            or_(
                literal(q).op("<%")(Producto.nombre),
                Producto.nombre.icontains(q, autoescape=True),
                Producto.codigo_barras_sku.istartswith(q, autoescape=True),
            )
        ).order_by(func.word_similarity(q, Producto.nombre).desc())
    if categoria_id is not None:
        stmt = stmt.where(Producto.categoria_id == categoria_id)
    if activo is not None:
        stmt = stmt.where(Producto.activo.is_(activo))
    productos = db.scalars(
        stmt.order_by(Producto.nombre, Producto.id).limit(limite).offset(desplazamiento)
    ).all()
    lotes = _lotes_disponibles(db, list(productos))
    return [
        ProductoCatalogoResponse(
            **ProductoResponse.model_validate(p).model_dump(),
            categoria=p.categoria.nombre,
            stock_total=sum((l.cantidad_disponible for l in lotes[p.id]), Decimal(0)),
            lotes=lotes[p.id],
        )
        for p in productos
    ]


@router.post("", response_model=ProductoResponse, status_code=status.HTTP_201_CREATED)
def crear_producto(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_manager_user)],
    categoria_id: Annotated[int, Form(...)],
    nombre: Annotated[str, Form(min_length=1, max_length=150)],
    precio_venta: Annotated[Dinero, Form(...)],
    codigo_barras_sku: Annotated[str | None, Form(max_length=60)] = None,
    stock_minimo: Annotated[Stock, Form()] = Decimal(0),
    permite_decimales: Annotated[str | bool, Form()] = False,
    requiere_caducidad: Annotated[str | bool, Form()] = False,
    imagen: Annotated[UploadFile | None, File()] = None,
):
    permite_dec_bool = _validar_booleano_puro(permite_decimales, "permite_decimales")
    requiere_cad_bool = _validar_booleano_puro(requiere_caducidad, "requiere_caducidad")
    sku_limpio = codigo_barras_sku.strip() if codigo_barras_sku else None
    imagen_url = _guardar_imagen_producto(imagen)

    producto = Producto(
        categoria_id=categoria_id,
        codigo_barras_sku=sku_limpio or None,
        nombre=nombre.strip(),
        imagen_url=imagen_url,
        precio_venta=precio_venta,
        stock_minimo=stock_minimo,
        permite_decimales=permite_dec_bool,
        requiere_caducidad=requiere_cad_bool,
    )
    db.add(producto)
    db.commit()
    db.refresh(producto)
    return producto


@router.put("/{producto_id}", response_model=ProductoResponse)
def reemplazar_producto(
    producto_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_manager_user)],
    categoria_id: Annotated[int | None, Form()] = None,
    nombre: Annotated[str | None, Form(min_length=1, max_length=150)] = None,
    precio_venta: Annotated[Dinero | None, Form()] = None,
    codigo_barras_sku: Annotated[str | None, Form(max_length=60)] = None,
    stock_minimo: Annotated[Stock | None, Form()] = None,
    permite_decimales: Annotated[str | bool | None, Form()] = None,
    requiere_caducidad: Annotated[str | bool | None, Form()] = None,
    activo: Annotated[str | bool | None, Form()] = None,
    imagen: Annotated[UploadFile | None, File()] = None,
):
    producto = db.get(Producto, producto_id)
    if producto is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Producto {producto_id} inexistente")

    if categoria_id is not None:
        producto.categoria_id = categoria_id
    if nombre is not None:
        producto.nombre = nombre.strip()
    if precio_venta is not None:
        producto.precio_venta = precio_venta
    if codigo_barras_sku is not None:
        producto.codigo_barras_sku = codigo_barras_sku.strip() or None
    if stock_minimo is not None:
        producto.stock_minimo = stock_minimo
    if permite_decimales is not None:
        producto.permite_decimales = _validar_booleano_puro(permite_decimales, "permite_decimales")
    if requiere_caducidad is not None:
        producto.requiere_caducidad = _validar_booleano_puro(requiere_caducidad, "requiere_caducidad")
    if activo is not None:
        producto.activo = _validar_booleano_puro(activo, "activo")

    nueva_imagen_url = _guardar_imagen_producto(imagen)
    if nueva_imagen_url is not None:
        producto.imagen_url = nueva_imagen_url

    db.commit()
    db.refresh(producto)
    return producto


@router.patch("/{producto_id}", response_model=ProductoResponse)
def actualizar_producto(
    producto_id: int,
    data: ProductoUpdate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_manager_user)],
):
    producto = db.get(Producto, producto_id)
    if producto is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Producto {producto_id} inexistente")
    for campo, valor in data.model_dump(exclude_unset=True).items():
        # El SKU es el único campo que admite quitarse; los demás ignoran null
        if valor is not None or campo == "codigo_barras_sku":
            setattr(producto, campo, valor)
    db.commit()
    db.refresh(producto)
    return producto


@router.get("/buscar", response_model=list[ProductoBusquedaResponse])
def buscar_productos(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_current_user)],
    q: Annotated[str, Query(min_length=2, max_length=150)],
    umbral: Annotated[float, Query(ge=0.05, le=1)] = 0.3,
    limite: Annotated[int, Query(ge=1, le=100)] = 20,
    incluir_inactivos: bool = False,
):
    """Búsqueda difusa por nombre (pg_trgm), tolerante a errores ortográficos.

    Usa el operador `%`, que aprovecha el índice GIN idx_productos_nombre_trgm.
    El SKU exacto también coincide (lector de código de barras).
    """
    # is_local=true: el umbral vale solo para esta transacción, no contamina el pool
    db.execute(select(func.set_config("pg_trgm.similarity_threshold", str(umbral), True)))
    similitud = func.similarity(Producto.nombre, q)
    stmt = (
        select(Producto, similitud.label("similitud"))
        .where(or_(Producto.nombre.op("%")(q), Producto.codigo_barras_sku == q))
        .order_by(similitud.desc(), Producto.nombre)
        .limit(limite)
    )
    if not incluir_inactivos:
        stmt = stmt.where(Producto.activo.is_(True))
    encontrados = db.execute(stmt).all()
    lotes = _lotes_disponibles(db, [p for p, _ in encontrados])
    return [
        ProductoBusquedaResponse(
            **ProductoResponse.model_validate(p).model_dump(),
            similitud=s,
            stock_total=sum((l.cantidad_disponible for l in lotes[p.id]), Decimal(0)),
            lotes=lotes[p.id],
        )
        for p, s in encontrados
    ]


@router.get("/{producto_id}/lotes", response_model=list[LoteStockResponse])
def lotes_con_existencia(
    producto_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_manager_user)],
):
    """Lotes con existencia, incluidos vencidos e inactivos (son los que se dan de baja como merma).

    Expone el costo de adquisición, por eso es solo para Admin y Encargado.
    """
    if db.get(Producto, producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Producto {producto_id} inexistente")
    return db.scalars(
        select(LoteStock)
        .where(LoteStock.producto_id == producto_id, LoteStock.cantidad_disponible > 0)
        .order_by(LoteStock.fecha_caducidad.asc().nulls_last(), LoteStock.id)
    ).all()


@router.get("/{producto_id}/ultimo-costo", response_model=UltimoCostoResponse)
def obtener_ultimo_costo(
    producto_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[Usuario, Depends(get_current_user)],
):
    """Último costo unitario registrado en detalle_compras para el producto (ordenado por fecha de compra DESC).

    Sin compras, usa el costo del lote más reciente en lotes_stock. Si tampoco hay lotes, devuelve 0.00.
    """
    if db.get(Producto, producto_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Producto {producto_id} inexistente")
    ultimo = db.scalar(
        select(DetalleCompra.costo_unitario)
        .join(Compra, DetalleCompra.compra_id == Compra.id)
        .where(
            DetalleCompra.producto_id == producto_id,
            Compra.estado != "CANCELADA",
        )
        .order_by(Compra.fecha_compra.desc(), DetalleCompra.id.desc())
        .limit(1)
    )
    if ultimo is None:
        # Sin compras registradas: el costo del lote mas reciente (altas de lote directas)
        ultimo = db.scalar(
            select(LoteStock.costo_unitario)
            .where(LoteStock.producto_id == producto_id)
            .order_by(LoteStock.fecha_recepcion.desc(), LoteStock.id.desc())
            .limit(1)
        )
    costo = ultimo if ultimo is not None else Decimal("0.00")
    return UltimoCostoResponse(
        producto_id=producto_id,
        ultimo_costo=costo,
        costo_unitario=costo,
    )


def _lotes_disponibles(db: Session, productos: list[Producto]) -> dict[int, list[LoteStock]]:
    """Lotes vendibles por producto, en el mismo orden que ventas_service._despachar."""
    por_producto: dict[int, list[LoteStock]] = {p.id: [] for p in productos}
    if not productos:
        return por_producto
    hoy = date.today()
    todos = db.scalars(
        select(LoteStock)
        .where(
            LoteStock.producto_id.in_(list(por_producto)),
            LoteStock.activo.is_(True),
            LoteStock.cantidad_disponible > 0,
        )
        .order_by(LoteStock.fecha_recepcion, LoteStock.id)
    )
    for lote in todos:
        if lote.fecha_caducidad is None or lote.fecha_caducidad >= hoy:
            por_producto[lote.producto_id].append(lote)
    for p in productos:
        if p.requiere_caducidad:
            # FEFO; sort estable: a igual caducidad conserva el orden FIFO
            por_producto[p.id].sort(key=lambda l: (l.fecha_caducidad is None, l.fecha_caducidad or hoy))
    return por_producto
