import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, Printer, Search } from 'lucide-react';
import client, { mensajeDeError } from '../api/client';
import { MIN_CARACTERES, useBusquedaProductos } from '../hooks/useBusquedaProductos';
import { fechaISO } from '../lib/numeros';
import type { MovimientoKardex, ProductoBusqueda, TipoMovimiento } from '../types';
import Dialogo from './Dialogo';
import ReporteKardex from './ReporteKardex';
import type { FiltrosReporte } from './ReporteKardex';
import Toast from './Toast';

const POR_PAGINA = 1000; // tope de /inventario/kardex
const MAX_PAGINAS = 10;

const TIPOS: { valor: TipoMovimiento | ''; etiqueta: string }[] = [
  { valor: '', etiqueta: 'Todos' },
  { valor: 'VENTA', etiqueta: 'Solo Ventas' },
  { valor: 'ENTRADA_COMPRA', etiqueta: 'Solo Compras' },
  { valor: 'MERMA', etiqueta: 'Solo Mermas' },
];

function haceDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return fechaISO(d);
}

function inicioDeMes(): string {
  const d = new Date();
  d.setDate(1);
  return fechaISO(d);
}

interface Aviso {
  tipo: 'exito' | 'error';
  texto: string;
}

interface Props {
  /** Rango con el que abre, el mismo que muestra la tabla del Kardex */
  desdeInicial: string;
  hastaInicial: string;
  alCerrar: () => void;
}

