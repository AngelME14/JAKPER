import { useCallback, useEffect, useRef, useState } from 'react';
import { FileDown, Minus, Undo2 } from 'lucide-react';
import client, { mensajeDeError } from '../api/client';
import { Buscador } from '../components/BarraCatalogo';
import ComprobanteModal from '../components/ComprobanteModal';
import type { ComprobanteRef } from '../components/ComprobanteModal';
import ExportarKardexModal from '../components/ExportarKardexModal';
import InsigniaMovimiento,{ ESTILO_MOVIMIENTO } from '../components/InsigniaMovimiento';
import MermaModal from '../components/MermaModal';
import ModalDevolucion from '../components/ModalDevolucion';
import { fechaISO, formatoCantidad, formatoDinero } from '../lib/numeros';
import { useAuthStore } from '../store/authStore';
import type { MermaResponse, MovimientoKardex, TipoMovimiento } from '../types';

const PAGINA = 100;
const RETARDO_BUSQUEDA_MS = 300;

const TIPOS = (Object.keys(ESTILO_MOVIMIENTO) as TipoMovimiento[]).map((valor) => ({
  valor,
  etiqueta: ESTILO_MOVIMIENTO[valor].etiqueta,
}));
const SUMAN = new Set<TipoMovimiento>(['ENTRADA_COMPRA', 'CANCELACION_VENTA', 'DEVOLUCION_STOCK', 'AJUSTE_ENTRADA']);

const boton = 'boton';
const campo = 'campo';
const th = 'celda-titulo';

const sinAccion = () => {};

/** Documento que se puede abrir: ticket (venta, cancelacion, devolucion) o compra */
function comprobanteDe(m: MovimientoKardex): ComprobanteRef | null {
  if (m.documento_id === null) return null;
  const tipo = m.tipo_movimiento ?? m.tipo;
  if (tipo === 'ENTRADA_COMPRA') return { tipo: 'compra', id: m.documento_id, folio: m.folio_documento };
  if (tipo === 'VENTA' || tipo === 'CANCELACION_VENTA' || tipo === 'DEVOLUCION_STOCK') {
    return { tipo: 'venta', id: m.documento_id, folio: m.folio_documento };
  }
  return null;
}

function haceDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return fechaISO(d);
}

