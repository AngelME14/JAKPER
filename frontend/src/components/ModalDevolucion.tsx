import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Loader2, Search, Undo2 } from 'lucide-react';
import client, { mensajeDeError } from '../api/client';
import { aEscala, escalaATexto, formatoCantidad } from '../lib/numeros';
import type { DetalleDevolvible, DevolucionPayload, VentaDevolucion } from '../types';
import Dialogo from './Dialogo';
import Toast from './Toast';

interface Props {
  /** Ticket ya conocido (p. ej. abierto desde el Kardex): se carga al abrir y se salta la busqueda */
  folioInicial?: string;
  /** Renglon que se abre ya con el formulario de devolucion */
  detalleInicialId?: number;
  alCerrar: () => void;
  /** Se llama tras cada devolucion confirmada, para refrescar quien abrio el modal */
  alDevolver: () => void;
}

interface Aviso {
  tipo: 'exito' | 'error';
  texto: string;
}

const cant = (valor: string | number) => formatoCantidad.format(Number(valor));

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ModalDevolucion({ folioInicial, detalleInicialId, alCerrar, alDevolver }: Props) {
  const [folio, setFolio] = useState(folioInicial ?? '');
  const [venta, setVenta] = useState<VentaDevolucion | null>(null);
  const [buscando, setBuscando] = useState(folioInicial !== undefined);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [detalleId, setDetalleId] = useState<number | null>(detalleInicialId ?? null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const cerrarAviso = useCallback(() => setAviso(null), []);

  const cargar = useCallback(async (texto: string): Promise<VentaDevolucion | null> => {
    const limpio = texto.trim();
    if (!limpio) return null;
    setBuscando(true);
    setErrorBusqueda(null);
    try {
      // El folio puede traer '#': va codificado para no romper la ruta
      const { data } = await client.get<VentaDevolucion>(`/ventas/folio/${encodeURIComponent(limpio)}`);
      setVenta(data);
      return data;
    } catch (e) {
      setVenta(null);
      setErrorBusqueda(mensajeDeError(e, 'No se pudo buscar la venta. Intenta de nuevo.'));
      return null;
    } finally {
      setBuscando(false);
    }
  }, []);

  useEffect(() => {
    if (folioInicial) void cargar(folioInicial);
  }, [folioInicial, cargar]);

  async function buscar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (buscando) return;
    setDetalleId(null);
    await cargar(folio);
  }

  function cambiarTicket() {
    setVenta(null);
    setDetalleId(null);
    setErrorBusqueda(null);
    setFolio('');
  }

  async function alConfirmar(detalle: DetalleDevolvible, reingreso: boolean) {
    setDetalleId(null);
    setAviso({
      tipo: 'exito',
      texto: reingreso
        ? `Devolución registrada: ${detalle.nombre_producto} regresó al stock.`
        : `Devolución registrada: ${detalle.nombre_producto} quedó como merma.`,
    });
    // Recalcula lo que aun se puede devolver y refresca el Kardex de fondo
    await cargar(venta?.folio ?? folio);
    alDevolver();
  }

  return (
    <Dialogo titulo="Registrar devolución" ancho="max-w-2xl" alCerrar={alCerrar}>
      <div className="max-h-[75vh] overflow-auto">
        {!venta ? (
          <form onSubmit={(e) => void buscar(e)} className="space-y-3 px-6 py-5" noValidate>
            <div>
              <label htmlFor="dev-folio" className="etiqueta mb-1.5 block">
                Folio del ticket
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search
                    size={16}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tinta-suave"
                  />
                  <input
                    id="dev-folio"
                    data-autofoco
                    value={folio}
                    onChange={(e) => setFolio(e.target.value)}
                    placeholder="Escribe o escanea el folio (ej. V-20261103112011-B34302)"
                    autoComplete="off"
                    disabled={buscando}
                    aria-invalid={errorBusqueda !== null}
                    className="campo w-full pl-9 font-mono"
                  />
                </div>
                <button type="submit" disabled={buscando || !folio.trim()} className="boton-primario h-10">
                  {buscando && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  {buscando ? 'Buscando…' : 'Buscar venta'}
                </button>
              </div>
            </div>
            {errorBusqueda && (
              <p role="alert" className="text-sm font-semibold text-rose-700">
                {errorBusqueda}
              </p>
            )}
            {buscando && folioInicial && (
              <p className="text-sm font-semibold text-tinta-suave">Cargando ticket {folioInicial}…</p>
            )}
          </form>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-borde px-6 py-4">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <div>
                  <dt className="etiqueta">Ticket</dt>
                  <dd className="font-mono font-bold text-tinta">#{venta.folio}</dd>
                </div>
                <div>
                  <dt className="etiqueta">Fecha</dt>
                  <dd className="font-bold text-tinta">{fechaHora(venta.fecha_venta)}</dd>
                </div>
                <div>
                  <dt className="etiqueta">Cliente</dt>
                  <dd className="font-bold text-tinta">{venta.cliente.nombre}</dd>
                </div>
              </dl>
              <button type="button" onClick={cambiarTicket} className="boton h-9">
                Cambiar ticket
              </button>
            </div>

            {venta.estado === 'CANCELADA' && (
              <p role="alert" className="border-b border-rose-200 bg-rose-50 px-6 py-3 text-sm font-semibold text-rose-800">
                Este ticket está cancelado: ya no admite devoluciones.
              </p>
            )}

            <ul className="divide-y divide-borde px-6">
              {venta.items.map((d) => (
                <RenglonDevolucion
                  key={d.id}
                  detalle={d}
                  ventaId={venta.id}
                  bloqueado={venta.estado === 'CANCELADA'}
                  abierto={detalleId === d.id}
                  alAbrir={() => setDetalleId(d.id)}
                  alCancelar={() => setDetalleId(null)}
                  alConfirmar={(reingreso) => void alConfirmar(d, reingreso)}
                  alFallar={(texto) => setAviso({ tipo: 'error', texto })}
                />
              ))}
            </ul>
          </>
        )}
      </div>
      {aviso && (
        <Toast tipo={aviso.tipo} alCerrar={cerrarAviso}>
          {aviso.texto}
        </Toast>
      )}
    </Dialogo>
  );
}

function RenglonDevolucion({
  detalle: d,
  ventaId,
  bloqueado,
  abierto,
  alAbrir,
  alCancelar,
  alConfirmar,
  alFallar,
}: {
  detalle: DetalleDevolvible;
  ventaId: number;
  bloqueado: boolean;
  abierto: boolean;
  alAbrir: () => void;
  alCancelar: () => void;
  alConfirmar: (reingreso: boolean) => void;
  alFallar: (texto: string) => void;
}) {
  const sinDisponible = Number(d.cantidad_disponible) <= 0;

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-tinta">{d.nombre_producto}</p>
          <p className="font-mono text-xs text-tinta-suave">Lote {d.codigo_lote}</p>
        </div>
        <dl className="flex gap-4 text-center font-mono text-sm tabular-nums">
          <div>
            <dt className="etiqueta font-sans">Compró</dt>
            <dd className="font-bold text-tinta">{cant(d.cantidad)}</dd>
          </div>
          <div>
            <dt className="etiqueta font-sans">Devuelto</dt>
            <dd className="font-bold text-tinta">{cant(d.cantidad_devuelta)}</dd>
          </div>
          <div>
            <dt className="etiqueta font-sans">Disponible</dt>
            <dd className={`font-bold ${sinDisponible ? 'text-tinta-tenue' : 'text-emerald-600'}`}>
              {cant(d.cantidad_disponible)}
            </dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={alAbrir}
          disabled={bloqueado || sinDisponible || abierto}
          aria-label={`Devolver ${d.nombre_producto}`}
          className="boton h-9"
        >
          <Undo2 size={15} aria-hidden="true" />
          Devolver
        </button>
      </div>
      {abierto && !bloqueado && !sinDisponible && (
        <FormularioDevolucion
          detalle={d}
          ventaId={ventaId}
          alCancelar={alCancelar}
          alConfirmar={alConfirmar}
          alFallar={alFallar}
        />
      )}
    </li>
  );
}

