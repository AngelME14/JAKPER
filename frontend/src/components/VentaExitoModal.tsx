import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Printer, ShoppingCart } from 'lucide-react';
import { dinero } from '../lib/numeros';
import type { VentaResponse } from '../types';
import Dialogo from './Dialogo';
import TicketVenta from './TicketVenta';
import type { PapelMm } from './TicketVenta';

const CLAVE_AUTO = 'luckypet-autoimprimir';
const CLAVE_PAPEL = 'luckypet-papel';

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function guardar(clave: string, valor: string) {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // Sin almacenamiento la preferencia solo dura mientras el modal este abierto
  }
}

interface Props {
  venta: VentaResponse;
  /** Limpia la venta y regresa al mostrador (tambien con Esc o la X) */
  alNuevaVenta: () => void;
}

/** Confirmacion de venta registrada: imprime el ticket termico o deja pasar a la siguiente venta */
export default function VentaExitoModal({ venta, alNuevaVenta }: Props) {
  const [auto, setAuto] = useState(() => leer(CLAVE_AUTO) === '1');
  const [papel, setPapel] = useState<PapelMm>(() => (leer(CLAVE_PAPEL) === '58' ? 58 : 80));
  const cambioTotal = venta.pagos.reduce((suma, p) => suma + Number(p.cambio ?? 0), 0);

  function imprimir() {
    window.print();
  }

  // Auto-impresion: solo al abrir; el ticket ya esta en el DOM porque se pinta en este mismo render
  useEffect(() => {
    if (!auto) return;
    const temporizador = window.setTimeout(() => window.print(), 200);
    return () => window.clearTimeout(temporizador);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cambiarAuto(valor: boolean) {
    setAuto(valor);
    guardar(CLAVE_AUTO, valor ? '1' : '0');
  }

  function cambiarPapel(valor: PapelMm) {
    setPapel(valor);
    guardar(CLAVE_PAPEL, String(valor));
  }

  return (
    <>
      <Dialogo titulo="Venta registrada" ancho="max-w-md" alCerrar={alNuevaVenta}>
        <div className="flex items-center gap-3 px-6 py-4">
          <CheckCircle2 size={36} className="shrink-0 text-emerald-600" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <output className="block font-mono text-3xl font-bold tabular-nums text-tinta">{dinero(venta.total)}</output>
            <p className="truncate text-sm font-semibold text-tinta-suave">
              Ticket <span className="font-mono">{venta.folio}</span>
            </p>
          </div>
          {cambioTotal > 0 && (
            <p className="text-right text-sm font-extrabold text-emerald-600">
              Cambio
              <span className="block font-mono text-xl tabular-nums">{dinero(cambioTotal)}</span>
            </p>
          )}
        </div>

        {/* Vista previa: la misma pieza que se imprime, con el papel elegido */}
        <div className="max-h-[42vh] overflow-auto border-y border-borde bg-zinc-100 p-4">
          <div className="mx-auto w-fit border border-zinc-200 bg-white shadow-sm">
            <TicketVenta venta={venta} papel={papel} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-borde bg-crema px-6 py-3 text-sm">
          <label className="flex cursor-pointer items-center gap-2 font-semibold text-tinta-suave">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => cambiarAuto(e.target.checked)}
              className="size-4 accent-orange-600"
            />
            Imprimir al cobrar
          </label>
          <div role="group" aria-label="Ancho del papel" className="flex items-center gap-1">
            {([80, 58] as const).map((mm) => (
              <button
                key={mm}
                type="button"
                aria-pressed={papel === mm}
                onClick={() => cambiarPapel(mm)}
                className={`foco presion rounded-lg border px-2 py-1 font-mono text-xs font-bold ${
                  papel === mm
                    ? 'border-orange-500 bg-orange-50 text-orange-700'
                    : 'border-orange-100 bg-white text-tinta-suave hover:bg-orange-50'
                }`}
              >
                {mm} mm
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 p-6">
          <button type="button" onClick={alNuevaVenta} className="boton h-14 rounded-2xl text-sm">
            <ShoppingCart size={18} aria-hidden="true" />
            Cerrar / Nueva Venta
          </button>
          <button
            type="button"
            data-autofoco
            onClick={imprimir}
            aria-keyshortcuts="Enter"
            className="boton-primario h-14 rounded-2xl text-sm"
          >
            <Printer size={18} aria-hidden="true" />
            Imprimir Ticket
            <kbd className="tecla">Enter</kbd>
          </button>
        </div>
      </Dialogo>

      {/* Fuera del arbol del POS: al imprimir, index.css oculta todo lo demas */}
      {createPortal(
        <div id="ticket-impresion" className="ticket-impresion">
          <TicketVenta venta={venta} papel={papel} />
        </div>,
        document.body,
      )}
    </>
  );
}
