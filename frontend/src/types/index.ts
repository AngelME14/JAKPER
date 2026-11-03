// Decimal del backend (pydantic v2) se serializa como string: ej. "12.50"
export type Decimal = string;

export type Rol = 'Admin' | 'Encargado' | 'Cajero';

export interface Usuario {
  id: number;
  nombre: string;
  usuario: string;
  rol: Rol;
  activo: boolean;
}

/** Fila de GET /usuarios (solo Admin); nunca trae la contraseña */
export interface Colaborador extends Usuario {
  creado_en: string;
}

export interface Producto {
  id: number;
  categoria_id: number;
  codigo_barras_sku: string | null;
  nombre: string;
  /** Ruta relativa al servidor, ej. static/uploads/productos/<id>.png */
  imagen_url?: string | null;
  precio_venta: Decimal;
  stock_minimo: Decimal;
  permite_decimales: boolean;
  requiere_caducidad: boolean;
  activo: boolean;
  creado_en: string;
}

export interface LoteStock {
  id: number;
  producto_id: number;
  codigo_lote: string;
  fecha_recepcion: string;
  cantidad_disponible: Decimal;
  costo_unitario: Decimal;
  fecha_caducidad: string | null;
}

/** Lote vendible tal como lo entrega /productos/buscar (sin costos) */
export type LoteDisponible = Pick<LoteStock, 'id' | 'codigo_lote' | 'cantidad_disponible' | 'fecha_caducidad'>;

/** Fila de GET /productos: stock_total y lotes solo cuentan lo vendible (activo, con existencia, no vencido) */
export interface ProductoCatalogo extends Producto {
  categoria: string;
  stock_total: Decimal;
  lotes: LoteDisponible[];
}

/** Resultado del buscador de Compras y mermas */
export type ProductoBusqueda = ProductoCatalogo;

/** Cuerpo de POST y PATCH /productos */
export interface ProductoPayload {
  categoria_id: number;
  codigo_barras_sku: string | null;
  nombre: string;
  precio_venta: Decimal;
  stock_minimo: Decimal;
  permite_decimales: boolean;
  requiere_caducidad: boolean;
}

export interface Categoria {
  id: number;
  nombre: string;
  creado_en: string;
}

export interface Cliente {
  id: number;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  activo: boolean;
}

export interface DetalleVenta {
  id: number;
  producto_id: number;
  nombre_producto: string;
  lote_id: number;
  codigo_lote: string;
  cantidad: Decimal;
  precio_unitario_aplicado: Decimal;
  subtotal: Decimal;
}

export type TipoMovimiento =
  | 'ENTRADA_COMPRA'
  | 'VENTA'
  | 'CANCELACION_VENTA'
  | 'MERMA'
  | 'DEVOLUCION_STOCK'
  | 'AJUSTE_ENTRADA'
  | 'AJUSTE_SALIDA';

export type MotivoMerma = 'CADUCIDAD' | 'ROTURA_DAÑO' | 'CONSUMO_INTERNO_TIENDA';

export interface MovimientoKardex {
  id: number;
  producto_id: number;
  lote_id: number;
  tipo: TipoMovimiento;
  tipo_movimiento: TipoMovimiento;
  folio_documento: string;
  documento_id: number | null;
  cantidad: Decimal;
  saldo_resultante: Decimal;
  permite_decimales: boolean;
  usuario_id: number;
  usuario_nombre: string;
  nombre_usuario: string;
  motivo: string | null;
  motivo_legible: string;
  detalle_compra_id: number | null;
  detalle_venta_id: number | null;
  merma_id: number | null;
  devolucion_id: number | null;
  fecha: string;
  nombre_producto: string;
  codigo_lote: string;
}

/** Lote con existencia tal como lo entrega /productos/{id}/lotes (con costo; solo Admin y Encargado) */
export interface LoteMermable extends LoteStock {
  activo: boolean;
}

export interface MermaResponse {
  id: number;
  producto_id: number;
  lote_id: number;
  cantidad: Decimal;
  costo_unitario_perdida: Decimal;
  motivo: MotivoMerma;
  descripcion: string | null;
  fecha: string;
}

