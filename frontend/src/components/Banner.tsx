import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  tipo: 'error' | 'exito';
  children: ReactNode;
  alCerrar?: () => void;
}

const ESTILOS = {
  error: 'border-rose-200 bg-rose-50 text-rose-800',
  exito: 'border-emerald-200 bg-emerald-50 text-emerald-900',
};

/** Aviso redondeado dentro del panel que lo contiene */
export default function Banner({ tipo, children, alCerrar }: Props) {
  return (
    <div
      role={tipo === 'error' ? 'alert' : 'status'}
      className={`mx-3 my-2 flex items-start gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold ${ESTILOS[tipo]}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {alCerrar && (
        <button
          type="button"
          onClick={alCerrar}
          aria-label="Cerrar aviso"
          className="shrink-0 rounded-sm opacity-70 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
