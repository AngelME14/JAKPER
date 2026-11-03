import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { isAxiosError } from 'axios';
import { Loader2, Search } from 'lucide-react';
import client from '../api/client';
import { MIN_CARACTERES, useBusquedaProductos } from '../hooks/useBusquedaProductos';
import { aEscala, escalaATexto, fechaISO, formatoCantidad, formatoDinero } from '../lib/numeros';
import type { LoteMermable, MermaResponse, MotivoMerma, ProductoBusqueda } from '../types';

export const MOTIVOS_MERMA: { valor: MotivoMerma; etiqueta: string }[] = [
  { valor: 'CADUCIDAD', etiqueta: 'Caducidad' },
  { valor: 'ROTURA_DAÑO', etiqueta: 'Rotura o daño' },
  { valor: 'CONSUMO_INTERNO_TIENDA', etiqueta: 'Consumo interno de la tienda' },
];

const campo = 'campo w-full';

interface Props {
  abierto: boolean;
  alCerrar: () => void;
  alRegistrar: (merma: MermaResponse, perdidaCentavos: number) => void;
}

/** Dialogo nativo: el navegador atrapa el foco y Esc lo cierra. El formulario se monta al abrir, asi arranca limpio */
export default function MermaModal({ abierto, alCerrar, alRegistrar }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    else if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <dialog
      ref={dialogo}
      onClose={alCerrar}
      aria-labelledby="titulo-merma"
      className="m-auto w-[34rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-3xl border border-borde bg-white p-0 text-tinta shadow-flota backdrop:bg-tinta/45 backdrop:backdrop-blur-[2px]"
    >
      {abierto && <FormularioMerma alCerrar={alCerrar} alRegistrar={alRegistrar} />}
    </dialog>
  );
}

