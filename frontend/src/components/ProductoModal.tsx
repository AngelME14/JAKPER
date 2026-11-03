import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import client, { mensajeDeError } from '../api/client';
import { aEscala, cantidad, escalaATexto } from '../lib/numeros';
import type { Categoria, ProductoCatalogo, ProductoPayload } from '../types';
import Banner from './Banner';
import Dialogo from './Dialogo';
import InsigniaEstado from './InsigniaEstado';
import SelectorFoto from './SelectorFoto';

interface Props {
  /** null = producto nuevo */
  producto: ProductoCatalogo | null;
  categorias: Categoria[];
  alCerrar: () => void;
  alGuardar: (nombre: string) => void;
}

interface Errores {
  nombre?: string;
  categoria?: string;
  precio?: string;
  stockMinimo?: string;
}

// NUMERIC(12,2) y NUMERIC(10,3): enteros escalados, sin signo porque aEscala rechaza "-"
const MAX_PRECIO = 10n ** 12n;
const MAX_STOCK = 10n ** 10n;

/** Tres letras de la categoria + 5 digitos al azar: ACC-49102 */
function generarSku(categoria: string): string {
  const letras = categoria
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, 'X');
  const [azar] = crypto.getRandomValues(new Uint32Array(1));
  return `${letras}-${10000 + (azar % 90000)}`;
}

