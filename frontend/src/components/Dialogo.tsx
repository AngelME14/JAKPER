import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  titulo: string;
  ancho?: string;
  alCerrar: () => void;
  children: ReactNode;
}

/** Modal nativo: <dialog> ya resuelve la trampa de foco y Esc */
export default function Dialogo({ titulo, ancho = 'max-w-xl', alCerrar, children }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
    // showModal enfoca el primer control (la X); React no emite el atributo autofocus
    d?.querySelector<HTMLElement>('[data-autofoco]')?.focus();
    return () => d?.close();
  }, []);

  return (
    <dialog
      ref={dialogo}
      aria-label={titulo}
      onCancel={(e) => {
        e.preventDefault();
        alCerrar();
      }}
      className={`w-full ${ancho} overflow-hidden rounded-3xl border border-borde bg-white p-0 text-tinta shadow-flota backdrop:bg-tinta/45 backdrop:backdrop-blur-[2px]`}
    >
      <header className="flex h-16 items-center justify-between border-b border-borde px-6">
        <h2 className="text-xl font-extrabold">{titulo}</h2>
        <button
          type="button"
          onClick={alCerrar}
          aria-label="Cerrar"
          title="Cerrar (Esc)"
          className="foco inline-flex size-9 items-center justify-center rounded-xl text-tinta-suave hover:bg-orange-50 hover:text-orange-700"
        >
          <X size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
