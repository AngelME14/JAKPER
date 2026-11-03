import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Pencil, Plus, Power } from 'lucide-react';
import client, { mensajeDeError } from '../api/client';
import { Buscador, SelectorCategoria } from '../components/BarraCatalogo';
import Banner from '../components/Banner';
import InsigniaEstado from '../components/InsigniaEstado';
import MiniaturaProducto from '../components/MiniaturaProducto';
import ProductoModal from '../components/ProductoModal';
import { useAtajo } from '../hooks/useAtajo';
import { useCatalogo } from '../hooks/useCatalogo';
import { cantidad, dinero } from '../lib/numeros';
import { useAuthStore } from '../store/authStore';
import { useCatalogosStore } from '../store/catalogosStore';
import type { ProductoCatalogo } from '../types';

const LIMITE = 100;

type Estado = 'activos' | 'inactivos' | 'todos';
const ACTIVO_POR_ESTADO: Record<Estado, boolean | null> = { activos: true, inactivos: false, todos: null };

/** undefined = modal cerrado; null = producto nuevo */
type Edicion = ProductoCatalogo | null | undefined;

export default function Productos() {
  const rol = useAuthStore((s) => s.rol);
  const puedeEditar = rol === 'Admin' || rol === 'Encargado';
  const categorias = useCatalogosStore((s) => s.categorias);
  const errorCatalogos = useCatalogosStore((s) => s.error);

  const [q, setQ] = useState('');

  const [categoriaId, setCategoriaId] = useState<number | null>(null);
  const [estado, setEstado] = useState<Estado>('activos');
  const { filas, activa, setActiva, hayMas, resuelta, cargando, error, consultar, recargar } = useCatalogo(
    { q, categoriaId, activo: ACTIVO_POR_ESTADO[estado] },
    LIMITE,
  );

  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Edicion>(undefined);
  const buscador = useRef<HTMLInputElement>(null);

  // Con el <dialog> abierto la pagina es inerte: el foco vuelve cuando el modal ya salio del DOM
  const modalAbierto = edicion !== undefined;
  useEffect(() => {
    if (!modalAbierto) buscador.current?.focus();
  }, [modalAbierto]);

  useEffect(() => {
    document.getElementById(`producto-${filas[activa]?.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [activa, filas]);

  useAtajo('F3', () => {
    if (puedeEditar) setEdicion(null);
  });

  function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    if (filas.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const paso = e.key === 'ArrowDown' ? 1 : -1;
      setActiva((i) => (i + paso + filas.length) % filas.length);
    } else if (e.key === 'Enter' && puedeEditar) {
      e.preventDefault();
      setEdicion(filas[activa]);
    }
  }

  const alternar = useCallback(
    async (producto: ProductoCatalogo) => {
      setErrorAccion(null);
      setAviso(null);
      try {
        await client.patch(`/productos/${producto.id}`, { activo: !producto.activo });
        setAviso(`${producto.nombre} ${producto.activo ? 'desactivado' : 'activado'}.`);
        await recargar();
      } catch (e) {
        setErrorAccion(mensajeDeError(e, 'No se pudo cambiar el estado del producto.'));
      }
    },
    [recargar],
  );

  function alGuardar(nombre: string) {
    setAviso(`${nombre} ${edicion ? 'actualizado' : 'creado'}.`);
    setEdicion(undefined);
    setErrorAccion(null);
    void recargar();
  }

  const bajoMinimo = filas.filter((p) => Number(p.stock_total) < Number(p.stock_minimo)).length;
  const columnas = puedeEditar ? 7 : 6;

  return (
    <div className="flex min-h-full flex-col gap-4 p-4 pb-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-tinta">Inventario</h1>
          <p className="mt-0.5 text-base text-tinta-suave">Gestiona tu catálogo y stock en tiempo real</p>
        </div>
        {puedeEditar && (
          <button
            type="button"
            onClick={() => setEdicion(null)}
            aria-keyshortcuts="F3"
            className="boton-primario h-12 rounded-2xl px-5"
          >
            <Plus size={18} strokeWidth={2.6} aria-hidden="true" />
            Agregar Producto
            <kbd className="tecla">F3</kbd>
          </button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Buscador
          ref={buscador}
          valor={q}
          alCambiar={setQ}
          alTeclear={alTeclear}
          cargando={cargando}
          etiqueta="Buscar productos"
          placeholder="Buscar por nombre o código…"
        />
        <SelectorCategoria valor={categoriaId} alCambiar={setCategoriaId} />
        <select
          aria-label="Filtrar por estado"
          value={estado}
          onChange={(e) => setEstado(e.target.value as Estado)}
          className="campo h-12 font-semibold"
        >
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
          <option value="todos">Activos e inactivos</option>
        </select>
      </div>

      {(error ?? errorCatalogos) && <Banner tipo="error">{error ?? errorCatalogos}</Banner>}
      {errorAccion && (
        <Banner tipo="error" alCerrar={() => setErrorAccion(null)}>
          {errorAccion}
        </Banner>
      )}
      {aviso && (
        <Banner tipo="exito" alCerrar={() => setAviso(null)}>
          {aviso}
        </Banner>
      )}

      <div className="tarjeta min-h-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tabla w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs font-bold uppercase tracking-wider text-stone-800">
              <tr>
                <th scope="col" className="celda-titulo w-20">Imagen</th>
                <th scope="col" className="celda-titulo">Nombre</th>
                <th scope="col" className="celda-titulo">Categoría</th>
                <th scope="col" className="celda-titulo text-right">Stock</th>
                <th scope="col" className="celda-titulo text-right">Precio</th>
                <th scope="col" className="celda-titulo">Estado</th>
                {puedeEditar && (
                  <th scope="col" className="celda-titulo w-24 text-right">
                    <span className="sr-only">Acciones</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {filas.map((p, i) => (
                <FilaProducto
                  key={p.id}
                  producto={p}
                  indice={i}
                  seleccionada={i === activa}
                  puedeEditar={puedeEditar}
                  alSeleccionar={setActiva}
                  alEditar={setEdicion}
                  alAlternar={alternar}
                />
              ))}
              {filas.length === 0 && !cargando && !error && (
                <tr>
                  <td colSpan={columnas} className="p-8 text-center text-sm font-semibold text-tinta-suave">
                    {resuelta
                      ? `Sin productos para "${resuelta}". Revisa la ortografía o cambia los filtros.`
                      : 'Sin productos con estos filtros.'}
                    {puedeEditar && ' Pulsa F3 para crear uno.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-borde bg-crema px-4 py-3 text-sm font-semibold text-tinta-suave">
          <span>
            Mostrando <span className="font-mono">{filas.length}</span> producto{filas.length === 1 ? '' : 's'}
          </span>
          {bajoMinimo > 0 && (
            <span className="text-orange-600">
              <span className="font-mono">{bajoMinimo}</span> bajo el mínimo
            </span>
          )}
          {hayMas && (
            <button
              type="button"
              disabled={cargando}
              onClick={() => void consultar(q, filas.length)}
              className="boton ml-auto h-9"
            >
              Cargar más
            </button>
          )}
        </footer>
      </div>

      {edicion !== undefined && (
        <ProductoModal
          producto={edicion}
          categorias={categorias}
          alCerrar={() => setEdicion(undefined)}
          alGuardar={alGuardar}
        />
      )}
    </div>
  );
}

const FilaProducto = memo(function FilaProducto({
  producto: p,
  indice,
  seleccionada,
  puedeEditar,
  alSeleccionar,
  alEditar,
  alAlternar,
}: {
  producto: ProductoCatalogo;
  indice: number;
  seleccionada: boolean;
  puedeEditar: boolean;
  alSeleccionar: (indice: number) => void;
  alEditar: (producto: ProductoCatalogo) => void;
  alAlternar: (producto: ProductoCatalogo) => Promise<void>;
}) {
  const bajo = Number(p.stock_total) < Number(p.stock_minimo);
  return (
    <tr
      id={`producto-${p.id}`}
      onClick={() => alSeleccionar(indice)}
      onDoubleClick={() => puedeEditar && alEditar(p)}
      className={`border-t border-borde ${seleccionada ? 'bg-orange-50' : 'hover:bg-orange-50/40'} ${
        p.activo ? '' : 'text-tinta-tenue'
      }`}
    >
      <td className="celda">
        <MiniaturaProducto
          categoria={p.categoria}
          tamano="sm"
          apagada={!p.activo}
          imagenUrl={p.imagen_url ? `${client.defaults.baseURL}/${p.imagen_url}` : null}
        />
      </td>
      <td className="celda">
        <p className={`font-extrabold ${p.activo ? 'text-tinta' : ''}`}>{p.nombre}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-tinta-suave">
          {p.codigo_barras_sku && <span className="font-mono">{p.codigo_barras_sku}</span>}
          {p.permite_decimales && <span>a granel</span>}
          {p.requiere_caducidad && <span>con caducidad</span>}
        </p>
      </td>
      <td className="celda font-semibold text-tinta-suave">{p.categoria}</td>
      <td
        title={`Mínimo: ${cantidad(p.stock_minimo)}`}
        className={`celda text-right font-mono tabular-nums ${bajo ? 'font-bold text-orange-600' : p.activo ? 'text-tinta' : ''}`}
      >
        {cantidad(p.stock_total)}
      </td>
      <td className={`celda text-right font-mono font-semibold tabular-nums ${p.activo ? 'text-tinta' : ''}`}>
        {dinero(p.precio_venta)}
      </td>
      <td className="celda">
        <InsigniaEstado producto={p} />
      </td>
      {puedeEditar && (
        <td className="whitespace-nowrap px-3 py-0 text-right">
          <button
            type="button"
            onClick={() => alEditar(p)}
            aria-label={`Editar ${p.nombre}`}
            title="Editar"
            className="foco presion inline-flex size-9 items-center justify-center rounded-xl text-tinta-suave hover:bg-orange-100 hover:text-orange-700"
          >
            <Pencil size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void alAlternar(p)}
            aria-label={`${p.activo ? 'Desactivar' : 'Activar'} ${p.nombre}`}
            title={p.activo ? 'Desactivar' : 'Activar'}
            className={`foco presion inline-flex size-9 items-center justify-center rounded-xl ${
              p.activo
                ? 'text-tinta-suave hover:bg-rose-50 hover:text-rose-600'
                : 'text-emerald-600 hover:bg-emerald-50'
            }`}
          >
            <Power size={16} aria-hidden="true" />
          </button>
        </td>
      )}
    </tr>
  );
});