function FormularioMerma({ alCerrar, alRegistrar }: Omit<Props, 'abierto'>) {
  const busqueda = useBusquedaProductos();
  const { resultados, activo, consulta, resuelta, cargando } = busqueda;

  const [producto, setProducto] = useState<ProductoBusqueda | null>(null);
  const [lotes, setLotes] = useState<LoteMermable[]>([]);
  const [cargandoLotes, setCargandoLotes] = useState(false);
  const [errorLotes, setErrorLotes] = useState<string | null>(null);
  const [loteId, setLoteId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState<MotivoMerma | ''>('');
  const [descripcion, setDescripcion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortoLotes = useRef<AbortController | null>(null);

  useEffect(() => () => abortoLotes.current?.abort(), []);

  function elegirProducto(p: ProductoBusqueda) {
    busqueda.limpiar();
    setProducto(p);
    setLoteId('');
    setLotes([]);
    setErrorLotes(null);
    setCargandoLotes(true);
    abortoLotes.current?.abort();
    const controlador = new AbortController();
    abortoLotes.current = controlador;
    client
      .get<LoteMermable[]>(`/productos/${p.id}/lotes`, { signal: controlador.signal })
      .then(({ data }) => {
        setLotes(data);
        if (data.length === 1) setLoteId(String(data[0].id));
      })
      .catch((e: unknown) => {
        if (controlador.signal.aborted) return;
        setErrorLotes(
          isAxiosError(e) && e.response?.status === 403
            ? 'Solo Admin y Encargado pueden registrar mermas.'
            : 'No se pudieron cargar los lotes.',
        );
      })
      .finally(() => {
        if (!controlador.signal.aborted) setCargandoLotes(false);
      });
  }

  function cambiarProducto() {
    abortoLotes.current?.abort();
    setProducto(null);
    setLotes([]);
    setLoteId('');
    setCantidad('');
    setErrorLotes(null);
    setCargandoLotes(false);
  }

  async function alTeclearBusqueda(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (resultados.length === 0) return;
      e.preventDefault();
      const paso = e.key === 'ArrowDown' ? 1 : -1;
      busqueda.setActivo((i) => (i + paso + resultados.length) % resultados.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = consulta.trim();
      if (q.length < MIN_CARACTERES) return;
      const vigente = resuelta === q;
      const datos = vigente ? resultados : await busqueda.buscarAhora(q);
      if (!datos || datos.length === 0) return;
      elegirProducto(datos.find((p) => p.codigo_barras_sku === q) ?? datos[vigente ? activo : 0]);
    }
  }

  // ---- Calculo en vivo ----
  const lote = lotes.find((l) => String(l.id) === loteId) ?? null;
  const milesimas = aEscala(cantidad, 3);
  const disponibleMilesimas = lote ? Math.round(Number(lote.cantidad_disponible) * 1000) : null;

  let errorCantidad: string | null = null;
  if (cantidad.trim() !== '') {
    if (milesimas === null) errorCantidad = 'Máximo 3 decimales.';
    else if (milesimas <= 0) errorCantidad = 'Debe ser mayor a 0.';
    else if (producto && !producto.permite_decimales && milesimas % 1000 !== 0) {
      errorCantidad = 'Este producto solo admite cantidades enteras.';
    } else if (disponibleMilesimas !== null && milesimas > disponibleMilesimas) {
      errorCantidad = `Solo hay ${formatoCantidad.format(disponibleMilesimas / 1000)} en este lote.`;
    }
  }
  const cantidadValida = milesimas !== null && milesimas > 0 && errorCantidad === null;
  const costoCentavos = lote ? Math.round(Number(lote.costo_unitario) * 100) : null;
  // Mismo redondeo half-up del backend
  const perdidaCentavos =
    cantidadValida && costoCentavos !== null ? Math.floor((milesimas * costoCentavos + 500) / 1000) : 0;
  const completo = producto !== null && lote !== null && cantidadValida && motivo !== '';

  async function registrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!producto || !lote || !completo || enviando || milesimas === null) return;
    setEnviando(true);
    setError(null);
    try {
      const { data } = await client.post<MermaResponse>('/mermas', {
        producto_id: producto.id,
        lote_id: lote.id,
        cantidad: escalaATexto(milesimas, 3),
        motivo,
        descripcion: descripcion.trim() || null,
      });
      alRegistrar(data, perdidaCentavos);
    } catch (err) {
      setError(
        isAxiosError<{ detail?: unknown }>(err) && typeof err.response?.data?.detail === 'string'
          ? err.response.data.detail
          : isAxiosError(err) && !err.response
            ? 'Sin conexión con el servidor.'
            : 'No se pudo registrar la merma. Intenta de nuevo.',
      );
      setEnviando(false);
    }
  }

  const hoy = fechaISO();

  return (
    <form onSubmit={(e) => void registrar(e)} noValidate>
      <h2 id="titulo-merma" className="flex h-16 items-center border-b border-borde px-6 text-xl font-extrabold">
        Registrar merma
      </h2>

      <div className="space-y-4 px-6 py-5">
        {/* Producto */}
        <div>
          <label htmlFor="merma-producto" className="etiqueta mb-1.5 block">
            Producto
          </label>
          {producto ? (
            <div className="flex h-10 items-center justify-between gap-2 rounded-xl border border-borde bg-crema px-3 text-sm font-extrabold">
              <span className="truncate">{producto.nombre}</span>
              <button
                type="button"
                onClick={cambiarProducto}
                className="foco shrink-0 rounded-lg px-1 text-xs font-bold text-orange-600 hover:underline"
              >
                Cambiar
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search
                size={16}
                strokeWidth={1.75}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tinta-suave"
              />
              <input
                id="merma-producto"
                type="search"
                role="combobox"
                aria-expanded={resultados.length > 0}
                aria-controls="merma-opciones"
                aria-autocomplete="list"
                aria-activedescendant={resultados[activo] ? `merma-opcion-${resultados[activo].id}` : undefined}
                value={consulta}
                onChange={(e) => busqueda.escribir(e.target.value)}
                onKeyDown={(e) => void alTeclearBusqueda(e)}
                placeholder="Nombre o código de barras"
                autoComplete="off"
                className={`${campo} pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden`}
              />
              {cargando && (
                <Loader2
                  size={16}
                  aria-hidden="true"
                  className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-orange-600 motion-reduce:animate-none"
                />
              )}
            </div>
          )}
          {!producto && (resultados.length > 0 || busqueda.error || (resuelta && !cargando)) && (
            <ul
              id="merma-opciones"
              role="listbox"
              aria-label="Resultados de búsqueda"
              className="mt-1 max-h-40 overflow-auto rounded-2xl border border-borde py-1"
            >
              {busqueda.error && <li className="px-3 py-2 text-sm font-semibold text-rose-700">{busqueda.error}</li>}
              {!busqueda.error && resultados.length === 0 && (
                <li className="px-3 py-2 text-sm text-tinta-suave">Sin resultados para &quot;{resuelta}&quot;.</li>
              )}
              {resultados.map((p, i) => (
                <li
                  key={p.id}
                  id={`merma-opcion-${p.id}`}
                  role="option"
                  aria-selected={i === activo}
                  onClick={() => elegirProducto(p)}
                  onMouseMove={() => i !== activo && busqueda.setActivo(i)}
                  className={`flex cursor-pointer items-baseline gap-2 px-3 py-2 text-sm font-bold ${
                    i === activo ? 'bg-orange-50 text-orange-800' : 'text-tinta'
                  }`}
                >
                  <span className="flex-1">{p.nombre}</span>
                  <span className="font-mono text-xs text-tinta-suave">{p.codigo_barras_sku ?? ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Lote */}
        <div>
          <label htmlFor="merma-lote" className="etiqueta mb-1.5 block">
            Lote
          </label>
          <select
            id="merma-lote"
            value={loteId}
            onChange={(e) => setLoteId(e.target.value)}
            disabled={!producto || cargandoLotes || lotes.length === 0}
            aria-describedby="merma-lote-ayuda"
            className={`${campo} font-mono`}
          >
            <option value="">{cargandoLotes ? 'Cargando lotes…' : 'Selecciona un lote'}</option>
            {lotes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.codigo_lote}
                {'  '}
                {l.fecha_caducidad
                  ? `${l.fecha_caducidad < hoy ? 'vencido' : 'vence'} ${l.fecha_caducidad}`
                  : 'sin caducidad'}
                {'  '}
                {formatoCantidad.format(Number(l.cantidad_disponible))} disp.
                {l.activo ? '' : '  inactivo'}
              </option>
            ))}
          </select>
          <p id="merma-lote-ayuda" className="mt-1 min-h-4 text-xs font-semibold text-tinta-suave">
            {errorLotes ? (
              <span className="text-rose-700">{errorLotes}</span>
            ) : producto && !cargandoLotes && lotes.length === 0 ? (
              'Este producto no tiene lotes con existencia.'
            ) : null}
          </p>
        </div>

        <div className="grid grid-cols-[8rem_1fr] gap-2">
          {/* Cantidad */}
          <div>
            <label htmlFor="merma-cantidad" className="etiqueta mb-1.5 block">
              Cantidad
            </label>
            <input
              id="merma-cantidad"
              inputMode="decimal"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value.replace(/[^\d.,]/g, ''))}
              disabled={!lote}
              aria-invalid={errorCantidad !== null}
              aria-describedby="merma-cantidad-ayuda"
              autoComplete="off"
              className={`${campo} text-right font-mono tabular-nums`}
            />
          </div>
          {/* Motivo */}
          <div>
            <label htmlFor="merma-motivo" className="etiqueta mb-1.5 block">
              Motivo
            </label>
            <select
              id="merma-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value as MotivoMerma | '')}
              className={campo}
            >
              <option value="">Selecciona un motivo</option>
              {MOTIVOS_MERMA.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.etiqueta}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p id="merma-cantidad-ayuda" className="-mt-1 min-h-4 text-xs text-tinta-suave">
          {errorCantidad ? (
            <span className="text-rose-700">{errorCantidad}</span>
          ) : lote ? (
            <>
              Disponible en el lote:{' '}
              <span className="font-mono">{formatoCantidad.format(Number(lote.cantidad_disponible))}</span>
            </>
          ) : null}
        </p>

        <div>
          <label htmlFor="merma-descripcion" className="etiqueta mb-1.5 block">
            Descripción (opcional)
          </label>
          <input
            id="merma-descripcion"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            autoComplete="off"
            className={campo}
          />
        </div>

        {/* Perdida economica en vivo */}
        <div aria-live="polite" className="rounded-2xl border border-rose-100 bg-rose-50/50 px-4 py-3">
          <dl className="grid grid-cols-[1fr_auto] gap-x-2 text-sm font-semibold">
            <dt className="text-tinta-suave">Costo de adquisición del lote</dt>
            <dd className="text-right font-mono tabular-nums">
              {costoCentavos === null ? '-' : `$${formatoDinero.format(costoCentavos / 100)}`}
            </dd>
            <dt className="text-tinta-suave">Cantidad</dt>
            <dd className="text-right font-mono tabular-nums">
              {cantidadValida ? formatoCantidad.format(milesimas / 1000) : '-'}
            </dd>
          </dl>
          <div className="mt-2 flex items-baseline justify-between border-t border-rose-100 pt-2">
            <span className="text-base font-extrabold">Pérdida económica</span>
            <output
              className={`font-mono text-3xl font-bold tabular-nums ${
                perdidaCentavos > 0 ? 'text-rose-600' : 'text-tinta-tenue'
              }`}
            >
              ${formatoDinero.format(perdidaCentavos / 100)}
            </output>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800">
            {error}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-3 border-t border-borde bg-crema px-6 py-4">
        <button
          type="button"
          onClick={alCerrar}
          className="boton h-11 rounded-2xl px-6"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!completo || enviando}
          className="foco presion inline-flex h-11 items-center rounded-2xl bg-rose-600 px-6 text-sm font-bold text-white shadow-[0_6px_16px_-6px_rgba(225,29,72,0.55)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {enviando ? 'Registrando…' : 'Registrar merma'}
        </button>
      </div>
    </form>
  );
}
