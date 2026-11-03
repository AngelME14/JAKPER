import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { isAxiosError } from 'axios';
import {
  Boxes,
  CalendarClock,
  CircleCheck,
  Info,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import client from '../api/client';
import GraficaVentas from '../components/GraficaVentas';
import mascotas from '../assets/mascotas.webp';
import { cantidad, dinero, formatoDinero } from '../lib/numeros';
import type { AlertasResponse, LotePorCaducarItem, ResumenResponse, StockCriticoItem } from '../types';

const REFRESCO_MS = 2 * 60 * 1000;
const DIAS_URGENTE = 7;

const formatoHora = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' });

function mensajeDeError(error: unknown): string {
  if (isAxiosError(error)) {
    if (!error.response) return 'Sin conexión con el servidor.';
    if (error.response.status === 403) return 'Tu rol no tiene acceso a las alertas de inventario.';
  }
  return 'No se pudieron cargar las alertas. Intenta de nuevo.';
}

function etiquetaDias(dias: number): string {
  if (dias < 0) return `vencido hace ${-dias} d`;
  if (dias === 0) return 'vence hoy';
  return `${dias} d`;
}

export default function Dashboard() {
  const [datos, setDatos] = useState<AlertasResponse | null>(null);
  const [resumen, setResumen] = useState<ResumenResponse | null>(null);
  const [errorResumen, setErrorResumen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [actualizado, setActualizado] = useState<Date | null>(null);
  const aborto = useRef<AbortController | null>(null);

  const cargar = useCallback(async () => {
    aborto.current?.abort();
    const controlador = new AbortController();
    aborto.current = controlador;
    setCargando(true);
    // Cada bloque falla por separado: si el resumen cae, las alertas siguen sirviendo
    const [alertas, ventas] = await Promise.allSettled([
      client.get<AlertasResponse>('/dashboard/alertas', { signal: controlador.signal }),
      client.get<ResumenResponse>('/dashboard/resumen', { signal: controlador.signal }),
    ]);
    if (controlador.signal.aborted) return;
    if (alertas.status === 'fulfilled') {
      setDatos(alertas.value.data);
      setError(null);
      setActualizado(new Date());
    } else {
      setError(mensajeDeError(alertas.reason));
    }
    if (ventas.status === 'fulfilled') {
      setResumen(ventas.value.data);
      setErrorResumen(false);
    } else {
      setErrorResumen(true);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
    const intervalo = window.setInterval(() => void cargar(), REFRESCO_MS);
    return () => {
      window.clearInterval(intervalo);
      aborto.current?.abort();
    };
  }, [cargar]);

  // FEFO: el lote que vence antes sale primero; a igual fecha, el mas antiguo (id menor)
  const lotes = useMemo(
    () =>
      [...(datos?.lotes_por_caducar ?? [])].sort(
        (a, b) => a.dias_restantes - b.dias_restantes || a.lote_id - b.lote_id,
      ),
    [datos],
  );
  const stock = datos?.stock_critico ?? [];
  const vencidos = lotes.filter((l) => l.dias_restantes < 0).length;
  const mermas = Number(datos?.mermas_mes_actual ?? 0);

  const ventasMes = Number(resumen?.ventas_mes ?? 0);
  const ventasPrevias = Number(resumen?.ventas_mes_anterior ?? 0);
  const variacion = ventasPrevias > 0 ? ((ventasMes - ventasPrevias) / ventasPrevias) * 100 : null;

  return (
    <div className="space-y-5 p-4 pb-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-tinta">Dashboard</h1>
          <p className="mt-0.5 text-base text-tinta-suave">Resumen general del sistema</p>
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold text-tinta-suave">
          {actualizado && <span>Actualizado {formatoHora.format(actualizado)}</span>}
          <button
            type="button"
            onClick={() => void cargar()}
            disabled={cargando}
            aria-label="Actualizar dashboard"
            title="Actualizar"
            className="boton size-10 !px-0"
          >
            <RefreshCw
              size={17}
              strokeWidth={2}
              aria-hidden="true"
              className={cargando ? 'animate-spin motion-reduce:animate-none' : ''}
            />
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800">
          {error}
          {datos && ' Se muestran los últimos datos recibidos.'}
        </p>
      )}

      {!datos && !error && <p className="text-sm font-semibold text-tinta-suave">Cargando dashboard…</p>}

      {datos && (
        <>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metrica
              etiqueta="Stock Total"
              valor={resumen ? cantidad(resumen.stock_total) : '—'}
              nota={resumen ? `unidades en ${cantidad(resumen.productos_activos)} productos` : 'sin datos de resumen'}
              icono={Boxes}
              tono="naranja"
            />
            <Metrica
              etiqueta="Productos Críticos"
              valor={String(stock.length)}
              nota="con stock bajo"
              icono={TriangleAlert}
              tono="rojo"
              insignia={stock.length > 0 ? 'Reponer' : undefined}
            />
            <Metrica
              etiqueta="Por Caducar"
              valor={String(lotes.length)}
              nota={
                vencidos > 0
                  ? `lotes en 30 días o menos; ${vencidos} ya vencido${vencidos === 1 ? '' : 's'}`
                  : 'lotes en los próximos 30 días'
              }
              icono={CalendarClock}
              tono="ambar"
              insignia={lotes.length > 0 ? 'Revisar' : undefined}
            />
            <Metrica
              etiqueta="Ventas del Mes"
              valor={resumen ? dinero(ventasMes) : '—'}
              nota={
                variacion === null ? (
                  resumen ? 'sin ventas el mes pasado' : 'sin datos de resumen'
                ) : (
                  <span className={`inline-flex items-center gap-1 font-bold ${variacion >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {variacion >= 0 ? <TrendingUp size={14} aria-hidden="true" /> : <TrendingDown size={14} aria-hidden="true" />}
                    {variacion >= 0 ? '+' : ''}
                    {variacion.toFixed(1)}% vs mes pasado
                  </span>
                )
              }
              icono={TrendingUp}
              tono="verde"
            />
          </dl>

          {errorResumen && (
            <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800">
              No se pudo cargar el resumen de ventas y existencias. Las alertas sí están al día.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section aria-labelledby="titulo-ventas" className="tarjeta p-5">
              <h2 id="titulo-ventas" className="text-lg font-extrabold text-tinta">
                Ventas Últimos 7 Días
              </h2>
              <p className="mb-2 text-sm text-tinta-suave">
                {resumen
                  ? `Total de la semana: ${dinero(resumen.ventas_ultimos_7_dias.reduce((s, d) => s + Number(d.total), 0))}`
                  : 'Ventas completadas por día'}
              </p>
              {resumen ? (
                <GraficaVentas datos={resumen.ventas_ultimos_7_dias} />
              ) : (
                <p className="py-16 text-center text-sm font-semibold text-tinta-suave">Sin datos de ventas por ahora.</p>
              )}
            </section>

            <PanelAlertas stock={stock} lotes={lotes} vencidos={vencidos} mermas={mermas} />
          </div>

          <div id="detalle-alertas" className="grid scroll-mt-4 grid-cols-1 gap-4 xl:grid-cols-[5fr_7fr]">
            <PanelStock items={stock} />
            <PanelCaducidad lotes={lotes} />
          </div>
        </>
      )}
    </div>
  );
}

const TONOS = {
  naranja: { tarjeta: 'bg-orange-50/70', icono: 'bg-orange-100 text-orange-600', insignia: 'bg-orange-100 text-orange-700' },
  rojo: { tarjeta: 'bg-rose-50/60', icono: 'bg-rose-100 text-rose-600', insignia: 'bg-rose-500 text-white' },
  ambar: { tarjeta: 'bg-amber-50/70', icono: 'bg-amber-100 text-amber-600', insignia: 'bg-orange-500 text-white' },
  verde: { tarjeta: 'bg-emerald-50/70', icono: 'bg-emerald-100 text-emerald-600', insignia: 'bg-emerald-500 text-white' },
} as const;

function Metrica({
  etiqueta,
  valor,
  nota,
  icono: Icono,
  tono,
  insignia,
}: {
  etiqueta: string;
  valor: string;
  nota: ReactNode;
  icono: LucideIcon;
  tono: keyof typeof TONOS;
  insignia?: string;
}) {
  const t = TONOS[tono];
  return (
    <div className={`tarjeta flex flex-col p-5 ${t.tarjeta}`}>
      <div className="flex items-start justify-between gap-2">
        <span aria-hidden="true" className={`flex size-11 items-center justify-center rounded-2xl ${t.icono}`}>
          <Icono size={22} strokeWidth={2} />
        </span>
        {insignia && <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${t.insignia}`}>{insignia}</span>}
      </div>
      <dt className="mt-3 text-sm font-bold text-tinta-suave">{etiqueta}</dt>
      <dd className="mt-0.5 font-mono text-3xl font-bold tabular-nums text-tinta xl:text-[1.9rem]">{valor}</dd>
      <p className="mt-1 text-sm text-tinta-suave">{nota}</p>
    </div>
  );
}

function PanelAlertas({
  stock,
  lotes,
  vencidos,
  mermas,
}: {
  stock: StockCriticoItem[];
  lotes: LotePorCaducarItem[];
  vencidos: number;
  mermas: number;
}) {
  const sinAlertas = stock.length === 0 && lotes.length === 0 && mermas === 0;
  return (
    <section aria-labelledby="titulo-alertas" className="tarjeta relative flex min-h-80 flex-col overflow-hidden p-5">
      <header className="flex items-baseline justify-between">
        <h2 id="titulo-alertas" className="text-lg font-extrabold text-tinta">
          Alertas Importantes
        </h2>
        <a href="#detalle-alertas" className="foco rounded-lg text-sm font-bold text-orange-600 hover:underline">
          Ver todas
        </a>
      </header>
      <ul className="mt-3 space-y-4">
        {stock.length > 0 && (
          <Alerta icono={TriangleAlert} tono="bg-rose-100 text-rose-600" titulo={`${stock.length} producto${stock.length === 1 ? '' : 's'} con stock crítico`}>
            Empieza por {stock[0].nombre}
          </Alerta>
        )}
        {lotes.length > 0 && (
          <Alerta icono={CalendarClock} tono="bg-amber-100 text-amber-600" titulo={`${lotes.length} lote${lotes.length === 1 ? '' : 's'} por caducar`}>
            {vencidos > 0 ? `${vencidos} ya vencido${vencidos === 1 ? '' : 's'}` : 'En los próximos 30 días'}
          </Alerta>
        )}
        {mermas > 0 && (
          <Alerta icono={Info} tono="bg-sky-100 text-sky-600" titulo={`Mermas del mes: $${formatoDinero.format(mermas)}`}>
            Cantidad perdida × costo de adquisición
          </Alerta>
        )}
        {sinAlertas && (
          <Alerta icono={CircleCheck} tono="bg-emerald-100 text-emerald-600" titulo="Todo en orden">
            Sin stock crítico, caducidades ni mermas este mes
          </Alerta>
        )}
      </ul>
      <img
        src={mascotas}
        alt=""
        width={220}
        height={229}
        className="pointer-events-none -mb-5 -mr-3 mt-auto w-40 self-end drop-shadow-[0_12px_14px_rgba(194,65,12,0.2)] sm:w-48"
      />
    </section>
  );
}

function Alerta({
  icono: Icono,
  tono,
  titulo,
  children,
}: {
  icono: LucideIcon;
  tono: string;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden="true" className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${tono}`}>
        <Icono size={18} strokeWidth={2.2} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-extrabold leading-tight text-tinta">{titulo}</p>
        <p className="text-sm text-tinta-suave">{children}</p>
      </div>
    </li>
  );
}

function Panel({
  id,
  titulo,
  detalle,
  children,
}: {
  id: string;
  titulo: string;
  detalle: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="tarjeta min-w-0 overflow-hidden">
      <header className="border-b border-borde px-5 py-4">
        <h2 id={id} className="text-lg font-extrabold text-tinta">
          {titulo}
        </h2>
        <p className="text-sm text-tinta-suave">{detalle}</p>
      </header>
      {children}
    </section>
  );
}

const th = 'celda-titulo px-4';
const celdaNumero = 'px-4 py-2.5 text-right font-mono tabular-nums';

function PanelStock({ items }: { items: StockCriticoItem[] }) {
  return (
    <Panel id="panel-stock" titulo="Stock bajo" detalle="Reponer primero lo más corto frente a su mínimo.">
      {items.length === 0 ? (
        <p className="p-5 text-sm font-semibold text-tinta-suave">Todos los productos están por encima de su mínimo.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-labelledby="panel-stock" className="tabla w-full text-sm">
            <thead className="text-left text-xs font-bold uppercase tracking-wider text-stone-800">
              <tr>
                <th scope="col" className={th}>Producto</th>
                <th scope="col" className={`${th} text-right`}>Actual / mínimo</th>
                <th scope="col" className={`${th} w-24`}><span className="sr-only">Cobertura</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const actual = Number(p.stock_actual);
                const minimo = Number(p.stock_minimo);
                const cobertura = minimo > 0 ? Math.min(100, (actual / minimo) * 100) : 0;
                return (
                  <tr key={p.producto_id} className="border-t border-borde">
                    <td className="px-4 py-2.5 font-bold text-tinta">
                      {p.nombre}
                      {actual === 0 && (
                        <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">Agotado</span>
                      )}
                    </td>
                    <td className={celdaNumero}>
                      <span className="font-bold text-rose-600">{cantidad(actual)}</span>
                      <span className="text-tinta-suave"> / {cantidad(minimo)}</span>
                    </td>
                    <td className="px-4 py-2.5" aria-hidden="true">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-orange-100">
                        <div className="h-full rounded-full bg-orange-500" style={{ width: `${cobertura}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function PanelCaducidad({ lotes }: { lotes: LotePorCaducarItem[] }) {
  return (
    <Panel
      id="panel-caducidad"
      titulo="Caducidad en 30 días o menos"
      detalle="Artículos próximos a vencer ordenados por fecha límite para priorizar su salida."
    >
      {lotes.length === 0 ? (
        <p className="p-5 text-sm font-semibold text-tinta-suave">Ningún lote vence en los próximos 30 días.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-labelledby="panel-caducidad" className="tabla w-full text-sm">
            <thead className="text-left text-xs font-bold uppercase tracking-wider text-stone-800">
              <tr>
                <th scope="col" className={th}>Producto</th>
                <th scope="col" className={th}>Lote</th>
                <th scope="col" className={`${th} text-right`}>Vence</th>
                <th scope="col" className={`${th} text-right`}>Plazo</th>
                <th scope="col" className={`${th} text-right`}>Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {lotes.map((l) => {
                const vencido = l.dias_restantes < 0;
                const urgente = l.dias_restantes <= DIAS_URGENTE;
                return (
                  <tr
                    key={l.lote_id}
                    className={`border-t border-borde ${vencido ? 'bg-rose-50' : urgente ? 'bg-amber-50/70' : ''}`}
                  >
                    <td className="px-4 py-2.5 font-bold text-tinta">{l.nombre_producto}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{l.codigo_lote}</td>
                    <td className={`${celdaNumero} text-xs`}>{l.fecha_caducidad}</td>
                    <td className={`${celdaNumero} ${vencido ? 'font-bold text-rose-700' : urgente ? 'font-bold text-amber-700' : ''}`}>
                      {etiquetaDias(l.dias_restantes)}
                    </td>
                    <td className={celdaNumero}>{cantidad(l.cantidad_disponible)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
