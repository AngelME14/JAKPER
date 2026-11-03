import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  tipo: 'error' | 'exito';
  children: ReactNode;
  alCerrar: () => void;
}

const ESTILOS = {
  error: 'border-rose-300 bg-rose-50 text-rose-900',
  exito: 'border-emerald-300 bg-emerald-50 text-emerald-900',
};

/** Aviso flotante abajo a la derecha: no empuja el contenido y se va solo */
export default function Toast({ tipo, children, alCerrar }: Props) {
  useEffect(() => {
    const t = window.setTimeout(alCerrar, tipo === 'error' ? 8000 : 5000);
    return () => window.clearTimeout(t);
  }, [tipo, children, alCerrar]);

  return (
    <div
      role={tipo === 'error' ? 'alert' : 'status'}
      className={`fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-flota ${ESTILOS[tipo]}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        onClick={alCerrar}
        aria-label="Cerrar aviso"
        className="foco shrink-0 rounded-sm opacity-70 hover:opacity-100"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