/** yyyy-mm-dd hh:mm en hora local */
function formatoFecha(iso: string): string {
  const d = new Date(iso);
  return `${fechaISO(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function Kardex() {
  const rol = useAuthStore((s) => s.rol);
  const puedeMermar = rol === 'Admin' || rol === 'Encargado';

  const [desde, setDesde] = useState(() => haceDias(7));
  const [hasta, setHasta] = useState(() => fechaISO());
  const [tipo, setTipo] = useState<TipoMovimiento | ''>('');
  const [q, setQ] = useState('');
  // Al backend solo llega el texto que lleva 300 ms sin cambiar
  const [consulta, setConsulta] = useState('');
  const [version, setVersion] = useState(0);
  const [comprobante, setComprobante] = useState<ComprobanteRef | null>(null);
  const disparador = useRef<HTMLElement | null>(null);

  const [movimientos, setMovimientos] = useState<MovimientoKardex[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const botonMerma = useRef<HTMLButtonElement>(null);
  const [exportando, setExportando] = useState(false);
  const botonExportar = useRef<HTMLButtonElement>(null);
  // `folio` solo viene cuando se devuelve desde el desglose de un ticket
  const [devolucion, setDevolucion] = useState<{ folio?: string; detalleId?: number } | null>(null);
  const botonDevolucion = useRef<HTMLButtonElement>(null);

  const rangoInvalido = desde !== '' && hasta !== '' && desde > hasta;
  const filtros = useCallback(
    () => ({
      fecha_inicio: desde || undefined,
      fecha_fin: hasta || undefined,
      tipo_movimiento: tipo || undefined,
      q: consulta.trim() || undefined,
    }),
    [desde, hasta, tipo, consulta],
  );

  useEffect(() => {
    if (q === consulta) return;
    const temporizador = window.setTimeout(() => setConsulta(q), RETARDO_BUSQUEDA_MS);
    return () => window.clearTimeout(temporizador);
  }, [q, consulta]);

  function abrirComprobante(c: ComprobanteRef) {
    disparador.current = document.activeElement as HTMLElement | null;
    setComprobante(c);
  }

  function cerrarComprobante() {
    setComprobante(null);
    disparador.current?.focus();
  }

  useEffect(() => {
    if (rangoInvalido) return;
    const controlador = new AbortController();
    setCargando(true);
    setError(null);
    client
      .get<MovimientoKardex[]>('/inventario/kardex', {
        params: { ...filtros(), limite: PAGINA },
        signal: controlador.signal,
      })
      .then(({ data }) => {
        setMovimientos(data);
        setHayMas(data.length === PAGINA);
      })
      .catch((e: unknown) => {
        if (!controlador.signal.aborted) setError(mensajeDeError(e, 'No se pudo cargar el kardex. Intenta de nuevo.'));
      })
      .finally(() => {
        if (!controlador.signal.aborted) setCargando(false);
      });
    return () => controlador.abort();
  }, [filtros, rangoInvalido, version]);

  async function cargarMas() {
    setCargandoMas(true);
    try {
      const { data } = await client.get<MovimientoKardex[]>('/inventario/kardex', {
        params: { ...filtros(), limite: PAGINA, desplazamiento: movimientos.length },
      });
      setMovimientos((previo) => [...previo, ...data]);
      setHayMas(data.length === PAGINA);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo cargar el kardex. Intenta de nuevo.'));
    } finally {
      setCargandoMas(false);
    }
  }

  function usarRango(dias: number) {
    setDesde(haceDias(dias));
    setHasta(fechaISO());
  }

  function alRegistrarMerma(merma: MermaResponse, perdidaCentavos: number) {
    setModalAbierto(false);
    setAviso(`Merma ${merma.id} registrada. Pérdida: $${formatoDinero.format(perdidaCentavos / 100)}.`);
    setVersion((n) => n + 1);
    botonMerma.current?.focus();
  }

  const hoy = fechaISO();

  return (
    <div className="flex min-h-full flex-col gap-4 p-4 pb-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-tinta">Kardex de Inventario</h1>
          <p className="mt-0.5 text-base text-tinta-suave">Cada entrada, venta y baja de tu inventario</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            ref={botonExportar}
            type="button"
            onClick={() => setExportando(true)}
            className="boton-primario h-12 rounded-2xl px-5"
          >
            <FileDown size={16} aria-hidden="true" />
            Exportar Reporte
          </button>
          <button
            ref={botonDevolucion}
            type="button"
            onClick={() => setDevolucion({})}
            className="boton h-12 rounded-2xl px-5"
          >
            <Undo2 size={16} aria-hidden="true" />
            Registrar Devolución
          </button>
          {puedeMermar && (
            <button
              ref={botonMerma}
              type="button"
              onClick={() => {
                setAviso(null);
                setModalAbierto(true);
              }}
              className="foco presion inline-flex h-12 items-center gap-2 rounded-2xl bg-rose-600 px-5 text-sm font-bold text-white shadow-[0_6px_16px_-6px_rgba(225,29,72,0.55)] hover:brightness-110"
            >
              <Minus size={16} strokeWidth={2.6} aria-hidden="true" />
              Registrar merma
            </button>
          )}
        </div>
      </header>

      <div className="tarjeta flex flex-wrap items-end gap-x-4 gap-y-3 p-4">
        <div>
          <label htmlFor="desde" className="etiqueta mb-1.5 block">
            Desde
          </label>
          <input
            id="desde"
            type="date"
            value={desde}
            max={hasta || hoy}
            onChange={(e) => setDesde(e.target.value)}
            className={`${campo} font-mono`}
          />
        </div>
        <div>
          <label htmlFor="hasta" className="etiqueta mb-1.5 block">
            Hasta
          </label>
          <input
            id="hasta"
            type="date"
            value={hasta}
            min={desde}
            max={hoy}
            onChange={(e) => setHasta(e.target.value)}
            className={`${campo} font-mono`}
          />
        </div>
        <div className="flex gap-2" role="group" aria-label="Rangos rápidos">
          <button type="button" onClick={() => usarRango(0)} className={boton}>Hoy</button>
          <button type="button" onClick={() => usarRango(7)} className={boton}>7 días</button>
          <button type="button" onClick={() => usarRango(30)} className={boton}>30 días</button>
        </div>
        <div className="ml-auto">
          <label htmlFor="tipo" className="etiqueta mb-1.5 block">
            Tipo de movimiento
          </label>
          <select
            id="tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoMovimiento | '')}
            className={`${campo} w-56 font-semibold`}
          >
            <option value="">Todos</option>
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div aria-live="polite" className="space-y-2 empty:hidden">
        {rangoInvalido && (
          <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800">
            La fecha inicial no puede ser posterior a la final.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800">
            {error}
          </p>
        )}
        {aviso && (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-900">{aviso}</p>
        )}
      </div>

      <div className="tarjeta min-h-0 overflow-hidden">
        <div className="flex border-b border-borde p-3">
          <Buscador
            valor={q}
            alCambiar={setQ}
            alTeclear={sinAccion}
            cargando={cargando || q !== consulta}
            etiqueta="Filtrar movimientos"
            placeholder="Filtrar por producto, SKU, lote o folio..."
          />
        </div>
        <div className="max-h-[70vh] overflow-auto">
          {movimientos.length > 0 ? (
            <table className="tabla w-full min-w-[64rem] text-sm">
              <thead className="sticky top-0 z-10 bg-white text-left text-xs font-bold uppercase tracking-wider text-stone-800">
                <tr>
                  <th scope="col" className={th}>Fecha</th>
                  <th scope="col" className={th}>Movimiento</th>
                  <th scope="col" className={th}>Producto</th>
                  <th scope="col" className={th}>Lote</th>
                  <th scope="col" className={`${th} text-right`}>Cantidad</th>
                  <th scope="col" className={`${th} text-right`} title="Existencia del lote después del movimiento">
                    Existencia / Saldo
                  </th>
                  <th scope="col" className={th}>Detalle</th>
                  <th scope="col" className={th}>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m) => {
                  const tipoMov = m.tipo_movimiento ?? m.tipo;
                  const suma = SUMAN.has(tipoMov);
                  const unidad = m.permite_decimales ? 'kg' : 'pza';
                  const doc = comprobanteDe(m);
                  const etiquetaDoc = doc ? `${doc.tipo === 'venta' ? 'Ticket' : 'Compra'} #${doc.folio}` : null;
                  // Venta y compra no repiten texto: el folio ya lo dice. Solo se muestra el motivo que escribio una persona.
                  const nota =
                    tipoMov === 'MERMA' || tipoMov === 'AJUSTE_ENTRADA' || tipoMov === 'AJUSTE_SALIDA'
                      ? m.motivo_legible
                      : tipoMov === 'CANCELACION_VENTA' || tipoMov === 'DEVOLUCION_STOCK'
                        ? m.motivo
                        : null;
                  return (
                    <tr key={m.id} className="hover:bg-orange-50/40">
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-tinta-suave">{formatoFecha(m.fecha)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <InsigniaMovimiento tipo={tipoMov} />
                      </td>
                      <td className="px-3 py-2.5 font-extrabold text-tinta">{m.nombre_producto}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">{m.codigo_lote}</td>
                      <td
                        className={`whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold tabular-nums ${
                          suma ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {suma ? '+' : '-'}
                        {formatoCantidad.format(Number(m.cantidad))}{' '}
                        <span className="text-xs font-normal">{unidad}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-tinta">
                        {formatoCantidad.format(Number(m.saldo_resultante))}{' '}
                        <span className="text-xs font-normal text-tinta-suave">{unidad}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        {doc && etiquetaDoc && (puedeMermar || doc.tipo === 'venta') ? (
                          <button
                            type="button"
                            onClick={() => abrirComprobante(doc)}
                            aria-label={`Ver desglose de ${etiquetaDoc}`}
                            className="foco inline-flex whitespace-nowrap rounded-md border border-stone-300 bg-white px-2 py-0.5 font-mono text-xs font-bold text-tinta shadow-sm hover:border-orange-500 hover:bg-orange-50 hover:text-orange-700"
                          >
                            {etiquetaDoc}
                          </button>
                        ) : etiquetaDoc ? (
                          <span className="inline-flex whitespace-nowrap rounded-md border border-stone-200 bg-stone-50 px-2 py-0.5 font-mono text-xs font-bold text-tinta-suave">
                            {etiquetaDoc}
                          </span>
                        ) : tipoMov === 'MERMA' && m.merma_id !== null ? (
                          <span className="inline-flex whitespace-nowrap rounded-md border border-stone-200 bg-stone-50 px-2 py-0.5 font-mono text-xs font-bold text-tinta-suave">
                            Merma #{m.merma_id}
                          </span>
                        ) : null}
                        {nota && <p className="mt-1 max-w-xs text-xs text-tinta-suave">{nota}</p>}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-tinta-suave">{m.usuario_nombre ?? m.nombre_usuario}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            !cargando &&
            !rangoInvalido &&
            !error && (
              <p className="px-5 py-12 text-center text-sm font-semibold text-tinta-suave">
                No hay movimientos en este rango y tipo.
              </p>
            )
          )}
          {cargando && movimientos.length === 0 && (
            <p className="px-5 py-12 text-center text-sm font-semibold text-tinta-suave">Cargando movimientos…</p>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-borde bg-crema px-4 py-3 text-sm font-semibold text-tinta-suave">
          <span>
            <span className="font-mono">{movimientos.length}</span>{' '}
            {movimientos.length === 1 ? 'movimiento' : 'movimientos'}
            {cargando && movimientos.length > 0 && ', actualizando…'}
          </span>
          {hayMas && (
            <button type="button" onClick={() => void cargarMas()} disabled={cargandoMas} className={`${boton} h-9`}>
              {cargandoMas ? 'Cargando…' : `Cargar ${PAGINA} más`}
            </button>
          )}
        </footer>
      </div>

      {comprobante && (
        <ComprobanteModal
          comprobante={comprobante}
          alCerrar={cerrarComprobante}
          alDevolver={
            comprobante.tipo === 'venta'
              ? (detalleId) => {
                  const folio = comprobante.folio;
                  setComprobante(null);
                  setDevolucion({ folio, detalleId });
                }
              : undefined
          }
        />
      )}
      {devolucion && (
        <ModalDevolucion
          folioInicial={devolucion.folio}
          detalleInicialId={devolucion.detalleId}
          alCerrar={() => {
            setDevolucion(null);
            botonDevolucion.current?.focus();
          }}
          alDevolver={() => setVersion((n) => n + 1)}
        />
      )}
      {exportando && (
        <ExportarKardexModal
          desdeInicial={desde}
          hastaInicial={hasta}
          alCerrar={() => {
            setExportando(false);
            botonExportar.current?.focus();
          }}
        />
      )}
      <MermaModal abierto={modalAbierto} alCerrar={() => setModalAbierto(false)} alRegistrar={alRegistrarMerma} />
    </div>
  );
}
