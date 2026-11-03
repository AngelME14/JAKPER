import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { aEntero, escalaATexto, fechaISO } from '../lib/numeros';
import type { LoteDisponible, MetodoPago, Producto } from '../types';

type ProductoVendible = Pick<
  Producto,
  'id' | 'nombre' | 'codigo_barras_sku' | 'precio_venta' | 'permite_decimales'
>;

/** Cliente por defecto de toda venta de mostrador */
export const CLIENTE_PUBLICO_GENERAL_ID = 1;

// Todo se guarda en enteros para evitar errores de coma flotante:
// cantidades en milesimas (NUMERIC(10,3)) y dinero en centavos (NUMERIC(12,2)).
const MILESIMAS = 1000;
const CENTAVOS = 100;

export interface LineaCarrito {
  /** Una linea por lote: es la clave del carrito */
  loteId: number;
  productoId: number;
  nombre: string;
  codigoBarras: string;
  codigoLote: string;
  precioCentavos: number;
  permiteDecimales: boolean;
  cantidadMilesimas: number;
  /** Existencia del lote al momento de agregarlo; tope de la cantidad */
  disponibleMilesimas: number;
}

/** Lo que el cliente entrega con un metodo; el importe aplicado se deriva del total */
export interface PagoCarrito {
  id: string;
  metodo: MetodoPago;
  montoCentavos: number;
  /** Voucher / autorizacion (tarjeta) o clave de rastreo (transferencia); opcional */
  referencia?: string;
}

export interface PagoAplicado {
  id: string;
  metodo: MetodoPago;
  referencia: string | null;
  importeCentavos: number;
  /** Solo EFECTIVO: billete/monto entregado */
  pagoConCentavos: number | null;
  cambioCentavos: number;
}

export interface ResumenVenta {
  totalCentavos: number;
  pagadoCentavos: number;
  pendienteCentavos: number;
  cambioCentavos: number;
  pagos: PagoAplicado[];
  /** Hay lineas y los pagos cubren el total exacto */
  cubierta: boolean;
}

export type Resultado = { ok: true } | { ok: false; error: string };

const OK: Resultado = { ok: true };
const fallo = (error: string): Resultado => ({ ok: false, error });

/** Producto del catalogo con sus lotes vendibles, ya en orden de despacho (FEFO) */
export type ProductoConLotes = ProductoVendible & { lotes: LoteDisponible[] };

/** Vista del carrito: un renglon por producto, con el desglose de los lotes que lo componen */
export interface GrupoCarrito {
  productoId: number;
  nombre: string;
  codigoBarras: string;
  precioCentavos: number;
  permiteDecimales: boolean;
  cantidadMilesimas: number;
  importeCentavos: number;
  lotes: { loteId: number; codigoLote: string; cantidadMilesimas: number }[];
}

interface PosState {
  clienteId: number;
  items: LineaCarrito[];
  /** Lotes vendibles (orden FEFO) vistos al agregar cada producto; de aqui sale el "siguiente lote" */
  lotesPorProducto: Record<number, LoteDisponible[]>;

  setCliente: (clienteId: number) => void;
  /** Suma `cantidad` del lote al carrito (crea la linea si no existe) */
  agregarLote: (producto: ProductoVendible, lote: LoteDisponible, cantidad: number) => Resultado;
  /** Fija la cantidad exacta de una linea ya existente */
  establecerCantidad: (loteId: number, cantidad: number) => Resultado;
  quitarLote: (loteId: number) => void;
  /** Agrega 1 (o el resto a granel) tomando el primer lote con existencia libre por FEFO */
  agregarProducto: (producto: ProductoConLotes) => Resultado;
  /** Igual que agregarProducto, para un producto que ya esta en el carrito */
  sumarProducto: (productoId: number) => Resultado;
  /** Resta 1 liberando primero el lote mas nuevo; con una sola unidad en ese lote lo quita */
  restarProducto: (productoId: number) => void;
  /** Fija la cantidad total del producto, repartiendola por FEFO entre sus lotes */
  establecerCantidadProducto: (productoId: number, cantidad: number) => Resultado;
  /** Quita todas las asignaciones de lote del producto */
  quitarProducto: (productoId: number) => void;
  /** Vacia el carrito y regresa al cliente por defecto */
  reiniciarVenta: () => void;
}

function validarCantidad(
  cantidad: number,
  permiteDecimales: boolean,
  disponibleMilesimas: number,
  codigoLote: string,
): { milesimas: number } | { error: string } {
  const milesimas = aEntero(cantidad, MILESIMAS);
  if (milesimas === null || milesimas <= 0) {
    return { error: 'La cantidad debe ser mayor a 0 y tener máximo 3 decimales.' };
  }
  if (!permiteDecimales && milesimas % MILESIMAS !== 0) {
    return { error: 'Este producto solo se vende en cantidades enteras.' };
  }
  if (milesimas > disponibleMilesimas) {
    return { error: `Solo hay ${disponibleMilesimas / MILESIMAS} disponibles en el lote ${codigoLote}.` };
  }
  return { milesimas };
}

