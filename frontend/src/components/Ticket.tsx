import { memo, useMemo, useState } from 'react';
import { Banknote, CreditCard, Layers, Minus, Plus, Repeat, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cantidad, pesos } from '../lib/numeros';
import { useCatalogosStore } from '../store/catalogosStore';
import { CLIENTE_PUBLICO_GENERAL_ID, agruparItems, calcularResumen, usePosStore } from '../store/posStore';
import type { GrupoCarrito, Resultado } from '../store/posStore';
import type { MetodoPago } from '../types';
import Banner from './Banner';

/** Atajo de cobro: un metodo unico, o "Mixto" para repartir el total entre varios */
export type MetodoRapido = MetodoPago | 'MIXTO';

export const METODOS: { valor: MetodoRapido; etiqueta: string; icono: LucideIcon }[] = [
  { valor: 'EFECTIVO', etiqueta: 'Efectivo', icono: Banknote },
  { valor: 'TARJETA', etiqueta: 'Tarjeta', icono: CreditCard },
  { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia', icono: Repeat },
  { valor: 'MIXTO', etiqueta: 'Mixto', icono: Layers },
];

interface Props {
  aviso: string | null;
  metodo: MetodoRapido;
  alCambiarMetodo: (metodo: MetodoRapido) => void;
  alAvisar: (texto: string | null) => void;
  alCobrar: () => void;
  alVaciar: () => void;
}

/** Vive aparte del catalogo: agregar un renglon solo repinta el ticket */
export default function Ticket({
  aviso,
  metodo,
  alCambiarMetodo,
  alAvisar,
  alCobrar,
  alVaciar,
}: Props) {
  const items = usePosStore((s) => s.items);
  const clienteId = usePosStore((s) => s.clienteId);
  const setCliente = usePosStore((s) => s.setCliente);
  const clientes = useCatalogosStore((s) => s.clientes);
  const totalCentavos = useMemo(() => calcularResumen(items, []).totalCentavos, [items]);
  const grupos = useMemo(() => agruparItems(items), [items]);
  const hayVenta = items.length > 0;

  return (
    <section aria-label="Venta actual" className="tarjeta flex min-h-[28rem] min-w-0 flex-col overflow-hidden lg:min-h-0">
      <header className="flex items-center justify-between gap-2 px-5 pb-2 pt-5">
        <h2 className="text-xl font-extrabold text-tinta">
          Venta Actual <span className="font-mono text-base text-tinta-suave">({grupos.length})</span>
        </h2>
        {hayVenta && (
          <button
            type="button"
            onClick={alVaciar}
            className="foco presion inline-flex items-center gap-1.5 rounded-xl px-2 py-1 text-sm font-bold text-orange-600 hover:bg-orange-50"
          >
            <Trash2 size={15} aria-hidden="true" />
            Limpiar
          </button>
        )}
      </header>

      <div className="flex items-center gap-2 border-b border-borde px-5 pb-3">
        <label htmlFor="cliente" className="etiqueta">
          Cliente
        </label>
        <select
          id="cliente"
          value={clienteId}
          onChange={(e) => setCliente(Number(e.target.value))}
          className="h-9 min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 text-sm font-semibold text-tinta shadow-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
        >
          {clientes.length === 0 && <option value={CLIENTE_PUBLICO_GENERAL_ID}>Público General</option>}
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>

      <div aria-live="polite">
        {aviso && (
          <Banner tipo="error" alCerrar={() => alAvisar(null)}>
            {aviso}
          </Banner>
        )}
      </div>

      <ul className="min-h-32 flex-1 divide-y divide-borde overflow-auto px-5">
        {!hayVenta && (
          <li className="flex flex-col items-center gap-1 py-10 text-center text-sm font-semibold text-tinta-suave">
            <span aria-hidden="true" className="text-3xl">🐾</span>
            Escanea un código o elige un producto para empezar.
          </li>
        )}
        {grupos.map((grupo) => (
          <Renglon key={grupo.productoId} grupo={grupo} alFallar={alAvisar} />
        ))}
      </ul>

      <div className="shrink-0 border-t border-borde bg-crema p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-extrabold text-tinta">Total:</span>
          <output aria-live="polite" className="font-mono text-4xl font-bold tabular-nums text-tinta">
            {pesos(totalCentavos)}
          </output>
        </div>

        <div role="group" aria-label="Método de pago" className="mt-4 grid grid-cols-4 gap-2">
          {METODOS.map(({ valor, etiqueta, icono: Icono }) => {
            const activo = metodo === valor;
            return (
              <button
                key={valor}
                type="button"
                aria-pressed={activo}
                onClick={() => alCambiarMetodo(valor)}
                className={`foco presion flex flex-col items-center gap-1 rounded-2xl border px-1 py-2 text-[11px] font-bold ${
                  activo
                    ? 'border-orange-500 bg-orange-50 text-orange-700 ring-2 ring-orange-500/20'
                    : 'border-orange-100 bg-white text-tinta-suave hover:bg-orange-50'
                }`}
              >
                <Icono size={18} aria-hidden="true" />
                {etiqueta}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={alCobrar}
          disabled={!hayVenta}
          aria-keyshortcuts="F2"
          className="boton-primario mt-4 h-14 w-full rounded-2xl text-xl"
        >
          <CreditCard size={22} aria-hidden="true" />
          Cobrar
          <kbd className="tecla">F2</kbd>
        </button>
      </div>
    </section>
  );
}

const Renglon = memo(function Renglon({
  grupo,
  alFallar,
}: {
  grupo: GrupoCarrito;
  alFallar: (texto: string | null) => void;
}) {
  const quitarProducto = usePosStore((s) => s.quitarProducto);
  const desglose = grupo.lotes
    .map((l) => `Lote ${l.codigoLote} (${cantidad(l.cantidadMilesimas / 1000)})`)
    .join(' · ');
  return (
    <li className="linea-nueva -mx-2 rounded-xl px-2 py-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[15px] font-extrabold leading-tight text-tinta" title={grupo.nombre}>
          {grupo.nombre}
        </p>
        <span
          key={grupo.cantidadMilesimas}
          className="importe-cambia text-right font-mono text-sm font-semibold tabular-nums text-tinta"
        >
          {pesos(grupo.importeCentavos)}
        </span>
        <button
          type="button"
          onClick={() => quitarProducto(grupo.productoId)}
          aria-label={`Quitar ${grupo.nombre}`}
          title="Quitar"
          className="foco presion -mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-tinta-tenue hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
      <p className="mt-0.5 break-words font-mono text-[11px] leading-snug text-tinta-suave" title={desglose}>
        {desglose}
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <Cantidad key={grupo.cantidadMilesimas} grupo={grupo} alFallar={alFallar} />
        <p className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-tinta-suave">
          × {pesos(grupo.precioCentavos)}
        </p>
      </div>
    </li>
  );
});

const PASO =
  'foco presion inline-flex size-8 shrink-0 items-center justify-center border border-orange-200 bg-white text-orange-700 ' +
  'hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-40';

function Cantidad({ grupo, alFallar }: { grupo: GrupoCarrito; alFallar: (texto: string | null) => void }) {
  const sumarProducto = usePosStore((s) => s.sumarProducto);
  const restarProducto = usePosStore((s) => s.restarProducto);
  const establecerCantidadProducto = usePosStore((s) => s.establecerCantidadProducto);
  const inicial = String(grupo.cantidadMilesimas / 1000);
  const [texto, setTexto] = useState(inicial);

  function avisar(resultado: Resultado) {
    if (resultado.ok) {
      alFallar(null);
    } else {
      alFallar(resultado.error);
      setTexto(inicial);
    }
  }

  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={() => restarProducto(grupo.productoId)}
        disabled={grupo.cantidadMilesimas <= 1000}
        aria-label={`Restar 1 a ${grupo.nombre}`}
        className={`${PASO} rounded-l-xl`}
      >
        <Minus size={14} aria-hidden="true" />
      </button>
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() =>
          texto !== inicial &&
          avisar(establecerCantidadProducto(grupo.productoId, Number(texto.replace(',', '.'))))
        }
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onFocus={(e) => e.currentTarget.select()}
        inputMode={grupo.permiteDecimales ? 'decimal' : 'numeric'}
        aria-label={`Cantidad de ${grupo.nombre}`}
        className="h-8 w-14 border-y border-orange-200 bg-white px-1 text-center font-mono text-sm font-bold tabular-nums text-tinta outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/25"
      />
      <button
        type="button"
        onClick={() => avisar(sumarProducto(grupo.productoId))}
        aria-label={`Sumar 1 a ${grupo.nombre}`}
        className={`${PASO} rounded-r-xl`}
      >
        <Plus size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
