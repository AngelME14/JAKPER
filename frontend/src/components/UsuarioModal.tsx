import { useState } from 'react';
import type { FormEvent } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import client, { mensajeDeError } from '../api/client';
import type { Colaborador, Rol } from '../types';
import Banner from './Banner';
import Campo from './Campo';
import Dialogo from './Dialogo';

export const ROLES: Rol[] = ['Admin', 'Encargado', 'Cajero'];

interface Props {
  /** null = colaborador nuevo */
  colaborador: Colaborador | null;
  alCerrar: () => void;
  alGuardar: (colaborador: Colaborador) => void;
}

interface Errores {
  nombre?: string;
  usuario?: string;
  password?: string;
}

const FORMATO_USUARIO = /^[A-Za-z0-9._-]{3,50}$/;

/** Mismas reglas que el servidor: 8 caracteres como minimo y 72 bytes como maximo (limite de bcrypt) */
export function errorDePassword(valor: string): string | undefined {
  if (valor.length < 8) return 'Usa al menos 8 caracteres.';
  if (new TextEncoder().encode(valor).length > 72) return 'Usa 72 caracteres como máximo.';
  return undefined;
}

export default function UsuarioModal({ colaborador, alCerrar, alGuardar }: Props) {
  const [nombre, setNombre] = useState(colaborador?.nombre ?? '');
  const [usuario, setUsuario] = useState(colaborador?.usuario ?? '');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [rol, setRol] = useState<Rol>(colaborador?.rol ?? 'Cajero');
  const [errores, setErrores] = useState<Errores>({});
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nuevos: Errores = {};
    if (!nombre.trim()) nuevos.nombre = 'Escribe el nombre completo.';
    if (!FORMATO_USUARIO.test(usuario.trim())) {
      nuevos.usuario = 'Usa de 3 a 50 letras, números, punto, guion o guion bajo, sin espacios.';
    }
    if (!colaborador) nuevos.password = errorDePassword(password);
    setErrores(nuevos);
    if (nuevos.nombre || nuevos.usuario || nuevos.password) return;

    setEnviando(true);
    setErrorEnvio(null);
    try {
      const cuerpo = { nombre: nombre.trim(), usuario: usuario.trim(), rol };
      const { data } = colaborador
        ? await client.patch<Colaborador>(`/usuarios/${colaborador.id}`, cuerpo)
        : await client.post<Colaborador>('/usuarios', { ...cuerpo, password });
      alGuardar(data);
    } catch (error) {
      setErrorEnvio(mensajeDeError(error, 'No se pudo guardar el colaborador. Revisa los datos.'));
      setEnviando(false);
    }
  }

  return (
    <Dialogo titulo={colaborador ? 'Editar colaborador' : 'Nuevo colaborador'} ancho="max-w-lg" alCerrar={alCerrar}>
      {errorEnvio && <Banner tipo="error">{errorEnvio}</Banner>}
      <form onSubmit={(e) => void guardar(e)} noValidate>
        <div className="space-y-4 px-6 py-5">
          <Campo id="u-nombre" etiqueta="Nombre completo" error={errores.nombre}>
            <input
              id="u-nombre"
              data-autofoco=""
              maxLength={120}
              value={nombre}
              autoComplete="off"
              aria-invalid={Boolean(errores.nombre)}
              onChange={(e) => setNombre(e.target.value)}
              className="campo w-full font-semibold"
            />
          </Campo>

          <Campo
            id="u-usuario"
            etiqueta="Nombre de usuario"
            error={errores.usuario}
            ayuda="Con este nombre inicia sesión."
          >
            <input
              id="u-usuario"
              maxLength={50}
              value={usuario}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={Boolean(errores.usuario)}
              onChange={(e) => setUsuario(e.target.value)}
              className="campo w-full font-mono"
            />
          </Campo>

          {!colaborador && (
            <Campo id="u-password" etiqueta="Contraseña inicial" error={errores.password} ayuda="Mínimo 8 caracteres.">
              <div className="relative">
                <input
                  id="u-password"
                  type={verPassword ? 'text' : 'password'}
                  maxLength={72}
                  value={password}
                  autoComplete="new-password"
                  aria-invalid={Boolean(errores.password)}
                  onChange={(e) => setPassword(e.target.value)}
                  className="campo w-full pr-11 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setVerPassword((v) => !v)}
                  aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={verPassword}
                  className="foco absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-tinta-suave hover:bg-orange-50 hover:text-orange-700"
                >
                  {verPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
            </Campo>
          )}

          <Campo id="u-rol" etiqueta="Rol">
            <select
              id="u-rol"
              value={rol}
              onChange={(e) => setRol(e.target.value as Rol)}
              className="campo w-full font-semibold"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        <footer className="flex justify-end gap-3 border-t border-borde bg-crema px-6 py-4">
          <button type="button" onClick={alCerrar} disabled={enviando} className="boton h-11 px-6">
            Cancelar
          </button>
          <button type="submit" disabled={enviando} className="boton-primario h-11 px-6">
            {enviando && <Loader2 size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            {enviando ? 'Guardando…' : colaborador ? 'Guardar cambios' : 'Crear Usuario'}
          </button>
        </footer>
      </form>
    </Dialogo>
  );
}
