import { useId, useMemo, useState } from 'react';
import { dinero } from '../lib/numeros';
import type { VentaDia } from '../types';

const ANCHO = 640;
const ALTO = 270;
const M = { arriba: 16, derecha: 20, abajo: 34, izquierda: 52 };

const diaCorto = new Intl.DateTimeFormat('es-MX', { weekday: 'short', timeZone: 'UTC' });
const diaLargo = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Fechas yyyy-mm-dd como UTC, para que la zona del navegador no corra el dia */
const aFecha = (iso: string) => new Date(`${iso}T00:00:00Z`);

const capitalizar = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).replace('.', '');

/** Paso "redondo" (1, 2, 2.5, 5 x 10^n) para que el eje no muestre cifras raras */
function pasoBonito(maximo: number, marcas: number): number {
  const crudo = maximo / marcas;
  const potencia = 10 ** Math.floor(Math.log10(crudo));
  const base = crudo / potencia;
  const multiplo = base <= 1 ? 1 : base <= 2 ? 2 : base <= 2.5 ? 2.5 : base <= 5 ? 5 : 10;
  return multiplo * potencia;
}

const etiquetaEje = (v: number) => (v >= 1000 ? `$${v / 1000}k` : `$${v}`);

export default function GraficaVentas({ datos }: { datos: VentaDia[] }) {
  const idDegradado = useId();
  const [activo, setActivo] = useState<number | null>(null);

  const { puntos, marcas, linea, area, tope } = useMemo(() => {
    const maximo = Math.max(0, ...datos.map((d) => Number(d.total)));
    const paso = pasoBonito(maximo > 0 ? maximo : 100, 4);
    const topeEje = Math.max(paso * Math.ceil((maximo > 0 ? maximo : 100) / paso), paso);
    const w = ANCHO - M.izquierda - M.derecha;
    const h = ALTO - M.arriba - M.abajo;
    const pts = datos.map((d, i) => ({
      x: M.izquierda + (datos.length > 1 ? (i / (datos.length - 1)) * w : w / 2),
      y: M.arriba + h - (Number(d.total) / topeEje) * h,
      d,
    }));
    const ticks: number[] = [];
    for (let v = 0; v <= topeEje + 1e-9; v += paso) ticks.push(v);
    const trazo = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const base = M.arriba + h;
    const poligono = pts.length
      ? `${trazo} L${pts[pts.length - 1].x.toFixed(1)} ${base} L${pts[0].x.toFixed(1)} ${base}Z`
      : '';
    return { puntos: pts, marcas: ticks, linea: trazo, area: poligono, tope: topeEje };
  }, [datos]);

  const yDe = (v: number) => M.arriba + (ALTO - M.arriba - M.abajo) * (1 - v / tope);
  const sel = activo === null ? null : puntos[activo];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        role="img"
        aria-label={`Ventas de los últimos ${datos.length} días`}
        className="h-auto w-full"
        onMouseLeave={() => setActivo(null)}
      >
        <defs>
          <linearGradient id={idDegradado} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F97316" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#F97316" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {marcas.map((v) => (
          <g key={v}>
            <line x1={M.izquierda} x2={ANCHO - M.derecha} y1={yDe(v)} y2={yDe(v)} stroke="#F6E4D0" strokeDasharray={v === 0 ? undefined : '3 5'} />
            <text x={M.izquierda - 10} y={yDe(v)} dy="0.32em" textAnchor="end" fontSize="12" fontWeight="600" fill="#A68B78">
              {etiquetaEje(v)}
            </text>
          </g>
        ))}

        {area && <path d={area} fill={`url(#${idDegradado})`} />}
        {linea && (
          <path
            d={linea}
            pathLength={1}
            className="traza"
            fill="none"
            stroke="#EA580C"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {puntos.map((p, i) => (
          <g key={p.d.fecha}>
            <text x={p.x} y={ALTO - 10} textAnchor="middle" fontSize="12" fontWeight={i === activo ? 800 : 600} fill={i === activo ? '#3A1F0F' : '#A68B78'}>
              {capitalizar(diaCorto.format(aFecha(p.d.fecha)))}
            </text>
            <circle cx={p.x} cy={p.y} r={i === activo ? 6 : 3.5} fill="#fff" stroke="#EA580C" strokeWidth="2.5" />
            {/* Franja invisible: ancho de toque comodo para cada dia */}
            <rect
              x={p.x - (ANCHO - M.izquierda - M.derecha) / (datos.length - 1 || 1) / 2}
              y={M.arriba}
              width={(ANCHO - M.izquierda - M.derecha) / (datos.length - 1 || 1)}
              height={ALTO - M.arriba - M.abajo}
              fill="transparent"
              onMouseEnter={() => setActivo(i)}
              onClick={() => setActivo(i)}
            />
          </g>
        ))}

        {sel && (
          <line x1={sel.x} x2={sel.x} y1={M.arriba} y2={ALTO - M.abajo} stroke="#EA580C" strokeOpacity=".35" strokeDasharray="4 4" />
        )}
      </svg>

      {sel && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-2xl bg-tinta px-3 py-2 text-center text-white shadow-flota"
          style={{
            left: `${(sel.x / ANCHO) * 100}%`,
            top: `${(Math.max(sel.y - 12, 44) / ALTO) * 100}%`,
          }}
        >
          <p className="font-mono text-sm font-bold tabular-nums">{dinero(sel.d.total)}</p>
          <p className="text-[11px] font-semibold text-orange-200">{capitalizar(diaLargo.format(aFecha(sel.d.fecha)))}</p>
        </div>
      )}

      <table className="sr-only">
        <caption>Ventas por día</caption>
        <thead>
          <tr>
            <th scope="col">Día</th>
            <th scope="col">Ventas</th>
          </tr>
        </thead>
        <tbody>
          {datos.map((d) => (
            <tr key={d.fecha}>
              <th scope="row">{d.fecha}</th>
              <td>{dinero(d.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
