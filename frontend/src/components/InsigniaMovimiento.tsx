import type { TipoMovimiento } from '../types';

interface Estilo {
  etiqueta: string;
  /** Colores semanticos: venta ambar, entrada verde, merma rojo, cancelacion/devolucion azul, ajuste purpura */
  clases: string;
}

export const ESTILO_MOVIMIENTO: Record<TipoMovimiento, Estilo> = {
  VENTA: { etiqueta: 'Venta', clases: 'bg-amber-100 text-amber-800 ring-amber-300' },
  ENTRADA_COMPRA: { etiqueta: 'Entrada por compra', clases: 'bg-emerald-100 text-emerald-800 ring-emerald-300' },
  MERMA: { etiqueta: 'Merma', clases: 'bg-rose-100 text-rose-800 ring-rose-300' },
  CANCELACION_VENTA: { etiqueta: 'Cancelación de venta', clases: 'bg-sky-100 text-sky-800 ring-sky-300' },
  DEVOLUCION_STOCK: { etiqueta: 'Devolución de cliente', clases: 'bg-sky-100 text-sky-800 ring-sky-300' },
  AJUSTE_ENTRADA: { etiqueta: 'Ajuste de entrada', clases: 'bg-purple-100 text-purple-800 ring-purple-300' },
  AJUSTE_SALIDA: { etiqueta: 'Ajuste de salida', clases: 'bg-purple-100 text-purple-800 ring-purple-300' },
};

export default function InsigniaMovimiento({ tipo }: { tipo: TipoMovimiento }) {
  const { etiqueta, clases } = ESTILO_MOVIMIENTO[tipo];
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${clases}`}
    >
      {etiqueta}
    </span>
  );
}