export function subtotalLinea(linea: LineaCarrito): number {
  // Redondeo half-up a centavos, igual que el backend (ROUND_HALF_UP)
  return Math.floor((linea.cantidadMilesimas * linea.precioCentavos + MILESIMAS / 2) / MILESIMAS);
}

/** Agrupa las lineas por producto conservando el orden de aparicion (y el de lotes dentro del grupo) */
export function agruparItems(items: LineaCarrito[]): GrupoCarrito[] {
  const grupos = new Map<number, GrupoCarrito>();
  for (const l of items) {
    let g = grupos.get(l.productoId);
    if (!g) {
      g = {
        productoId: l.productoId,
        nombre: l.nombre,
        codigoBarras: l.codigoBarras,
        precioCentavos: l.precioCentavos,
        permiteDecimales: l.permiteDecimales,
        cantidadMilesimas: 0,
        importeCentavos: 0,
        lotes: [],
      };
      grupos.set(l.productoId, g);
    }
    g.cantidadMilesimas += l.cantidadMilesimas;
    g.importeCentavos += subtotalLinea(l);
    g.lotes.push({ loteId: l.loteId, codigoLote: l.codigoLote, cantidadMilesimas: l.cantidadMilesimas });
  }
  return [...grupos.values()];
}

/** Lote sin vencer en orden de despacho con existencia libre; 1 unidad, o lo que quede si es a granel */
export function elegirLote(
  lotes: LoteDisponible[],
  permiteDecimales: boolean,
  items: LineaCarrito[],
): { lote: LoteDisponible; cantidad: number } | null {
  const hoy = fechaISO();
  for (const lote of lotes) {
    if (lote.fecha_caducidad && lote.fecha_caducidad < hoy) continue;
    const disponible = Math.round(Number(lote.cantidad_disponible) * MILESIMAS);
    const enCarrito = items.find((l) => l.loteId === lote.id)?.cantidadMilesimas ?? 0;
    const libre = disponible - enCarrito;
    if (libre >= MILESIMAS) return { lote, cantidad: 1 };
    if (libre > 0 && permiteDecimales) return { lote, cantidad: libre / MILESIMAS };
  }
  return null;
}

export function calcularResumen(items: LineaCarrito[], pagos: PagoCarrito[]): ResumenVenta {
  const totalCentavos = items.reduce((suma, linea) => suma + subtotalLinea(linea), 0);

  // Los pagos se reparten en orden contra el total: asi un cambio en el
  // carrito recalcula importe y cambio sin dejar pagos desfasados.
  let restante = totalCentavos;
  const aplicados = pagos.map<PagoAplicado>((pago) => {
    const importeCentavos = Math.min(pago.montoCentavos, restante);
    restante -= importeCentavos;
    const efectivo = pago.metodo === 'EFECTIVO';
    return {
      id: pago.id,
      metodo: pago.metodo,
      referencia: pago.referencia?.trim() || null,
      importeCentavos,
      pagoConCentavos: efectivo ? pago.montoCentavos : null,
      cambioCentavos: efectivo ? pago.montoCentavos - importeCentavos : 0,
    };
  });

  return {
    totalCentavos,
    pagadoCentavos: totalCentavos - restante,
    pendienteCentavos: restante,
    cambioCentavos: aplicados.reduce((suma, pago) => suma + pago.cambioCentavos, 0),
    pagos: aplicados,
    cubierta: items.length > 0 && restante === 0,
  };
}

function productoDeLinea(l: LineaCarrito): ProductoVendible {
  return {
    id: l.productoId,
    nombre: l.nombre,
    codigo_barras_sku: l.codigoBarras || null,
    precio_venta: String(l.precioCentavos / CENTAVOS),
    permite_decimales: l.permiteDecimales,
  };
}

