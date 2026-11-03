import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Plus, Search, X } from 'lucide-react';
import client, { mensajeDeError } from '../api/client';
import NuevoProveedorModal from '../components/NuevoProveedorModal';
import Toast from '../components/Toast';
import { MIN_CARACTERES, useBusquedaProductos } from '../hooks/useBusquedaProductos';
import { aEscala, escalaATexto, fechaISO as hoyISO, formatoDinero } from '../lib/numeros';
import type { CompraResponse, Producto, ProductoBusqueda, Proveedor } from '../types';

type ProductoCompra = Pick<
  Producto,
  'id' | 'nombre' | 'codigo_barras_sku' | 'permite_decimales' | 'requiere_caducidad'
>;

type Campo = 'cantidad' | 'costo' | 'lote' | 'caducidad';

interface Fila {
  clave: number;
  producto: ProductoCompra;
  cantidad: string;
  costo: string;
  lote: string;
  /** yyyy-mm-dd, o vacio */
  caducidad: string;
}

type ErroresFila = Partial<Record<Campo, string>>;

interface EvaluacionFila {
  errores: ErroresFila;
  aviso: string | null;
  subtotalCentavos: number | null;
}

// Mismos limites que el backend: Cantidad NUMERIC(10,3), Dinero NUMERIC(12,2), codigo_lote <= 80
const MAX_CANTIDAD_MILESIMAS = 1e10;
const MAX_COSTO_CENTAVOS = 1e12;
const MAX_LOTE = 80;
const MAX_FACTURA = 60;

/** Lote que se muestra cuando el producto no lleva control de caducidad: el servidor le pone clave */
const LOTE_AUTOMATICO = 'AUTOMÁTICO';
const esLoteAutomatico = (lote: string) => lote.trim() === '' || lote.trim().toUpperCase() === LOTE_AUTOMATICO;

const campo = 'campo w-full';
const numerico = 'campo w-full text-right font-mono tabular-nums';
const th = 'celda-titulo';

function evaluarFila(fila: Fila, hoy: string): EvaluacionFila {
  const errores: ErroresFila = {};
  let aviso: string | null = null;

  const milesimas = aEscala(fila.cantidad, 3);
  if (fila.cantidad.trim() === '') errores.cantidad = 'Obligatoria';
  else if (milesimas === null) errores.cantidad = 'Máximo 3 decimales';
  else if (milesimas <= 0) errores.cantidad = 'Mayor a 0';
  else if (milesimas >= MAX_CANTIDAD_MILESIMAS) errores.cantidad = 'Demasiado grande';
  else if (!fila.producto.permite_decimales && milesimas % 1000 !== 0) errores.cantidad = 'Solo enteros';

  const centavos = aEscala(fila.costo, 2);
  if (fila.costo.trim() === '') errores.costo = 'Obligatorio';
  else if (centavos === null) errores.costo = 'Máximo 2 decimales';
  else if (centavos >= MAX_COSTO_CENTAVOS) errores.costo = 'Demasiado grande';

  const lote = fila.lote.trim();
  if (lote.length > MAX_LOTE) errores.lote = `Máximo ${MAX_LOTE} caracteres`;
  // Sin control de caducidad el lote puede quedar automatico y la fecha no aplica
  if (fila.producto.requiere_caducidad) {
    if (lote === '') errores.lote = 'Obligatorio';
    if (fila.caducidad === '') errores.caducidad = 'Obligatoria para este producto';
    else if (fila.caducidad < hoy) aviso = 'Ya venció: no se podrá vender';
  }

  const subtotalCentavos =
    errores.cantidad === undefined && errores.costo === undefined && milesimas !== null && centavos !== null
      ? Math.floor((milesimas * centavos + 500) / 1000)
      : null;

  return { errores, aviso, subtotalCentavos };
}