export default function ProductoModal({ producto, categorias, alCerrar, alGuardar }: Props) {
  const [nombre, setNombre] = useState(producto?.nombre ?? '');
  const [sku, setSku] = useState(producto?.codigo_barras_sku ?? '');
  const [categoriaId, setCategoriaId] = useState(producto ? String(producto.categoria_id) : '');
  const [precio, setPrecio] = useState(producto ? String(Number(producto.precio_venta)) : '');
  const [stockMinimo, setStockMinimo] = useState(producto ? String(Number(producto.stock_minimo)) : '0');
  const [permiteDecimales, setPermiteDecimales] = useState(producto?.permite_decimales ?? false);
  const [requiereCaducidad, setRequiereCaducidad] = useState(producto?.requiere_caducidad ?? false);
  const [foto, setFoto] = useState<File | null>(null);
  const [errores, setErrores] = useState<Errores>({});
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const categoriaActual = categorias.find((c) => String(c.id) === categoriaId)?.nombre ?? producto?.categoria ?? '';

  function pedirSku() {
    const nombreCategoria = categorias.find((c) => String(c.id) === categoriaId)?.nombre;
    if (!nombreCategoria) {
      setErrores((previos) => ({ ...previos, categoria: 'Elige una categoría para generar el SKU.' }));
      return;
    }
    setErrores((previos) => ({ ...previos, categoria: undefined }));
    setSku(generarSku(nombreCategoria));
  }

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const precioEscala = aEscala(precio, 2);
    const stockEscala = aEscala(stockMinimo, 3);
    const nuevos: Errores = {};
    if (!nombre.trim()) nuevos.nombre = 'Escribe el nombre.';
    if (!categoriaId) nuevos.categoria = 'Elige una categoría.';
    if (precioEscala === null || BigInt(precioEscala) >= MAX_PRECIO) {
      nuevos.precio = 'Usa un importe de 0 o más, con máximo 2 decimales.';
    }
    if (stockEscala === null || BigInt(stockEscala) >= MAX_STOCK) {
      nuevos.stockMinimo = 'Usa una cantidad de 0 o más, con máximo 3 decimales.';
    }
    setErrores(nuevos);
    if (Object.keys(nuevos).length > 0 || precioEscala === null || stockEscala === null) return;

    const cuerpo: ProductoPayload = {
      categoria_id: Number(categoriaId),
      codigo_barras_sku: sku.trim() || null,
      nombre: nombre.trim(),
      precio_venta: escalaATexto(precioEscala, 2),
      stock_minimo: escalaATexto(stockEscala, 3),
      permite_decimales: permiteDecimales,
      requiere_caducidad: requiereCaducidad,
    };
    setEnviando(true);
    setErrorEnvio(null);
    try {
      if (foto) {
        // Con foto el servidor espera multipart: POST para crear, PUT para editar
        const datos = new FormData();
        datos.append('categoria_id', String(cuerpo.categoria_id));
        datos.append('codigo_barras_sku', cuerpo.codigo_barras_sku ?? '');
        datos.append('nombre', cuerpo.nombre);
        datos.append('precio_venta', cuerpo.precio_venta);
        datos.append('stock_minimo', cuerpo.stock_minimo);
        datos.append('permite_decimales', String(cuerpo.permite_decimales));
        datos.append('requiere_caducidad', String(cuerpo.requiere_caducidad));
        datos.append('imagen', foto);
        const config = { headers: { 'Content-Type': 'multipart/form-data' } };
        if (producto) await client.put(`/productos/${producto.id}`, datos, config);
        else await client.post('/productos', datos, config);
      } else if (producto) await client.patch(`/productos/${producto.id}`, cuerpo);
      else await client.post('/productos', cuerpo);
      alGuardar(cuerpo.nombre);
    } catch (error) {
      setErrorEnvio(mensajeDeError(error, 'No se pudo guardar el producto. Revisa los datos.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo titulo={producto ? 'Detalles del Producto' : 'Nuevo Producto'} ancho="max-w-2xl" alCerrar={alCerrar}>
      {errorEnvio && <Banner tipo="error">{errorEnvio}</Banner>}
      <form onSubmit={(e) => void guardar(e)} noValidate>
        <div className="grid gap-6 p-6 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-3 sm:items-start">
            <SelectorFoto
              categoria={categoriaActual}
              guardada={producto?.imagen_url ? `${client.defaults.baseURL}/${producto.imagen_url}` : null}
              archivo={foto}
              alCambiar={setFoto}
            />
            {producto && <InsigniaEstado producto={producto} />}
          </div>

          <div className="min-w-0 space-y-4">
            <Campo id="p-nombre" etiqueta="Nombre" error={errores.nombre}>
              <input
                id="p-nombre"
                data-autofoco=""
                maxLength={150}
                value={nombre}
                aria-invalid={Boolean(errores.nombre)}
                onChange={(e) => setNombre(e.target.value)}
                className="campo w-full text-lg font-extrabold"
              />
            </Campo>

            <Campo id="p-precio" etiqueta="Precio de venta" error={errores.precio}>
              <div className="flex items-center gap-1 rounded-lg border border-stone-300 bg-orange-50/50 px-3 shadow-sm focus-within:border-orange-500 focus-within:ring-2 focus-within:ring-orange-500/20 aria-[invalid=true]:border-rose-600" aria-invalid={Boolean(errores.precio)}>
                <span aria-hidden="true" className="font-mono text-3xl font-bold text-orange-600">$</span>
                <input
                  id="p-precio"
                  inputMode="decimal"
                  value={precio}
                  placeholder="0.00"
                  aria-invalid={Boolean(errores.precio)}
                  onChange={(e) => setPrecio(e.target.value)}
                  className="h-14 min-w-0 flex-1 bg-transparent font-mono text-3xl font-bold tabular-nums text-orange-600 outline-none placeholder:text-orange-300"
                />
              </div>
            </Campo>
          </div>

          <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
            <Campo id="p-categoria" etiqueta="Categoría" error={errores.categoria}>
              <select
                id="p-categoria"
                value={categoriaId}
                aria-invalid={Boolean(errores.categoria)}
                onChange={(e) => setCategoriaId(e.target.value)}
                className="campo w-full font-semibold"
              >
                <option value="">Elegir</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo id="p-sku" etiqueta="Código de barras o SKU">
              <div className="flex gap-2">
                <input
                  id="p-sku"
                  maxLength={60}
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  className="campo min-w-0 flex-1 font-mono"
                />
                <button
                  type="button"
                  onClick={pedirSku}
                  title="Crea una clave con las 3 primeras letras de la categoría, si el producto no trae código de barras"
                  className="boton shrink-0"
                >
                  <Sparkles size={16} aria-hidden="true" />
                  Generar SKU
                </button>
              </div>
            </Campo>

            <Campo id="p-minimo" etiqueta="Stock mínimo" error={errores.stockMinimo}>
              <input
                id="p-minimo"
                inputMode="decimal"
                value={stockMinimo}
                aria-invalid={Boolean(errores.stockMinimo)}
                onChange={(e) => setStockMinimo(e.target.value)}
                className="campo w-full font-mono"
              />
            </Campo>

            <Campo id="p-venta" etiqueta="Unidad de venta">
              <select
                id="p-venta"
                value={permiteDecimales ? 'granel' : 'pieza'}
                onChange={(e) => setPermiteDecimales(e.target.value === 'granel')}
                className="campo w-full font-semibold"
              >
                <option value="pieza">Por pieza (enteros)</option>
                <option value="granel">A granel (kilos o mililitros)</option>
              </select>
            </Campo>

            {producto && (
              <Campo id="p-stock" etiqueta="Stock actual">
                <input
                  id="p-stock"
                  readOnly
                  value={`${cantidad(producto.stock_total)} unidades`}
                  title="La existencia cambia con compras, ventas y mermas"
                  className="campo w-full cursor-default bg-orange-50/40 font-semibold"
                />
              </Campo>
            )}

            <label
              htmlFor="p-caducidad"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-stone-300 bg-white px-3 py-2.5 shadow-sm has-[:checked]:border-orange-500 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-orange-500/20 sm:col-span-2"
            >
              <input
                id="p-caducidad"
                type="checkbox"
                role="switch"
                checked={requiereCaducidad}
                onChange={(e) => setRequiereCaducidad(e.target.checked)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="relative h-6 w-11 shrink-0 rounded-full bg-stone-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-orange-600 peer-checked:after:translate-x-5 motion-reduce:transition-none motion-reduce:after:transition-none"
              />
              <span className="text-sm font-bold text-tinta">
                Requiere control de caducidad por lote{' '}
                <span className="font-semibold text-tinta-suave">(Medicamentos y Perecederos)</span>
              </span>
            </label>
          </div>
        </div>

        <footer className="flex justify-end gap-3 border-t border-borde bg-crema px-6 py-4">
          <button type="button" onClick={alCerrar} className="boton h-11 rounded-2xl px-6">
            Cancelar
          </button>
          <button type="submit" disabled={enviando} className="boton-primario h-11 rounded-2xl px-6">
            {enviando ? 'Guardando…' : producto ? 'Guardar Cambios' : 'Crear Producto'}
          </button>
        </footer>
      </form>
    </Dialogo>
  );
}

function Campo({
  id,
  etiqueta,
  error,
  children,
}: {
  id: string;
  etiqueta: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="etiqueta mb-1.5 block">
        {etiqueta}
      </label>
      {children}
      {error && <p className="mt-1 text-sm font-semibold text-rose-700">{error}</p>}
    </div>
  );
}
