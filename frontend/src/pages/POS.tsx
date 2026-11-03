import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Buscador, PastillasCategoria } from '../components/BarraCatalogo';
import { urlImagen } from '../api/client';
import Banner from '../components/Banner';
import CobroModal from '../components/CobroModal';
import MiniaturaProducto from '../components/MiniaturaProducto';
import Ticket from '../components/Ticket';
import type { MetodoRapido } from '../components/Ticket';
import VentaExitoModal from '../components/VentaExitoModal';
import { useAtajo } from '../hooks/useAtajo';
import { useCatalogo } from '../hooks/useCatalogo';
import { cantidad, dinero, fechaISO } from '../lib/numeros';
import { usePosStore } from '../store/posStore';
import type { ProductoCatalogo, VentaResponse } from '../types';

const LIMITE_MOSTRADOR = 60;
const DIAS_ALERTA = 30;

function porCaducar(fecha: string | null): boolean {
  if (!fecha) return false;
  const limite = new Date();
  limite.setDate(limite.getDate() + DIAS_ALERTA);
  return fecha <= fechaISO(limite);
}

export default function POS() {
  const [consulta, setConsulta] = useState('');
  const [categoriaId, setCategoriaId] = useState<number | null>(null);
  const { filas, activa, setActiva, resuelta, cargando, error, consultar, recargar } = useCatalogo(
    { q: consulta, categoriaId, activo: true },
    LIMITE_MOSTRADOR,
  );
  const [aviso, setAviso] = useState<string | null>(null);
  const [ventaCobrada, setVentaCobrada] = useState<VentaResponse | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [metodo, setMetodo] = useState<MetodoRapido>('EFECTIVO');
  const buscador = useRef<HTMLInputElement>(null);

  // Con el <dialog> abierto la pagina es inerte: el foco vuelve cuando el modal ya salio del DOM
  useEffect(() => {
    if (!cobrando && !ventaCobrada) buscador.current?.focus();
  }, [cobrando, ventaCobrada]);

  useEffect(() => {
    document.getElementById(`fila-${filas[activa]?.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [activa, filas]);

  const agregar = useCallback((producto: ProductoCatalogo): boolean => {
    const resultado = usePosStore.getState().agregarProducto(producto);
    setAviso(resultado.ok ? null : resultado.error);
    return resultado.ok;
  }, []);

  /** Resta una unidad liberando primero el lote mas nuevo del producto */
  const quitarUno = useCallback((producto: ProductoCatalogo) => {
    usePosStore.getState().restarProducto(producto.id);
  }, []);

  const alElegirFila = useCallback(
    (producto: ProductoCatalogo, indice: number) => {
      setActiva(indice);
      agregar(producto);
      buscador.current?.focus();
    },
    [agregar, setActiva],
  );

  async function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (filas.length === 0) return;
      e.preventDefault();
      const paso = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      setActiva((i) => (i + paso + filas.length) % filas.length);
    } else if (e.key === 'Escape') {
      setConsulta('');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = consulta.trim();
      // Un lector de codigos termina con Enter antes de que venza el debounce: se consulta de inmediato
      const vigente = resuelta === q;
      const datos = vigente ? filas : await consultar(q);
      if (!datos || datos.length === 0) return;
      const exacto = datos.find((p) => p.codigo_barras_sku === q);
      const elegido = exacto ?? datos[vigente ? activa : 0];
      if (elegido && agregar(elegido)) setConsulta('');
    }
  }

  function abrirCobro() {
    if (usePosStore.getState().items.length > 0) setCobrando(true);
    else buscador.current?.focus();
  }

  useAtajo('F2', abrirCobro);

  function alCobrar(venta: VentaResponse) {
    // El carrito se vacia de inmediato: ya hay venta en el servidor y no debe poder cobrarse dos veces
    usePosStore.getState().reiniciarVenta();
    setCobrando(false);
    setVentaCobrada(venta);
    setConsulta('');
    void recargar(); // La existencia cambio con la venta
  }

  function nuevaVenta() {
    usePosStore.getState().reiniciarVenta();
    setVentaCobrada(null);
    setAviso(null);
  }

  function vaciar() {
    if (window.confirm('¿Vaciar la venta actual? Se quitan todos los productos.')) {
      usePosStore.getState().reiniciarVenta();
      setAviso(null);
      buscador.current?.focus();
    }
  }

  return (
    <div className="grid min-h-full grid-cols-1 gap-4 p-4 sm:px-6 lg:h-full lg:grid-cols-[minmax(0,1fr)_400px] lg:overflow-hidden">
      <section aria-label="Catálogo" className="flex min-h-0 flex-col gap-3">
        <div>
          <h1 className="mb-3 text-2xl font-semibold tracking-tight text-tinta">Punto de Venta</h1>
          <Buscador
            ref={buscador}
            valor={consulta}
            alCambiar={setConsulta}
            alTeclear={(e) => void alTeclear(e)}
            cargando={cargando}
            etiqueta="Buscar producto por nombre o código de barras"
            placeholder="Buscar producto o escanear código…"
            listaId="resultados"
            filaActivaId={filas[activa] ? `fila-${filas[activa].id}` : undefined}
          />
          <div className="mt-2">
            <PastillasCategoria valor={categoriaId} alCambiar={setCategoriaId} />
          </div>
        </div>

        {error && <Banner tipo="error">{error}</Banner>}

        <div className="min-h-0 flex-1 overflow-auto rounded-3xl p-1">
          <ul
            id="resultados"
            role="listbox"
            aria-label="Productos"
            className="grid grid-cols-[repeat(auto-fill,minmax(172px,1fr))] gap-3"
          >
            {filas.map((p, i) => (
              <TarjetaProducto
                key={p.id}
                producto={p}
                indice={i}
                seleccionada={i === activa}
                alElegir={alElegirFila}
                alQuitar={quitarUno}
              />
            ))}
          </ul>
          {filas.length === 0 && !cargando && !error && (
            <p className="tarjeta p-6 text-center text-sm text-tinta-suave">
              {resuelta
                ? `Sin resultados para "${resuelta}". Revisa la ortografía o escanea el código.`
                : 'El catálogo está vacío. Da de alta productos en Inventario.'}
            </p>
          )}
        </div>
      </section>

      <Ticket
        aviso={aviso}
        metodo={metodo}
        alCambiarMetodo={setMetodo}
        alAvisar={setAviso}
        alCobrar={() => setCobrando(true)}
        alVaciar={vaciar}
      />

      {cobrando && (
        <CobroModal
          metodoInicial={metodo}
          alCambiarMetodo={setMetodo}
          alCerrar={() => setCobrando(false)}
          alCobrar={alCobrar}
        />
      )}

      {ventaCobrada && <VentaExitoModal venta={ventaCobrada} alNuevaVenta={nuevaVenta} />}
    </div>
  );
}

const PASO =
  'foco presion inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-orange-200 bg-white ' +
  'text-orange-700 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-40';

const TarjetaProducto = memo(function TarjetaProducto({
  producto: p,
  indice,
  seleccionada,
  alElegir,
  alQuitar,
}: {
  producto: ProductoCatalogo;
  indice: number;
  seleccionada: boolean;
  alElegir: (producto: ProductoCatalogo, indice: number) => void;
  alQuitar: (producto: ProductoCatalogo) => void;
}) {
  // Primitivo: la tarjeta solo se repinta cuando cambia SU cantidad en el carrito
  const enCarrito = usePosStore((s) =>
    s.items.reduce((suma, l) => (l.productoId === p.id ? suma + l.cantidadMilesimas : suma), 0),
  );
  const agotado = p.lotes.length === 0;
  const bajo = !agotado && Number(p.stock_total) < Number(p.stock_minimo);
  const lote = p.lotes[0];
  return (
    <li
      id={`fila-${p.id}`}
      role="option"
      aria-selected={seleccionada}
      aria-disabled={agotado}
      onClick={() => alElegir(p, indice)}
      className={`relative flex cursor-pointer flex-col items-center rounded-3xl border bg-white p-3 text-center shadow-suave transition-shadow hover:shadow-md ${
        seleccionada ? 'border-orange-500 ring-2 ring-orange-500/30' : 'border-borde'
      } ${agotado ? 'opacity-70' : ''}`}
    >
      {enCarrito > 0 && (
        <span className="absolute right-2.5 top-2.5 z-10 rounded-full bg-orange-600 px-2 py-0.5 font-mono text-xs font-bold text-white">
          {cantidad(enCarrito / 1000)}
        </span>
      )}
      <MiniaturaProducto
        categoria={p.categoria}
        tamano="md"
        apagada={agotado}
        imagenUrl={urlImagen(p.imagen_url)}
      />
      <p className="mt-2 line-clamp-2 min-h-10 text-sm font-extrabold leading-5 text-tinta" title={p.nombre}>
        {p.nombre}
      </p>
      <p className="font-mono text-sm font-semibold tabular-nums text-orange-700">{dinero(p.precio_venta)}</p>
      <p className="mt-0.5 min-h-4 text-[11px] font-semibold text-tinta-suave">
        {agotado ? (
          <span className="font-bold text-rose-600">Agotado</span>
        ) : (
          <>
            <span className={bajo ? 'font-bold text-amber-600' : ''}>Stock {cantidad(p.stock_total)}</span>
            {p.permite_decimales && ' · a granel'}
            {lote?.fecha_caducidad && porCaducar(lote.fecha_caducidad) && (
              <span className="font-bold text-amber-600"> · vence {lote.fecha_caducidad}</span>
            )}
          </>
        )}
      </p>
      <div
        className="mt-2 flex items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
        role="group"
        aria-label={`Cantidad de ${p.nombre}`}
      >
        <button
          type="button"
          onClick={() => alQuitar(p)}
          disabled={enCarrito === 0}
          aria-label={`Restar 1 a ${p.nombre}`}
          className={PASO}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <span className="min-w-8 text-center font-mono text-sm font-bold tabular-nums text-tinta">
          {cantidad(enCarrito / 1000)}
        </span>
        <button
          type="button"
          onClick={() => alElegir(p, indice)}
          disabled={agotado}
          aria-label={`Sumar 1 a ${p.nombre}`}
          className={PASO}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
});
