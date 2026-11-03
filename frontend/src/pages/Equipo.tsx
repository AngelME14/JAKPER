import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { KeyRound, Pencil, Plus } from 'lucide-react';
import client, { mensajeDeError } from '../api/client';
import Banner from '../components/Banner';
import PasswordModal from '../components/PasswordModal';
import Toast from '../components/Toast';
import UsuarioModal from '../components/UsuarioModal';
import { useAuthStore } from '../store/authStore';
import type { Colaborador, Rol } from '../types';

const ESTILO_ROL: Record<Rol, string> = {
  Admin: 'bg-purple-100 text-purple-800 ring-purple-300',
  Encargado: 'bg-sky-100 text-sky-800 ring-sky-300',
  Cajero: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
};

/** undefined = modal cerrado; null = colaborador nuevo */
type Edicion = Colaborador | null | undefined;

interface Aviso {
  tipo: 'error' | 'exito';
  texto: ReactNode;
}

function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  return palabras
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

const porId = (a: Colaborador, b: Colaborador) => a.id - b.id;

/** Gestion del equipo: alta, edicion, estado y contraseña. Solo Admin */
export default function Equipo() {
  const rol = useAuthStore((s) => s.rol);
  const miId = useAuthStore((s) => s.usuarioId);

  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Edicion>(undefined);
  const [clave, setClave] = useState<Colaborador | null>(null);
  const [cambiando, setCambiando] = useState<ReadonlySet<number>>(new Set());
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const cerrarAviso = useCallback(() => setAviso(null), []);
  const disparador = useRef<HTMLElement | null>(null);

  const esAdmin = rol === 'Admin';

  useEffect(() => {
    if (!esAdmin) return;
    const controlador = new AbortController();
    client
      .get<Colaborador[]>('/usuarios', { signal: controlador.signal })
      .then(({ data }) => setColaboradores(data))
      .catch((e: unknown) => {
        if (!controlador.signal.aborted) setError(mensajeDeError(e, 'No se pudo cargar el equipo.'));
      })
      .finally(() => {
        if (!controlador.signal.aborted) setCargando(false);
      });
    return () => controlador.abort();
  }, [esAdmin]);

  // El servidor valida el rol en cada peticion; esto solo evita mostrar una pantalla inutil
  if (!esAdmin) return <Navigate to="/" replace />;

  function abrir(accion: () => void) {
    disparador.current = document.activeElement as HTMLElement | null;
    accion();
  }

  function cerrarModales() {
    setEdicion(undefined);
    setClave(null);
    disparador.current?.focus();
  }

  function alGuardar(guardado: Colaborador) {
    const eraNuevo = edicion === null;
    setColaboradores((previo) => [...previo.filter((c) => c.id !== guardado.id), guardado].sort(porId));
    setAviso({
      tipo: 'exito',
      texto: eraNuevo ? `${guardado.nombre} ya forma parte del equipo.` : `Datos de ${guardado.nombre} actualizados.`,
    });
    cerrarModales();
  }

  function alCambiarClave(c: Colaborador) {
    setAviso({ tipo: 'exito', texto: `Contraseña de ${c.nombre} actualizada.` });
    cerrarModales();
  }

  async function alternar(c: Colaborador) {
    setCambiando((previo) => new Set(previo).add(c.id));
    try {
      const { data } = await client.patch<Colaborador>(`/usuarios/${c.id}/toggle-activo`);
      setColaboradores((previo) => previo.map((x) => (x.id === data.id ? data : x)));
      setAviso({ tipo: 'exito', texto: `${data.nombre} ${data.activo ? 'activado' : 'desactivado'}.` });
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensajeDeError(e, 'No se pudo cambiar el estado.') });
    } finally {
      setCambiando((previo) => {
        const siguiente = new Set(previo);
        siguiente.delete(c.id);
        return siguiente;
      });
    }
  }

  const activos = colaboradores.filter((c) => c.activo).length;

  return (
    <div className="flex min-h-full flex-col gap-4 p-4 pb-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-tinta">Equipo de Trabajo</h1>
          <p className="mt-0.5 text-base text-tinta-suave">
            Quién usa el sistema, con qué rol y si puede entrar hoy
          </p>
        </div>
        <button
          type="button"
          onClick={() => abrir(() => setEdicion(null))}
          className="boton-primario h-12 rounded-2xl px-5"
        >
          <Plus size={18} strokeWidth={2.6} aria-hidden="true" />
          Nuevo Colaborador
        </button>
      </header>

      {error && <Banner tipo="error">{error}</Banner>}

      <div className="tarjeta min-h-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tabla w-full min-w-[44rem] text-sm">
            <thead className="text-left text-xs font-bold uppercase tracking-wider text-stone-800">
              <tr>
                <th scope="col" className="celda-titulo">Colaborador</th>
                <th scope="col" className="celda-titulo">Usuario</th>
                <th scope="col" className="celda-titulo">Rol</th>
                <th scope="col" className="celda-titulo">Estado</th>
                <th scope="col" className="celda-titulo w-28 text-right">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {colaboradores.map((c) => {
                const esYo = c.id === miId;
                return (
                  <tr key={c.id} className={`hover:bg-orange-50/40 ${c.activo ? '' : 'text-tinta-tenue'}`}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                            c.activo ? 'bg-orange-100 text-orange-700' : 'bg-stone-100 text-stone-500'
                          }`}
                        >
                          {iniciales(c.nombre)}
                        </span>
                        <span className={`font-extrabold ${c.activo ? 'text-tinta' : ''}`}>
                          {c.nombre}
                          {esYo && <span className="ml-2 text-xs font-semibold text-tinta-suave">(tú)</span>}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex rounded-md bg-stone-100 px-2 py-0.5 font-mono text-xs font-semibold text-stone-700">
                        @{c.usuario}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${ESTILO_ROL[c.rol]} ${
                          c.activo ? '' : 'opacity-60'
                        }`}
                      >
                        {c.rol}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Interruptor
                          activo={c.activo}
                          ocupado={cambiando.has(c.id)}
                          deshabilitado={esYo}
                          etiqueta={`${c.activo ? 'Desactivar' : 'Activar'} a ${c.nombre}`}
                          titulo={esYo ? 'No puedes desactivar tu propia cuenta' : undefined}
                          alCambiar={() => void alternar(c)}
                        />
                        <span className="text-xs font-bold">{c.activo ? 'Activo' : 'Inactivo'}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-0 text-right">
                      <button
                        type="button"
                        onClick={() => abrir(() => setEdicion(c))}
                        aria-label={`Editar a ${c.nombre}`}
                        title="Editar datos"
                        className="foco presion inline-flex size-9 items-center justify-center rounded-xl text-tinta-suave hover:bg-orange-100 hover:text-orange-700"
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => abrir(() => setClave(c))}
                        aria-label={`Cambiar contraseña de ${c.nombre}`}
                        title="Cambiar contraseña"
                        className="foco presion inline-flex size-9 items-center justify-center rounded-xl text-tinta-suave hover:bg-orange-100 hover:text-orange-700"
                      >
                        <KeyRound size={16} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {cargando && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-sm font-semibold text-tinta-suave">
                    Cargando equipo…
                  </td>
                </tr>
              )}
              {!cargando && !error && colaboradores.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-sm font-semibold text-tinta-suave">
                    Aún no hay colaboradores. Agrega el primero con “Nuevo Colaborador”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="border-t border-borde bg-crema px-4 py-3 text-sm font-semibold text-tinta-suave">
          <span className="font-mono">{activos}</span> {activos === 1 ? 'activo' : 'activos'} de{' '}
          <span className="font-mono">{colaboradores.length}</span>
        </footer>
      </div>

      {aviso && (
        <Toast tipo={aviso.tipo} alCerrar={cerrarAviso}>
          {aviso.texto}
        </Toast>
      )}
      {edicion !== undefined && <UsuarioModal colaborador={edicion} alCerrar={cerrarModales} alGuardar={alGuardar} />}
      {clave && <PasswordModal colaborador={clave} alCerrar={cerrarModales} alCambiar={alCambiarClave} />}
    </div>
  );
}

interface InterruptorProps {
  activo: boolean;
  ocupado: boolean;
  deshabilitado: boolean;
  etiqueta: string;
  titulo?: string;
  alCambiar: () => void;
}

/** Switch de estado: el cambio se ve cuando el servidor responde, no antes */
function Interruptor({ activo, ocupado, deshabilitado, etiqueta, titulo, alCambiar }: InterruptorProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      title={titulo}
      disabled={deshabilitado || ocupado}
      onClick={alCambiar}
      className={`foco relative h-6 w-11 shrink-0 rounded-full transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${
        activo ? 'bg-emerald-600' : 'bg-stone-300'
      } ${ocupado ? 'animate-pulse motion-reduce:animate-none' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${
          activo ? 'translate-x-5' : ''
        }`}
      />
    </button>
  );
}