export default function ExportarKardexModal({ desdeInicial, hastaInicial, alCerrar }: Props) {
  const hoy = fechaISO();
  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hastaInicial);
  const [tipo, setTipo] = useState<TipoMovimiento | ''>('');
  const [producto, setProducto] = useState<ProductoBusqueda | null>(null);
  const [accion, setAccion] = useState<'csv' | 'vista' | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [reporte, setReporte] = useState<{
    movimientos: MovimientoKardex[];
    filtros: FiltrosReporte;
    generado: Date;
    truncado: boolean;
  } | null>(null);

  const busqueda = useBusquedaProductos();
  const { resultados, activo, consulta, resuelta, cargando } = busqueda;

  const rangoInvalido = desde !== '' && hasta !== '' && desde > hasta;
  const ocupado = accion !== null;
  const deshabilitado = ocupado || rangoInvalido;

  const rapidos = [
    { etiqueta: 'Hoy', desde: hoy, hasta: hoy },
    { etiqueta: 'Últimos 7 días', desde: haceDias(6), hasta: hoy },
    { etiqueta: 'Mes actual', desde: inicioDeMes(), hasta: hoy },
  ];

  const parametros = () => ({
    fecha_inicio: desde || undefined,
    fecha_fin: hasta || undefined,
    producto_id: producto?.id,
    tipo_movimiento: tipo || undefined,
  });

  async function descargarCsv() {
    if (deshabilitado) return;
    setAccion('csv');
    setAviso(null);
    try {
      const { data } = await client.get<Blob>('/inventario/kardex/export', {
        params: parametros(),
        responseType: 'blob',
      });
      const nombre = `kardex_${hoy}.csv`;
      const url = URL.createObjectURL(data);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombre;
      document.body.append(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(url);
      setAviso({ tipo: 'exito', texto: `Reporte descargado: ${nombre}` });
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensajeDeError(e, 'No se pudo descargar el reporte. Intenta de nuevo.') });
    } finally {
      setAccion(null);
    }
  }

  async function prepararVista() {
    if (deshabilitado) return;
    setAccion('vista');
    setAviso(null);
    try {
      const movimientos: MovimientoKardex[] = [];
      let paginaCompleta = false;
      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const { data } = await client.get<MovimientoKardex[]>('/inventario/kardex', {
          params: { ...parametros(), limite: POR_PAGINA, desplazamiento: movimientos.length },
        });
        movimientos.push(...data);
        paginaCompleta = data.length === POR_PAGINA;
        if (!paginaCompleta) break;
      }
      setReporte({
        movimientos,
        filtros: {
          desde,
          hasta,
          tipo: TIPOS.find((t) => t.valor === tipo)?.etiqueta ?? 'Todos',
          producto: producto?.nombre ?? 'Todos',
        },
        generado: new Date(),
        truncado: paginaCompleta,
      });
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensajeDeError(e, 'No se pudo preparar la vista. Intenta de nuevo.') });
    } finally {
      setAccion(null);
    }
  }

  function elegirProducto(p: ProductoBusqueda) {
    busqueda.limpiar();
    setProducto(p);
  }

  async function alTeclearBusqueda(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (resultados.length === 0) return;
      e.preventDefault();
      const paso = e.key === 'ArrowDown' ? 1 : -1;
      busqueda.setActivo((i) => (i + paso + resultados.length) % resultados.length);
    } else if (e.key === 'Enter') {
      // Enter elige el producto; no debe disparar ninguna exportacion
      e.preventDefault();
      const q = consulta.trim();
      if (q.length < MIN_CARACTERES) return;
      const vigente = resuelta === q;
      const datos = vigente ? resultados : await busqueda.buscarAhora(q);
      if (!datos || datos.length === 0) return;
      elegirProducto(datos.find((p) => p.codigo_barras_sku === q) ?? datos[vigente ? activo : 0]);
    }
  }

  const cerrarAviso = () => setAviso(null);
  const toast = aviso && (
    <Toast tipo={aviso.tipo} alCerrar={cerrarAviso}>
      {aviso.texto}
    </Toast>
  );

  if (reporte) {
    return (
      <>
        <Dialogo titulo="Vista para imprimir" ancho="max-w-5xl" alCerrar={alCerrar}>
          <div className="max-h-[68vh] overflow-auto bg-zinc-100 p-4">
            <div className="mx-auto min-w-[44rem] max-w-[297mm] border border-zinc-200 shadow-sm">
              <ReporteKardex {...reporte} />
            </div>
          </div>
          <footer className="flex items-center justify-between gap-3 border-t border-borde bg-crema px-6 py-3">
            <button type="button" onClick={() => setReporte(null)} className="boton">
              Volver
            </button>
            <button type="button" data-autofoco onClick={() => window.print()} className="boton-primario">
              <Printer size={16} aria-hidden="true" />
              Imprimir / Guardar PDF
            </button>
          </footer>
          {toast}
        </Dialogo>
        {/* Fuera del arbol de la pagina: al imprimir, index.css oculta todo lo demas */}
        {createPortal(
          <div className="reporte-impresion">
            <ReporteKardex {...reporte} />
          </div>,
          document.body,
        )}
      </>
    );
  }

  return (
    <Dialogo titulo="Exportar reporte de Kardex" ancho="max-w-xl" alCerrar={alCerrar}>
      <div className="space-y-5 px-6 py-5">
        <fieldset>
          <legend className="etiqueta mb-1.5">Rango de fechas</legend>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Rangos rápidos">
            {rapidos.map((r) => {
              const activoRapido = desde === r.desde && hasta === r.hasta;
              return (
                <button
                  key={r.etiqueta}
                  type="button"
                  aria-pressed={activoRapido}
                  onClick={() => {
                    setDesde(r.desde);
                    setHasta(r.hasta);
                  }}
                  className={`foco presion h-9 rounded-xl border px-3 text-sm font-bold ${
                    activoRapido
                      ? 'border-orange-500 bg-orange-50 text-orange-700 ring-2 ring-orange-500/20'
                      : 'border-orange-100 bg-white text-tinta-suave hover:bg-orange-50'
                  }`}
                >
                  {r.etiqueta}
                </button>
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="exp-desde" className="etiqueta mb-1 block">
                Desde
              </label>
              <input
                id="exp-desde"
                type="date"
                value={desde}
                max={hasta || hoy}
                onChange={(e) => setDesde(e.target.value)}
                className="campo w-full font-mono"
              />
            </div>
            <div>
              <label htmlFor="exp-hasta" className="etiqueta mb-1 block">
                Hasta
              </label>
              <input
                id="exp-hasta"
                type="date"
                value={hasta}
                min={desde}
                max={hoy}
                onChange={(e) => setHasta(e.target.value)}
                className="campo w-full font-mono"
              />
            </div>
          </div>
          {rangoInvalido && (
            <p role="alert" className="mt-2 text-sm font-semibold text-rose-700">
              La fecha inicial no puede ser posterior a la final.
            </p>
          )}
        </fieldset>

        <div>
          <label htmlFor="exp-tipo" className="etiqueta mb-1.5 block">
            Tipo de movimiento
          </label>
          <select
            id="exp-tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoMovimiento | '')}
            className="campo w-full font-semibold"
          >
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="exp-producto" className="etiqueta mb-1.5 block">
            Producto <span className="font-normal">(opcional)</span>
          </label>
          {producto ? (
            <div className="flex h-10 items-center justify-between gap-2 rounded-xl border border-borde bg-crema px-3 text-sm font-extrabold">
              <span className="truncate">{producto.nombre}</span>
              <button
                type="button"
                onClick={() => setProducto(null)}
                className="foco shrink-0 rounded-lg px-1 text-xs font-bold text-orange-600 hover:underline"
              >
                Quitar
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
                id="exp-producto"
                type="search"
                role="combobox"
                aria-expanded={resultados.length > 0}
                aria-controls="exp-opciones"
                aria-autocomplete="list"
                aria-activedescendant={resultados[activo] ? `exp-opcion-${resultados[activo].id}` : undefined}
                value={consulta}
                onChange={(e) => busqueda.escribir(e.target.value)}
                onKeyDown={(e) => void alTeclearBusqueda(e)}
                placeholder="Todos los productos · busca por nombre o código"
                autoComplete="off"
                className="campo w-full pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
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
              id="exp-opciones"
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
                  id={`exp-opcion-${p.id}`}
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
      </div>

      <footer className="grid gap-3 border-t border-borde bg-crema px-6 py-4 sm:grid-cols-2">
        <button
          type="button"
          data-autofoco
          onClick={() => void descargarCsv()}
          disabled={deshabilitado}
          className="boton-primario h-12 rounded-2xl"
        >
          {accion === 'csv' ? (
            <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Download size={16} aria-hidden="true" />
          )}
          {accion === 'csv' ? 'Descargando…' : 'Descargar CSV / Excel'}
        </button>
        <button
          type="button"
          onClick={() => void prepararVista()}
          disabled={deshabilitado}
          className="boton h-12 rounded-2xl"
        >
          {accion === 'vista' ? (
            <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Printer size={16} aria-hidden="true" />
          )}
          {accion === 'vista' ? 'Preparando…' : 'Vista para Imprimir / PDF'}
        </button>
      </footer>
      {toast}
    </Dialogo>
  );
}