export default function Compras() {
  const formulario = useRef<HTMLFormElement>(null);
  const buscadorRef = useRef<HTMLInputElement>(null);
  const siguienteClave = useRef(1);
  const aFocar = useRef<number | null>(null);

  // ---- Proveedor ----
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [errorProveedores, setErrorProveedores] = useState<string | null>(null);
  const [proveedorId, setProveedorId] = useState('');
  const proveedor = proveedores.find((p) => String(p.id) === proveedorId) ?? null;
  const [factura, setFactura] = useState('');
  const [facturaTocada, setFacturaTocada] = useState(false);
  const [modalProveedor, setModalProveedor] = useState(false);
  const botonProveedor = useRef<HTMLButtonElement>(null);

  function alCrearProveedor(nuevo: Proveedor) {
    setProveedores((previo) =>
      [...previo, nuevo].sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es')),
    );
    setProveedorId(String(nuevo.id));
    setErrorProveedores(null);
    setModalProveedor(false);
    setAviso({ tipo: 'exito', texto: `Proveedor ${nuevo.razon_social} creado y seleccionado.` });
  }

  function cerrarModalProveedor() {
    setModalProveedor(false);
    botonProveedor.current?.focus();
  }

  useEffect(() => {
    const controlador = new AbortController();
    client
      .get<Proveedor[]>('/proveedores', { signal: controlador.signal })
      .then(({ data }) => setProveedores(data))
      .catch((e: unknown) => {
        if (!controlador.signal.aborted) {
          setErrorProveedores(
            mensajeDeError(e, 'No se pudieron cargar los proveedores.'),
          );
        }
      });
    return () => controlador.abort();
  }, []);

  // ---- Lineas ----
  const [filas, setFilas] = useState<Fila[]>([]);
  const [tocados, setTocados] = useState<ReadonlySet<string>>(new Set());
  const [intentado, setIntentado] = useState(0);
  const hoy = hoyISO();
  const evaluaciones = useMemo(() => filas.map((f) => evaluarFila(f, hoy)), [filas, hoy]);
  const totalCentavos = evaluaciones.reduce((suma, e) => suma + (e.subtotalCentavos ?? 0), 0);

  const mostrar = (clave: number, c: Campo) => intentado > 0 || tocados.has(`${clave}:${c}`);
  const tocar = (clave: number, c: Campo) =>
    setTocados((previo) => (previo.has(`${clave}:${c}`) ? previo : new Set(previo).add(`${clave}:${c}`)));

  function editar(clave: number, c: Campo, valor: string) {
    setFilas((previo) => previo.map((f) => (f.clave === clave ? { ...f, [c]: valor } : f)));
  }

  function agregarFila(producto: ProductoCompra, enfocarFila = true) {
    const clave = siguienteClave.current++;
    if (enfocarFila) aFocar.current = clave;
    setFilas((previo) => [
      ...previo,
      {
        clave,
        producto,
        cantidad: '',
        costo: '',
        lote: producto.requiere_caducidad ? '' : LOTE_AUTOMATICO,
        caducidad: '',
      },
    ]);
    setAviso(null);
    // Sugiere el ultimo costo pagado; si la persona ya escribio uno, no se pisa
    client
      .get<{ ultimo_costo: string }>(`/productos/${producto.id}/ultimo-costo`)
      .then(({ data }) => {
        const costo = Number(data.ultimo_costo);
        if (!(costo > 0)) return;
        setFilas((previo) =>
          previo.map((f) => (f.clave === clave && f.costo === '' ? { ...f, costo: String(costo) } : f)),
        );
      })
      .catch(() => {
        // Sin sugerencia el costo se captura a mano
      });
  }

  useEffect(() => {
    if (aFocar.current === null) return;
    document.getElementById(`cantidad-${aFocar.current}`)?.focus();
    aFocar.current = null;
  }, [filas]);

  function quitarFila(clave: number) {
    setFilas((previo) => previo.filter((f) => f.clave !== clave));
  }

  // ---- Busqueda de productos ----
  const busqueda = useBusquedaProductos();
  const { resultados, activo, consulta, resuelta, cargando } = busqueda;
  const [abierto, setAbierto] = useState(false);

  // Un codigo escaneado deja el foco en el buscador para seguir escaneando; elegir de la lista pasa a la cantidad
  function elegir(producto: ProductoBusqueda, escaneado = false) {
    agregarFila(producto, !escaneado);
    busqueda.limpiar();
    setAbierto(false);
    if (escaneado) buscadorRef.current?.focus();
  }

  // El buscador nace enfocado: el lector de codigos escribe sin tocar nada
  useEffect(() => {
    buscadorRef.current?.focus();
  }, []);

  async function alTeclearBusqueda(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (resultados.length === 0) return;
      e.preventDefault();
      setAbierto(true);
      const paso = e.key === 'ArrowDown' ? 1 : -1;
      busqueda.setActivo((i) => (i + paso + resultados.length) % resultados.length);
    } else if (e.key === 'Escape') {
      busqueda.limpiar();
      setAbierto(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = consulta.trim();
      if (q.length < MIN_CARACTERES) return;
      const vigente = resuelta === q;
      const datos = vigente ? resultados : await busqueda.buscarAhora(q);
      if (!datos || datos.length === 0) return;
      const porCodigo = datos.find((p) => p.codigo_barras_sku === q);
      const elegido = porCodigo ?? datos[vigente ? activo : 0];
      if (elegido) elegir(elegido, porCodigo !== undefined);
    }
  }

  useEffect(() => {
    document.getElementById(`opcion-${resultados[activo]?.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [activo, resultados]);

  // ---- Envio ----
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const [aviso, setAviso] = useState<{ tipo: 'error' | 'exito'; texto: ReactNode } | null>(null);
  const cerrarAviso = useCallback(() => setAviso(null), []);

  const facturaLimpia = factura.trim();
  const camposInvalidos =
    evaluaciones.reduce((n, e) => n + Object.keys(e.errores).length, 0) + (proveedor ? 0 : 1) + (facturaLimpia ? 0 : 1);
  // Lo primero que falta para poder registrar; vacio = listo
  const bloqueo = !proveedor
    ? 'Elige un proveedor.'
    : !facturaLimpia
      ? 'Escribe la factura o remisión del proveedor.'
      : filas.length === 0
        ? 'Agrega al menos un producto.'
        : camposInvalidos > 0
          ? `Completa ${camposInvalidos} ${camposInvalidos === 1 ? 'campo obligatorio' : 'campos obligatorios'}.`
          : totalCentavos <= 0
            ? 'El total debe ser mayor a $0.00.'
            : '';

  useEffect(() => {
    if (intentado > 0) formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [intentado]);

  async function registrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviandoRef.current) return;
    setAviso(null);
    if (bloqueo) {
      setIntentado((n) => n + 1);
      setAviso({ tipo: 'error', texto: bloqueo });
      return;
    }
    enviandoRef.current = true;
    setEnviando(true);
    try {
      const { data } = await client.post<CompraResponse>('/compras', {
        factura_proveedor: facturaLimpia,
        proveedor_id: proveedor?.id,
        items: filas.map((f) => ({
          producto_id: f.producto.id,
          // Sin control de caducidad no se manda lote ni fecha: el servidor asigna la clave del lote
          codigo_lote: f.producto.requiere_caducidad || !esLoteAutomatico(f.lote) ? f.lote.trim() : null,
          fecha_caducidad: f.producto.requiere_caducidad && f.caducidad !== '' ? f.caducidad : null,
          cantidad: escalaATexto(aEscala(f.cantidad, 3) ?? 0, 3),
          costo_unitario: escalaATexto(aEscala(f.costo, 2) ?? 0, 2),
        })),
      });
      setAviso({
        tipo: 'exito',
        texto: (
          <>
            Entrada <span className="font-mono">{data.folio}</span> registrada:{' '}
            <span className="font-mono">{filas.length}</span> {filas.length === 1 ? 'lote' : 'lotes'} por{' '}
            <span className="font-mono">${formatoDinero.format(Number(data.total))}</span>.
          </>
        ),
      });
      setFilas([]);
      setFactura('');
      setFacturaTocada(false);
      setTocados(new Set());
      setIntentado(0);
      buscadorRef.current?.focus();
    } catch (error) {
      setAviso({ tipo: 'error', texto: mensajeDeError(error, 'No se pudo registrar la entrada. Intenta de nuevo.') });
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  // Enter en una celda pasa a la siguiente en vez de enviar el formulario
  function alTeclearFormulario(e: KeyboardEvent<HTMLFormElement>) {
    const destino = e.target;
    if (e.key !== 'Enter' || !(destino instanceof HTMLInputElement) || destino.dataset.celda === undefined) return;
    e.preventDefault();
    const celdas = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-celda]')];
    (celdas[celdas.indexOf(destino) + 1] ?? buscadorRef.current)?.focus();
  }

  function alCambiarNumero(clave: number, c: 'cantidad' | 'costo') {
    return (e: ChangeEvent<HTMLInputElement>) => editar(clave, c, e.target.value.replace(/[^\d.,]/g, ''));
  }

  const proveedorInvalido = intentado > 0 && !proveedor;
  const facturaInvalida = (intentado > 0 || facturaTocada) && !facturaLimpia;

  return (
    <form
      ref={formulario}
      onSubmit={(e) => void registrar(e)}
      onKeyDown={alTeclearFormulario}
      noValidate
      className="space-y-4 p-4 pb-8 sm:px-6"
    >
      <header>
        <h1 className="text-4xl font-extrabold tracking-tight text-tinta">Compras</h1>
        <p className="mt-0.5 text-base text-tinta-suave">Registra la entrada de lotes que llegan de tus proveedores</p>
      </header>

      {aviso && (
        <Toast tipo={aviso.tipo} alCerrar={cerrarAviso}>
          {aviso.texto}
        </Toast>
      )}
      {modalProveedor &&
        createPortal(
          <NuevoProveedorModal alCerrar={cerrarModalProveedor} alCrear={alCrearProveedor} />,
          document.body,
        )}

      {/* ---- Cabecera: proveedor ---- */}
      <fieldset className="tarjeta px-5 pb-4 pt-2">
        <legend className="px-2 text-lg font-extrabold text-tinta">Proveedor</legend>
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[2fr_1fr]">
          <div>
            <label htmlFor="proveedor" className="etiqueta mb-1.5 block">
              Razón social
            </label>
            <div className="flex gap-2">
              <select
                id="proveedor"
                value={proveedorId}
                onChange={(e) => setProveedorId(e.target.value)}
                aria-invalid={proveedorInvalido}
                aria-describedby="proveedor-ayuda"
                className="campo min-w-0 flex-1"
              >
                <option value="">Selecciona un proveedor</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.razon_social}
                  </option>
                ))}
              </select>
              <button
                ref={botonProveedor}
                type="button"
                onClick={() => setModalProveedor(true)}
                className="boton shrink-0"
              >
                <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
                Nuevo Proveedor
              </button>
            </div>
            <p id="proveedor-ayuda" className="mt-1.5 min-h-6 text-sm font-semibold text-rose-700">
              {errorProveedores ??
                (proveedorInvalido ? (
                  'Elige el proveedor de esta entrada'
                ) : proveedor ? (
                  <span className="flex flex-wrap gap-1.5 font-normal">
                    <Ficha etiqueta="RFC" valor={proveedor.rfc} mono />
                    <Ficha etiqueta="Tel." valor={proveedor.telefono} mono />
                    {proveedor.correo && <Ficha etiqueta="Correo" valor={proveedor.correo} />}
                  </span>
                ) : (
                  ''
                ))}
            </p>
          </div>
          <div>
            <label htmlFor="factura-proveedor" className="etiqueta mb-1.5 block">
              Factura / Remisión del Proveedor
            </label>
            <input
              id="factura-proveedor"
              maxLength={MAX_FACTURA}
              value={factura}
              placeholder="Ej. FAC-10293"
              autoComplete="off"
              aria-required="true"
              aria-invalid={facturaInvalida}
              aria-describedby="factura-ayuda"
              onChange={(e) => setFactura(e.target.value)}
              onBlur={() => setFacturaTocada(true)}
              className={`${campo} font-mono`}
            />
            <p id="factura-ayuda" className="mt-1.5 min-h-6 text-sm font-semibold text-rose-700">
              {facturaInvalida ? 'Escribe la factura o remisión que trae el repartidor' : ''}
            </p>
          </div>
        </div>
      </fieldset>

      {/* ---- Partidas ---- */}
      <section aria-labelledby="partidas" className="tarjeta">
        <header className="space-y-3 border-b border-borde px-5 py-4">
          <h2 id="partidas" className="text-lg font-extrabold text-tinta">
            Productos recibidos
          </h2>
          <div
            className="relative mx-auto w-full max-w-3xl"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setAbierto(false);
            }}
          >
            <Search
              size={20}
              strokeWidth={2}
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-tinta-suave"
            />
            <input
              ref={buscadorRef}
              type="search"
              role="combobox"
              aria-label="Agregar producto por nombre o código de barras"
              aria-expanded={abierto && resultados.length > 0}
              aria-controls="opciones-producto"
              aria-autocomplete="list"
              aria-activedescendant={abierto && resultados[activo] ? `opcion-${resultados[activo].id}` : undefined}
              value={consulta}
              onChange={(e) => {
                busqueda.escribir(e.target.value);
                setAbierto(true);
              }}
              onFocus={() => setAbierto(true)}
              onKeyDown={(e) => void alTeclearBusqueda(e)}
              placeholder="Escanea el código de barras o escribe el nombre del producto"
              autoComplete="off"
              autoFocus
              className={`${campo} h-14 pl-12 pr-10 text-base [&::-webkit-search-cancel-button]:hidden`}
            />
            {cargando && (
              <Loader2
                size={16}
                aria-hidden="true"
                className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-orange-600 motion-reduce:animate-none"
              />
            )}
            {abierto && (resultados.length > 0 || busqueda.error || (resuelta && !cargando)) && (
              <ul
                id="opciones-producto"
                role="listbox"
                aria-label="Resultados de búsqueda"
                className="absolute inset-x-0 top-full z-10 mt-2 max-h-72 overflow-auto rounded-2xl border border-borde bg-white py-1 shadow-flota"
              >
                {busqueda.error && <li className="px-4 py-2.5 text-sm font-semibold text-rose-700">{busqueda.error}</li>}
                {!busqueda.error && resultados.length === 0 && (
                  <li className="px-4 py-2.5 text-sm text-tinta-suave">Sin resultados para &quot;{resuelta}&quot;.</li>
                )}
                {resultados.map((p, i) => (
                  <li
                    key={p.id}
                    id={`opcion-${p.id}`}
                    role="option"
                    aria-selected={i === activo}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => elegir(p)}
                    onMouseMove={() => i !== activo && busqueda.setActivo(i)}
                    className={`flex cursor-pointer items-baseline gap-2 px-4 py-2.5 text-sm font-bold ${
                      i === activo ? 'bg-orange-50 text-orange-800' : 'text-tinta'
                    }`}
                  >
                    <span className="flex-1">{p.nombre}</span>
                    {p.requiere_caducidad && <span className="text-xs text-tinta-suave">con caducidad</span>}
                    <span className="font-mono text-xs text-tinta-suave">{p.codigo_barras_sku ?? ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </header>

        {filas.length === 0 ? (
          <p className="flex flex-col items-center gap-2 px-5 py-12 text-center text-sm font-semibold text-tinta-suave">
            <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600">
              <Plus size={22} strokeWidth={2.4} />
            </span>
            Busca un producto para capturar cantidad, costo, lote y caducidad.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla w-full min-w-[56rem] text-sm">
              <thead className="text-left text-xs font-bold uppercase tracking-wider text-stone-800">
                <tr>
                  <th scope="col" className={th}>Producto</th>
                  <th scope="col" className={`${th} w-28 text-right`}>Cantidad</th>
                  <th scope="col" className={`${th} w-32 text-right`}>Costo unitario</th>
                  <th scope="col" className={`${th} w-28 text-right`}>Subtotal</th>
                  <th scope="col" className={`${th} w-40`}>Lote</th>
                  <th scope="col" className={`${th} w-40`}>Caducidad</th>
                  <th scope="col" className="celda-titulo w-12 px-2"><span className="sr-only">Quitar</span></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => {
                  const { errores, aviso, subtotalCentavos } = evaluaciones[i];
                  const mensaje = (c: Campo) => (mostrar(f.clave, c) ? errores[c] : undefined);
                  return (
                    <tr key={f.clave} className="border-t border-borde align-top">
                      <td className="px-3 py-3">
                        <p className="font-extrabold text-tinta">{f.producto.nombre}</p>
                        <p className="text-xs text-tinta-suave">
                          <span className="font-mono">{f.producto.codigo_barras_sku ?? 'sin código'}</span>
                          {f.producto.permite_decimales && <span className="ml-2">a granel</span>}
                          {f.producto.requiere_caducidad && <span className="ml-2">caducidad obligatoria</span>}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <input
                          id={`cantidad-${f.clave}`}
                          data-celda=""
                          inputMode="decimal"
                          value={f.cantidad}
                          onChange={alCambiarNumero(f.clave, 'cantidad')}
                          onBlur={() => tocar(f.clave, 'cantidad')}
                          aria-label={`Cantidad de ${f.producto.nombre}`}
                          aria-invalid={mensaje('cantidad') !== undefined}
                          aria-describedby={`error-cantidad-${f.clave}`}
                          className={numerico}
                        />
                        <MensajeError id={`error-cantidad-${f.clave}`} texto={mensaje('cantidad')} alineado />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          data-celda=""
                          inputMode="decimal"
                          value={f.costo}
                          onChange={alCambiarNumero(f.clave, 'costo')}
                          onBlur={() => tocar(f.clave, 'costo')}
                          aria-label={`Costo unitario de ${f.producto.nombre}`}
                          aria-invalid={mensaje('costo') !== undefined}
                          aria-describedby={`error-costo-${f.clave}`}
                          className={numerico}
                        />
                        <MensajeError id={`error-costo-${f.clave}`} texto={mensaje('costo')} alineado />
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums leading-10">
                        {subtotalCentavos === null ? (
                          <span className="text-tinta-tenue">-</span>
                        ) : (
                          `$${formatoDinero.format(subtotalCentavos / 100)}`
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <input
                          data-celda=""
                          value={f.lote}
                          onChange={(e) => editar(f.clave, 'lote', e.target.value)}
                          onBlur={() => tocar(f.clave, 'lote')}
                          aria-label={`Código de lote de ${f.producto.nombre}`}
                          aria-invalid={mensaje('lote') !== undefined}
                          aria-describedby={`error-lote-${f.clave}`}
                          autoComplete="off"
                          className={`${campo} font-mono`}
                        />
                        <MensajeError id={`error-lote-${f.clave}`} texto={mensaje('lote')} />
                      </td>
                      <td className="px-3 py-3">
                        {f.producto.requiere_caducidad ? (
                          <input
                            data-celda=""
                            type="date"
                            value={f.caducidad}
                            onChange={(e) => editar(f.clave, 'caducidad', e.target.value)}
                            onBlur={() => tocar(f.clave, 'caducidad')}
                            aria-label={`Fecha de caducidad de ${f.producto.nombre}`}
                            aria-required="true"
                            aria-invalid={mensaje('caducidad') !== undefined}
                            aria-describedby={`error-caducidad-${f.clave}`}
                            className={`${campo} font-mono`}
                          />
                        ) : (
                          <input
                            type="text"
                            disabled
                            value="No aplica"
                            aria-label={`Fecha de caducidad de ${f.producto.nombre}: no aplica`}
                            className={`${campo} cursor-not-allowed bg-stone-100 text-tinta-suave`}
                          />
                        )}
                        <MensajeError id={`error-caducidad-${f.clave}`} texto={mensaje('caducidad')} />
                        {aviso && !mensaje('caducidad') && <p className="mt-1 text-xs font-semibold text-amber-700">{aviso}</p>}
                      </td>
                      <td className="px-2 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => quitarFila(f.clave)}
                          aria-label={`Quitar ${f.producto.nombre}`}
                          title="Quitar"
                          className="foco presion inline-flex size-9 items-center justify-center rounded-xl text-tinta-suave hover:bg-rose-50 hover:text-rose-600"
                        >
                          <X size={18} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-end gap-x-5 gap-y-3 rounded-b-3xl border-t border-borde bg-crema px-5 py-4">
          {bloqueo && <p className="mr-auto text-sm font-semibold text-tinta-suave">{bloqueo}</p>}
          <p className="text-sm text-tinta-suave">
            <span className="font-mono">{filas.length}</span> {filas.length === 1 ? 'lote' : 'lotes'}
          </p>
          <p className="flex items-baseline gap-2">
            <span className="text-lg font-extrabold text-tinta">Total:</span>
            <output className="font-mono text-3xl font-bold tabular-nums text-tinta">
              ${formatoDinero.format(totalCentavos / 100)}
            </output>
          </p>
          <button
            type="submit"
            disabled={enviando || bloqueo !== ''}
            className="boton-primario h-12 rounded-2xl px-6 text-base disabled:bg-orange-600 disabled:opacity-50"
          >
            {enviando ? 'Registrando…' : 'Registrar entrada'}
          </button>
        </footer>
      </section>
    </form>
  );
}

/** Dato del proveedor en una ficha compacta */
function Ficha({ etiqueta, valor, mono = false }: { etiqueta: string; valor?: string | null; mono?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-stone-100 px-2 py-0.5 text-xs text-tinta-suave">
      {etiqueta}
      <span className={`font-semibold ${mono ? 'font-mono' : ''} ${valor ? 'text-tinta' : 'text-tinta-tenue'}`}>
        {valor || 'sin dato'}
      </span>
    </span>
  );
}

function MensajeError({ id, texto, alineado = false }: { id: string; texto?: string; alineado?: boolean }) {
  return (
    <p id={id} className={`min-h-0 text-xs font-semibold text-rose-700 ${alineado ? 'text-right' : ''} ${texto ? 'mt-0.5' : ''}`}>
      {texto}
    </p>
  );
}