function FormularioDevolucion({
  detalle: d,
  ventaId,
  alCancelar,
  alConfirmar,
  alFallar,
}: {
  detalle: DetalleDevolvible;
  ventaId: number;
  alCancelar: () => void;
  alConfirmar: (reingreso: boolean) => void;
  alFallar: (texto: string) => void;
}) {
  const [cantidad, setCantidad] = useState('1');
  const [motivo, setMotivo] = useState('');
  const [reingreso, setReingreso] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const campoCantidad = useRef<HTMLInputElement>(null);

  // El formulario se monta al pulsar "Devolver": el foco pasa directo a la cantidad
  useEffect(() => {
    campoCantidad.current?.focus();
    campoCantidad.current?.select();
  }, []);

  const disponibleMilesimas = Math.round(Number(d.cantidad_disponible) * 1000);
  const milesimas = aEscala(cantidad, 3);

  let errorCantidad: string | null = null;
  if (cantidad.trim() !== '') {
    if (milesimas === null) errorCantidad = 'Máximo 3 decimales.';
    else if (milesimas <= 0) errorCantidad = 'Debe ser mayor a 0.';
    else if (!d.permite_decimales && milesimas % 1000 !== 0) errorCantidad = 'Este producto solo admite cantidades enteras.';
    else if (milesimas > disponibleMilesimas) errorCantidad = `Solo se pueden devolver ${cant(d.cantidad_disponible)}.`;
  }
  const valido = milesimas !== null && milesimas > 0 && errorCantidad === null && motivo.trim() !== '';

  async function confirmar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valido || enviando || milesimas === null) return;
    setEnviando(true);
    const cuerpo: DevolucionPayload = {
      detalle_venta_id: d.id,
      cantidad: escalaATexto(milesimas, 3),
      motivo: motivo.trim(),
      reingreso_a_stock: reingreso,
    };
    try {
      await client.post(`/ventas/${ventaId}/devoluciones`, cuerpo);
      alConfirmar(reingreso);
    } catch (err) {
      alFallar(mensajeDeError(err, 'No se pudo registrar la devolución. Intenta de nuevo.'));
      setEnviando(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void confirmar(e)}
      noValidate
      className="mt-3 grid gap-3 rounded-2xl border border-borde bg-crema p-4 sm:grid-cols-[8rem_1fr]"
    >
      <div>
        <label htmlFor={`dev-cant-${d.id}`} className="etiqueta mb-1 block">
          Cantidad
        </label>
        <input
          id={`dev-cant-${d.id}`}
          ref={campoCantidad}
          inputMode={d.permite_decimales ? 'decimal' : 'numeric'}
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          autoComplete="off"
          disabled={enviando}
          aria-invalid={errorCantidad !== null}
          className="campo w-full text-right font-mono tabular-nums"
        />
      </div>
      <div>
        <label htmlFor={`dev-motivo-${d.id}`} className="etiqueta mb-1 block">
          Motivo de la devolución
        </label>
        <input
          id={`dev-motivo-${d.id}`}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ej. Producto en mal estado"
          autoComplete="off"
          maxLength={200}
          disabled={enviando}
          className="campo w-full"
        />
      </div>
      {errorCantidad && (
        <p role="alert" className="text-sm font-semibold text-rose-700 sm:col-span-2">
          {errorCantidad}
        </p>
      )}
      <div className="sm:col-span-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-tinta">
          <input
            type="checkbox"
            checked={reingreso}
            onChange={(e) => setReingreso(e.target.checked)}
            disabled={enviando}
            className="size-4 accent-orange-600"
          />
          ¿Apto para reingresar a stock disponible?
        </label>
        <p className="mt-1 pl-6 text-xs text-tinta-suave">
          {reingreso
            ? 'Las piezas regresan al lote y quedan a la venta.'
            : 'Las piezas no regresan al stock: se registran como merma por devolución defectuosa.'}
        </p>
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button type="button" onClick={alCancelar} disabled={enviando} className="boton h-10">
          Cancelar
        </button>
        <button type="submit" disabled={!valido || enviando} className="boton-primario h-10">
          {enviando && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {enviando ? 'Registrando…' : 'Confirmar Devolución'}
        </button>
      </div>
    </form>
  );
}
