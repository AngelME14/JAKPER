import { PawPrint } from 'lucide-react';
import { fechaISO, formatoCantidad } from '../lib/numeros';
import type { MovimientoKardex, TipoMovimiento } from '../types';
import { ESTILO_MOVIMIENTO } from './InsigniaMovimiento';

/** Mismos tipos que suman existencia que en la tabla del Kardex */
const SUMAN = new Set<TipoMovimiento>(['ENTRADA_COMPRA', 'CANCELACION_VENTA', 'DEVOLUCION_STOCK', 'AJUSTE_ENTRADA']);

export interface FiltrosReporte {
  desde: string;
  hasta: string;
  tipo: string;
  producto: string;
}

export interface ResumenReporte {
  entradas: number;
  salidas: number;
  mermas: number;
}

export function resumir(movimientos: MovimientoKardex[]): ResumenReporte {
  const resumen: ResumenReporte = { entradas: 0, salidas: 0, mermas: 0 };
  for (const m of movimientos) {
    const tipo = m.tipo_movimiento ?? m.tipo;
    const cantidad = Number(m.cantidad);
    if (SUMAN.has(tipo)) resumen.entradas += cantidad;
    else resumen.salidas += cantidad;
    if (tipo === 'MERMA') resumen.mermas += cantidad;
  }
  return resumen;
}

function fechaHora(iso: string): string {
  const d = new Date(iso);
  return `${fechaISO(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const num = (valor: number | string) => formatoCantidad.format(Number(valor));

/** Reporte de Kardex en blanco y negro, pensado para el dialogo de impresion del navegador */
export default function ReporteKardex({
  movimientos,
  filtros,
  generado,
  truncado,
}: {
  movimientos: MovimientoKardex[];
  filtros: FiltrosReporte;
  generado: Date;
  /** Hay mas movimientos de los que se descargaron para este reporte */
  truncado: boolean;
}) {
  const resumen = resumir(movimientos);
  const periodo = filtros.desde === filtros.hasta ? filtros.desde : `${filtros.desde || '—'} al ${filtros.hasta || '—'}`;

  return (
    <article aria-label="Reporte de Kardex" className="reporte-kardex bg-white p-[10mm] text-[10px] leading-snug text-zinc-900">
      <header className="flex items-start justify-between gap-4 border-b border-dashed border-zinc-300 pb-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <PawPrint size={20} strokeWidth={1.8} aria-hidden="true" />
            Lucky Pet MTY
          </h1>
          <p className="text-sm font-bold">Reporte de Kardex de Inventario</p>
        </div>
        <dl className="text-right font-mono">
          <div>
            <dt className="inline">Periodo: </dt>
            <dd className="inline font-bold">{periodo}</dd>
          </div>
          <div>
            <dt className="inline">Tipo: </dt>
            <dd className="inline font-bold">{filtros.tipo}</dd>
          </div>
          <div>
            <dt className="inline">Producto: </dt>
            <dd className="inline font-bold">{filtros.producto}</dd>
          </div>
          <div>
            <dt className="inline">Generado: </dt>
            <dd className="inline">{fechaHora(generado.toISOString())}</dd>
          </div>
        </dl>
      </header>

      <dl className="my-3 grid grid-cols-4 gap-3 font-mono">
        <Cifra etiqueta="Movimientos" valor={num(movimientos.length)} />
        <Cifra etiqueta="Unidades que entraron" valor={`+${num(resumen.entradas)}`} />
        <Cifra etiqueta="Unidades que salieron" valor={`-${num(resumen.salidas)}`} />
        <Cifra etiqueta="Total en mermas" valor={num(resumen.mermas)} />
      </dl>

      {truncado && (
        <p className="mb-2 font-bold">
          Se muestran los primeros {num(movimientos.length)} movimientos; acota el rango de fechas para ver el resto.
        </p>
      )}

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-y border-zinc-900 font-bold uppercase">
            <th className="px-1 py-1">Fecha</th>
            <th className="px-1 py-1">Movimiento</th>
            <th className="px-1 py-1">Folio</th>
            <th className="px-1 py-1">Producto</th>
            <th className="px-1 py-1">Lote</th>
            <th className="px-1 py-1 text-right">Cantidad</th>
            <th className="px-1 py-1 text-right">Saldo</th>
            <th className="px-1 py-1">Usuario</th>
            <th className="px-1 py-1">Motivo</th>
          </tr>
        </thead>
        <tbody>
          {movimientos.map((m) => {
            const tipo = m.tipo_movimiento ?? m.tipo;
            const suma = SUMAN.has(tipo);
            return (
              <tr key={m.id} className="break-inside-avoid border-b border-dashed border-zinc-300 align-top">
                <td className="whitespace-nowrap px-1 py-1 font-mono">{fechaHora(m.fecha)}</td>
                <td className="px-1 py-1">{ESTILO_MOVIMIENTO[tipo].etiqueta}</td>
                <td className="px-1 py-1 font-mono">{m.folio_documento}</td>
                <td className="px-1 py-1 font-bold">{m.nombre_producto}</td>
                <td className="px-1 py-1 font-mono">{m.codigo_lote}</td>
                <td className="whitespace-nowrap px-1 py-1 text-right font-mono tabular-nums">
                  {suma ? '+' : '-'}
                  {num(m.cantidad)}
                </td>
                <td className="whitespace-nowrap px-1 py-1 text-right font-mono tabular-nums">{num(m.saldo_resultante)}</td>
                <td className="px-1 py-1">{m.usuario_nombre}</td>
                <td className="px-1 py-1">{m.motivo_legible}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {movimientos.length === 0 && <p className="py-6 text-center font-bold">Sin movimientos con estos filtros.</p>}
    </article>
  );
}

function Cifra({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded border border-dashed border-zinc-300 px-2 py-1.5">
      <dt className="text-[9px] font-bold uppercase">{etiqueta}</dt>
      <dd className="text-base font-bold tabular-nums">{valor}</dd>
    </div>
  );
}