/** Renglon de GET /ventas/folio/{folio}: lo vendido y lo que aun puede devolverse */
export interface DetalleDevolvible {
  id: number;
  producto_id: number;
  nombre_producto: string;
  codigo_lote: string;
  permite_decimales: boolean;
  cantidad: Decimal;
  cantidad_devuelta: Decimal;
  cantidad_disponible: Decimal;
  precio_unitario_aplicado: Decimal;
  subtotal: Decimal;
}

export interface VentaDevolucion {
  id: number;
  folio: string;
  fecha_venta: string;
  total: Decimal;
  estado: EstadoVenta;
  cliente: Pick<Cliente, 'id' | 'nombre'>;
  usuario: Pick<Usuario, 'id' | 'nombre'>;
  items: DetalleDevolvible[];
}

/** Cuerpo de POST /ventas/{venta_id}/devoluciones */
export interface DevolucionPayload {
  detalle_venta_id: number;
  cantidad: string;
  motivo: string;
  reingreso_a_stock: boolean;
}

export interface Proveedor {
  id: number;
  razon_social: string;
  rfc: string | null;
  telefono: string | null;
  correo: string | null;
  activo: boolean;
}

export interface CompraResponse {
  id: number;
  folio: string;
  proveedor_id: number;
  total: Decimal;
}

export interface DetalleCompraComprobante {
  id: number;
  producto_id: number;
  nombre_producto: string;
  lote_id: number;
  codigo_lote: string;
  cantidad: Decimal;
  costo_unitario: Decimal;
  subtotal: Decimal;
}

/** GET /compras/{id}: solo Admin y Encargado (trae costos) */
export interface CompraComprobante extends CompraResponse {
  usuario_id: number;
  usuario_nombre: string;
  proveedor_nombre: string;
  /** Factura o remision que trajo el proveedor */
  factura_proveedor: string | null;
  estado: 'RECIBIDA' | 'CANCELADA';
  fecha_compra: string;
  items: DetalleCompraComprobante[];
}

export interface StockCriticoItem {
  producto_id: number;
  nombre: string;
  stock_minimo: Decimal;
  stock_actual: Decimal;
}

export interface LotePorCaducarItem {
  lote_id: number;
  producto_id: number;
  nombre_producto: string;
  codigo_lote: string;
  fecha_caducidad: string;
  /** Negativo = ya vencido */
  dias_restantes: number;
  cantidad_disponible: Decimal;
}

export interface AlertasResponse {
  stock_critico: StockCriticoItem[];
  lotes_por_caducar: LotePorCaducarItem[];
  /** Suma de cantidad x costo_unitario_perdida de las mermas del mes en curso */
  mermas_mes_actual: Decimal;
}

export type MetodoPago = 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA';

export interface PagoVenta {
  id: number;
  metodo: MetodoPago;
  importe: Decimal;
  pago_con: Decimal | null;
  cambio: Decimal | null;
  /** Voucher / autorizacion (TARJETA) o clave de rastreo (TRANSFERENCIA) */
  referencia?: string | null;
  fecha_pago: string;
}

export type EstadoVenta = 'COMPLETADA' | 'CANCELADA';

export interface VentaResponse {
  id: number;
  folio: string;
  fecha_venta: string;
  subtotal: Decimal;
  total: Decimal;
  estado: EstadoVenta;
  motivo_cancelacion: string | null;
  cliente: Pick<Cliente, 'id' | 'nombre'>;
  usuario: Pick<Usuario, 'id' | 'nombre'>;
  items: DetalleVenta[];
  pagos: PagoVenta[];
}

export interface VentaDia {
  fecha: string;
  total: Decimal;
}

export interface ResumenResponse {
  /** Unidades vendibles: lotes activos de productos activos */
  stock_total: Decimal;
  productos_activos: number;
  ventas_mes: Decimal;
  ventas_mes_anterior: Decimal;
  /** Del mas antiguo a hoy, con 0 en los dias sin ventas */
  ventas_ultimos_7_dias: VentaDia[];
}
