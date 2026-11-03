import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import client, { mensajeDeError } from '../api/client';
import { useAtajo } from '../hooks/useAtajo';
import { aEscala, pesos } from '../lib/numeros';
import { calcularResumen, construirVenta, usePosStore } from '../store/posStore';
import type { PagoCarrito } from '../store/posStore';
import type { MetodoPago, VentaResponse } from '../types';
import { METODOS } from './Ticket';
import type { MetodoRapido } from './Ticket';
import Banner from './Banner';
import Dialogo from './Dialogo';

const ETIQUETA: Record<MetodoPago, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transferencia',
};
// En Mixto el efectivo va al final por convencion; con suma exacta el orden no cambia importes
const ORDEN_MIXTO: MetodoPago[] = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'];

type Montos = Record<MetodoPago, string>;
type MetodoConReferencia = Exclude<MetodoPago, 'EFECTIVO'>;
type Referencias = Record<MetodoConReferencia, string>;

const REFERENCIA: Record<MetodoConReferencia, { etiqueta: string; placeholder: string }> = {
  TARJETA: { etiqueta: 'Número de autorización / Voucher', placeholder: 'Opcional' },
  TRANSFERENCIA: { etiqueta: 'Clave de rastreo / Referencia', placeholder: 'Opcional' },
};

interface Props {
  /** Metodo elegido en el ticket; el modal abre con esa pestana activa */
  metodoInicial: MetodoRapido;
  /** Avisa al ticket cuando se cambia de pestana, para que ambos queden sincronizados */
  alCambiarMetodo?: (metodo: MetodoRapido) => void;
  alCerrar: () => void;
  alCobrar: (venta: VentaResponse) => void;
}

