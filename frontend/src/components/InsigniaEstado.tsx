import { CircleCheck, TriangleAlert } from 'lucide-react';
import type { ProductoCatalogo } from '../types';

/** Estado de existencias; "inactivo" manda sobre las demas */
export default function InsigniaEstado({ producto: p }: { producto: ProductoCatalogo }) {
  const total = Number(p.stock_total);
  const base = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap';
  if (!p.activo) return <span className={`${base} bg-stone-100 text-stone-600`}>Inactivo</span>;
  if (total <= 0) {
    return (
      <span className={`${base} bg-rose-100 text-rose-700`}>
        <TriangleAlert size={13} aria-hidden="true" />
        Agotado
      </span>
    );
  }
  if (total < Number(p.stock_minimo)) {
    return (
      <span className={`${base} bg-orange-100 text-orange-700`}>
        <TriangleAlert size={13} aria-hidden="true" />
        Stock bajo
      </span>
    );
  }
  return (
    <span className={`${base} bg-emerald-100 text-emerald-700`}>
      <CircleCheck size={13} aria-hidden="true" />
      En stock
    </span>
  );
}
