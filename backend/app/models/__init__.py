from app.models.catalogo import Categoria, LoteStock, Producto
from app.models.compras import Compra, DetalleCompra
from app.models.inventario import Merma, MovimientoInventario
from app.models.personas import Cliente, Proveedor, Usuario
from app.models.ventas import Devolucion, DetalleVenta, Pago, Venta

__all__ = [
    "Categoria", "Cliente", "Compra", "DetalleCompra", "DetalleVenta",
    "Devolucion", "LoteStock", "Merma", "MovimientoInventario", "Pago",
    "Producto", "Proveedor", "Usuario", "Venta",
]