export default function CobroModal({ metodoInicial, alCambiarMetodo, alCerrar, alCobrar }: Props) {
  const items = usePosStore((s) => s.items);
  const clienteId = usePosStore((s) => s.clienteId);
  const totalCentavos = useMemo(() => calcularResumen(items, []).totalCentavos, [items]);
  const totalTexto = (totalCentavos / 100).toFixed(2);

  const [metodo, setMetodo] = useState<MetodoRapido>(metodoInicial);
  // Efectivo simple: lo que entrega el cliente; arranca exacto para cobrar de un Enter
  const [recibido, setRecibido] = useState(totalTexto);
  // Mixto: un importe por metodo, a repartir a mano
  const [mixto, setMixto] = useState<Montos>({ EFECTIVO: '', TARJETA: '', TRANSFERENCIA: '' });
  const [referencias, setReferencias] = useState<Referencias>({ TARJETA: '', TRANSFERENCIA: '' });
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const cuerpo = useRef<HTMLDivElement>(null);

  // El <dialog> solo enfoca al abrir: al cambiar de pestana el foco pasa al primer campo de la nueva
  useEffect(() => {
    cuerpo.current?.querySelector<HTMLElement>('[data-autofoco]')?.focus();
  }, [metodo]);

  function elegirMetodo(nuevo: MetodoRapido) {
    setMetodo(nuevo);
    setError(null);
    alCambiarMetodo?.(nuevo);
  }

  const centavos = (texto: string) => (texto.trim() ? aEscala(texto, 2) : 0);
  const referenciaDe = (m: MetodoConReferencia) => referencias[m];

  // Campos de importe que el cajero escribe en la pestana activa
  const textosEditables: string[] =
    metodo === 'EFECTIVO' ? [recibido] : metodo === 'MIXTO' ? ORDEN_MIXTO.map((m) => mixto[m]) : [];
  const hayInvalidos = textosEditables.some((t) => centavos(t) === null);

  const pagos: PagoCarrito[] = (() => {
    if (metodo === 'EFECTIVO') {
      const monto = centavos(recibido) ?? 0;
      return monto > 0 ? [{ id: 'EFECTIVO', metodo: 'EFECTIVO', montoCentavos: monto }] : [];
    }
    if (metodo === 'TARJETA' || metodo === 'TRANSFERENCIA') {
      // Cobro por el total exacto: la terminal fisica o el banco lo procesan fuera del sistema
      return [{ id: metodo, metodo, montoCentavos: totalCentavos, referencia: referenciaDe(metodo) }];
    }
    return ORDEN_MIXTO.flatMap<PagoCarrito>((m) => {
      const monto = centavos(mixto[m]) ?? 0;
      if (monto <= 0) return [];
      return [{ id: m, metodo: m, montoCentavos: monto, referencia: m === 'EFECTIVO' ? undefined : referenciaDe(m) }];
    });
  })();

  const resumen = calcularResumen(items, pagos);
  const sumaMixto = ORDEN_MIXTO.reduce((suma, m) => suma + (centavos(mixto[m]) ?? 0), 0);
  const mixtoExacto = metodo !== 'MIXTO' || sumaMixto === totalCentavos;
  const listo = resumen.cubierta && !hayInvalidos && mixtoExacto && !enviando;

  /** Mixto: llena el metodo con lo que falta, sin contar lo que ya tenia escrito */
  function exactoMixto(m: MetodoPago) {
    const otros = ORDEN_MIXTO.filter((o) => o !== m).reduce((s, o) => s + (centavos(mixto[o]) ?? 0), 0);
    setMixto((v) => ({ ...v, [m]: (Math.max(0, totalCentavos - otros) / 100).toFixed(2) }));
  }

  async function cobrar() {
    if (!listo || enviandoRef.current) return;
    const venta = construirVenta({ clienteId, items }, pagos);
    if (!venta) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    try {
      const { data } = await client.post<VentaResponse>('/ventas', venta);
      alCobrar(data);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo registrar la venta. Intenta de nuevo.'));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  useAtajo('F2', () => void cobrar(), true);

  function alEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void cobrar();
  }

  const campoReferencia = (m: MetodoConReferencia, autofoco: boolean) => (
    <div className="grid gap-1">
      <label htmlFor={`ref-${m}`} className="text-sm font-bold text-tinta">
        {REFERENCIA[m].etiqueta}
      </label>
      <input
        id={`ref-${m}`}
        autoComplete="off"
        maxLength={80}
        data-autofoco={autofoco ? '' : undefined}
        value={referencias[m]}
        onChange={(e) => setReferencias((r) => ({ ...r, [m]: e.target.value }))}
        placeholder={REFERENCIA[m].placeholder}
        className="campo w-full font-mono"
      />
    </div>
  );

  return (
    <Dialogo titulo="Cobrar venta" ancho="max-w-md" alCerrar={alCerrar}>
      {error && <Banner tipo="error">{error}</Banner>}
      <form onSubmit={alEnviar} noValidate>
        <div className="flex items-baseline justify-between border-b border-borde px-6 py-4">
          <span className="text-lg font-extrabold text-tinta">Total</span>
          <span className="font-mono text-4xl font-bold tabular-nums text-tinta">{pesos(totalCentavos)}</span>
        </div>

        <div role="group" aria-label="Método de pago" className="grid grid-cols-4 gap-2 border-b border-borde px-6 py-3">
          {METODOS.map(({ valor, etiqueta, icono: Icono }) => {
            const activo = metodo === valor;
            return (
              <button
                key={valor}
                type="button"
                aria-pressed={activo}
                onClick={() => elegirMetodo(valor)}
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

        <div ref={cuerpo} className="px-6 py-4">
          {metodo === 'EFECTIVO' && (
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <div className="grid gap-1">
                <label htmlFor="pago-EFECTIVO" className="text-sm font-bold text-tinta">
                  Paga con / Recibido
                </label>
                <input
                  id="pago-EFECTIVO"
                  inputMode="decimal"
                  autoComplete="off"
                  data-autofoco=""
                  value={recibido}
                  aria-invalid={hayInvalidos}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setRecibido(e.target.value)}
                  placeholder="0.00"
                  className="campo w-full text-right font-mono text-xl tabular-nums"
                />
              </div>
              <button type="button" onClick={() => setRecibido(totalTexto)} className="boton">
                Monto exacto
              </button>
            </div>
          )}

          {(metodo === 'TARJETA' || metodo === 'TRANSFERENCIA') && (
            <div className="grid gap-4">
              <div className="flex items-baseline justify-between rounded-2xl bg-crema px-4 py-3">
                <span className="text-sm font-bold text-tinta">
                  {metodo === 'TARJETA' ? 'Monto a cobrar' : 'Total a transferir'}
                </span>
                <output className="font-mono text-2xl font-bold tabular-nums text-tinta">{pesos(totalCentavos)}</output>
              </div>
              {metodo === 'TARJETA' && (
                <p className="text-sm text-tinta-suave">
                  Procesa el cobro en la terminal física por el total indicado.
                </p>
              )}
              {campoReferencia(metodo, true)}
            </div>
          )}

          {metodo === 'MIXTO' && (
            <div className="divide-y divide-borde">
              {ORDEN_MIXTO.map((m) => {
                const invalido = centavos(mixto[m]) === null;
                return (
                  <div key={m} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                    <div className="grid grid-cols-[7rem_1fr_auto] items-center gap-3">
                      <label htmlFor={`pago-${m}`} className="text-sm font-bold text-tinta">
                        {ETIQUETA[m]}
                      </label>
                      <input
                        id={`pago-${m}`}
                        inputMode="decimal"
                        autoComplete="off"
                        data-autofoco={m === 'EFECTIVO' ? '' : undefined}
                        value={mixto[m]}
                        aria-invalid={invalido}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setMixto((v) => ({ ...v, [m]: e.target.value }))}
                        placeholder="0.00"
                        className="campo w-full text-right font-mono tabular-nums"
                      />
                      <button type="button" onClick={() => exactoMixto(m)} className="boton">
                        Exacto
                      </button>
                    </div>
                    {m !== 'EFECTIVO' && centavos(mixto[m]) !== 0 && campoReferencia(m, false)}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <dl className="grid grid-cols-[1fr_auto] gap-x-2 border-t border-borde bg-crema px-6 py-3 text-sm">
          {metodo === 'MIXTO' && (
            <>
              <dt className="font-semibold text-tinta-suave">Suma de los tres</dt>
              <dd className="text-right font-mono tabular-nums">{pesos(sumaMixto)}</dd>
            </>
          )}
          {metodo !== 'TARJETA' && metodo !== 'TRANSFERENCIA' && (
            <>
              <dt className="font-semibold text-tinta-suave">Falta por pagar</dt>
              <dd
                className={`text-right font-mono tabular-nums ${
                  resumen.pendienteCentavos > 0 ? 'font-semibold text-amber-600' : 'text-tinta'
                }`}
              >
                {pesos(resumen.pendienteCentavos)}
              </dd>
            </>
          )}
          {metodo !== 'MIXTO' && metodo !== 'TRANSFERENCIA' && (
            <>
              <dt className="font-extrabold text-tinta">Cambio</dt>
              <dd aria-live="polite" className="text-right font-mono text-2xl font-bold tabular-nums text-emerald-600">
                {pesos(resumen.cambioCentavos)}
              </dd>
            </>
          )}
        </dl>

        {(hayInvalidos || (metodo === 'MIXTO' && sumaMixto > totalCentavos)) && (
          <p role="alert" className="px-6 pt-3 text-sm font-semibold text-rose-700">
            {hayInvalidos
              ? 'Escribe los importes con máximo 2 decimales y sin signo.'
              : 'La suma de efectivo, tarjeta y transferencia excede el total; debe ser exactamente el total.'}
          </p>
        )}
        {metodo === 'MIXTO' && sumaMixto < totalCentavos && !hayInvalidos && sumaMixto > 0 && (
          <p className="px-6 pt-3 text-sm text-tinta-suave">
            La suma de los tres debe ser exactamente el total de la venta.
          </p>
        )}

        <div className="p-6">
          <button
            type="submit"
            disabled={!listo}
            aria-keyshortcuts="F2"
            className="boton-primario h-14 w-full rounded-2xl text-lg"
          >
            {enviando ? 'Registrando…' : 'Registrar venta'}
            <kbd className="tecla">F2</kbd>
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