/** Lotes conocidos del producto en orden FEFO; si faltan los vistos, se reconstruyen desde sus lineas */
function lotesDe(
  { lotesPorProducto, items }: Pick<PosState, 'lotesPorProducto' | 'items'>,
  productoId: number,
): LoteDisponible[] {
  const vistos = lotesPorProducto[productoId] ?? [];
  const ids = new Set(vistos.map((l) => l.id));
  const propios = items
    .filter((l) => l.productoId === productoId && !ids.has(l.loteId))
    .map<LoteDisponible>((l) => ({
      id: l.loteId,
      codigo_lote: l.codigoLote,
      cantidad_disponible: String(l.disponibleMilesimas / MILESIMAS),
      fecha_caducidad: null,
    }));
  return [...vistos, ...propios];
}

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      clienteId: CLIENTE_PUBLICO_GENERAL_ID,
      items: [],
      lotesPorProducto: {},

      setCliente: (clienteId) => set({ clienteId }),

      agregarLote: (producto, lote, cantidad) => {
        if (lote.fecha_caducidad && lote.fecha_caducidad < fechaISO()) {
          return fallo(`El lote ${lote.codigo_lote} está vencido.`);
        }
        const disponibleMilesimas = Math.round(Number(lote.cantidad_disponible) * MILESIMAS);
        const previa = get().items.find((l) => l.loteId === lote.id)?.cantidadMilesimas ?? 0;

        // Valida la cantidad acumulada, no solo lo que se agrega ahora
        const agregada = aEntero(cantidad, MILESIMAS);
        if (agregada === null) return fallo('La cantidad debe tener máximo 3 decimales.');
        const validada = validarCantidad(
          (previa + agregada) / MILESIMAS,
          producto.permite_decimales,
          disponibleMilesimas,
          lote.codigo_lote,
        );
        if ('error' in validada) return fallo(validada.error);
        if (agregada <= 0) return fallo('La cantidad debe ser mayor a 0.');

        const precioCentavos = Math.round(Number(producto.precio_venta) * CENTAVOS);
        const linea: LineaCarrito = {
          loteId: lote.id,
          productoId: producto.id,
          nombre: producto.nombre,
          codigoBarras: producto.codigo_barras_sku ?? '',
          codigoLote: lote.codigo_lote,
          precioCentavos,
          permiteDecimales: producto.permite_decimales,
          cantidadMilesimas: validada.milesimas,
          disponibleMilesimas,
        };
        set((s) => {
          // El precio es del producto: lo alinea en sus otras lineas
          const resto = s.items.map((l) => (l.productoId === producto.id ? { ...l, precioCentavos } : l));
          return {
            items: previa > 0 ? resto.map((l) => (l.loteId === lote.id ? linea : l)) : [...resto, linea],
          };
        });
        return OK;
      },

      establecerCantidad: (loteId, cantidad) => {
        const linea = get().items.find((l) => l.loteId === loteId);
        if (!linea) return fallo('La línea ya no está en el carrito.');
        const validada = validarCantidad(
          cantidad,
          linea.permiteDecimales,
          linea.disponibleMilesimas,
          linea.codigoLote,
        );
        if ('error' in validada) return fallo(validada.error);
        set((s) => ({
          items: s.items.map((l) => (l.loteId === loteId ? { ...l, cantidadMilesimas: validada.milesimas } : l)),
        }));
        return OK;
      },

      quitarLote: (loteId) => set((s) => ({ items: s.items.filter((l) => l.loteId !== loteId) })),

      agregarProducto: (producto) => {
        set((s) => ({ lotesPorProducto: { ...s.lotesPorProducto, [producto.id]: producto.lotes } }));
        const eleccion = elegirLote(producto.lotes, producto.permite_decimales, get().items);
        if (!eleccion) return fallo(`${producto.nombre}: sin existencia disponible.`);
        return get().agregarLote(producto, eleccion.lote, eleccion.cantidad);
      },

      sumarProducto: (productoId) => {
        const s = get();
        const linea = s.items.find((l) => l.productoId === productoId);
        if (!linea) return fallo('El producto ya no está en el carrito.');
        const eleccion = elegirLote(lotesDe(s, productoId), linea.permiteDecimales, s.items);
        if (!eleccion) return fallo(`${linea.nombre}: sin existencia disponible.`);
        return s.agregarLote(productoDeLinea(linea), eleccion.lote, eleccion.cantidad);
      },

      restarProducto: (productoId) => {
        // Las lineas de un producto quedan en orden FEFO: la ultima es el lote mas nuevo
        const lineas = get().items.filter((l) => l.productoId === productoId);
        const total = lineas.reduce((suma, l) => suma + l.cantidadMilesimas, 0);
        if (total <= MILESIMAS) {
          get().quitarProducto(productoId);
          return;
        }
        // Una unidad menos, repartida del lote mas nuevo hacia atras (un lote a granel puede tener menos de 1)
        const nuevas = new Map<number, number>();
        let restante = MILESIMAS;
        for (const l of [...lineas].reverse()) {
          const resta = Math.min(l.cantidadMilesimas, restante);
          nuevas.set(l.loteId, l.cantidadMilesimas - resta);
          restante -= resta;
          if (restante <= 0) break;
        }
        set((s) => ({
          items: s.items
            .map((l) => (nuevas.has(l.loteId) ? { ...l, cantidadMilesimas: nuevas.get(l.loteId) ?? 0 } : l))
            .filter((l) => l.cantidadMilesimas > 0),
        }));
      },

      establecerCantidadProducto: (productoId, cantidad) => {
        const s = get();
        const lineas = s.items.filter((l) => l.productoId === productoId);
        const base = lineas[0];
        if (!base) return fallo('El producto ya no está en el carrito.');
        const total = aEntero(cantidad, MILESIMAS);
        if (total === null || total <= 0) {
          return fallo('La cantidad debe ser mayor a 0 y tener máximo 3 decimales.');
        }
        if (!base.permiteDecimales && total % MILESIMAS !== 0) {
          return fallo('Este producto solo se vende en cantidades enteras.');
        }

        // Reparto canonico por FEFO: llena el lote mas proximo y libera primero el mas nuevo
        const previas = new Map(lineas.map((l) => [l.loteId, l]));
        const hoy = fechaISO();
        const nuevas: LineaCarrito[] = [];
        let restante = total;
        for (const lote of lotesDe(s, productoId)) {
          if (restante <= 0) break;
          if (lote.fecha_caducidad && lote.fecha_caducidad < hoy) continue;
          let disponibleMilesimas = Math.round(Number(lote.cantidad_disponible) * MILESIMAS);
          if (!base.permiteDecimales) disponibleMilesimas -= disponibleMilesimas % MILESIMAS;
          const toma = Math.min(disponibleMilesimas, restante);
          if (toma <= 0) continue;
          nuevas.push({
            ...base,
            loteId: lote.id,
            codigoLote: lote.codigo_lote,
            ...previas.get(lote.id),
            cantidadMilesimas: toma,
            disponibleMilesimas,
          });
          restante -= toma;
        }
        if (restante > 0) {
          return fallo(`Solo hay ${(total - restante) / MILESIMAS} disponibles de ${base.nombre}.`);
        }

        // Las lineas nuevas ocupan el lugar de la primera linea del producto
        let colocadas = false;
        const items: LineaCarrito[] = [];
        for (const l of s.items) {
          if (l.productoId !== productoId) items.push(l);
          else if (!colocadas) {
            items.push(...nuevas);
            colocadas = true;
          }
        }
        set({ items });
        return OK;
      },

      quitarProducto: (productoId) =>
        set((s) => {
          const { [productoId]: _descartado, ...lotesPorProducto } = s.lotesPorProducto;
          return { items: s.items.filter((l) => l.productoId !== productoId), lotesPorProducto };
        }),

      reiniciarVenta: () => set({ clienteId: CLIENTE_PUBLICO_GENERAL_ID, items: [], lotesPorProducto: {} }),
    }),
    {
      name: 'luckypet-pos',
      version: 1,
      // sessionStorage: sobrevive a recargas, no a cerrar la pestana
      storage: createJSONStorage(() => sessionStorage),
      // Sin version nueva: un estado viejo sin lotesPorProducto conserva el {} inicial al fusionarse
      partialize: ({ clienteId, items, lotesPorProducto }) => ({ clienteId, items, lotesPorProducto }),
    },
  ),
);

// ---- Payload para POST de venta (esquema VentaCreate del backend) ----

export interface VentaPayload {
  cliente_id: number;
  items: { producto_id: number; cantidad: string }[];
  pagos: {
    metodo: MetodoPago;
    importe: string;
    pago_con: string | null;
    cambio: string;
    referencia: string | null;
  }[];
}

/**
 * Arma el cuerpo de la venta, o null si el carrito esta vacio o no esta cubierto.
 * El backend asigna los lotes (FEFO/FIFO), por eso se envia la cantidad total por producto.
 */
export function construirVenta(
  { clienteId, items }: Pick<PosState, 'clienteId' | 'items'>,
  pagos: PagoCarrito[],
): VentaPayload | null {
  const resumen = calcularResumen(items, pagos);
  if (!resumen.cubierta) return null;

  const porProducto = new Map<number, number>();
  for (const l of items) {
    porProducto.set(l.productoId, (porProducto.get(l.productoId) ?? 0) + l.cantidadMilesimas);
  }

  return {
    cliente_id: clienteId,
    items: [...porProducto].map(([producto_id, milesimas]) => ({
      producto_id,
      cantidad: escalaATexto(milesimas, 3),
    })),
    // Pagos con importe 0 (sobrantes tras cubrir el total) no son validos para el backend
    pagos: resumen.pagos
      .filter((p) => p.importeCentavos > 0)
      .map((p) => ({
        metodo: p.metodo,
        importe: escalaATexto(p.importeCentavos, 2),
        pago_con: p.pagoConCentavos === null ? null : escalaATexto(p.pagoConCentavos, 2),
        cambio: escalaATexto(p.cambioCentavos, 2),
        referencia: p.referencia,
      })),
  };
}
