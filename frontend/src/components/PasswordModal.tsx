import { useState } from 'react';
import type { FormEvent } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import client, { mensajeDeError } from '../api/client';
import type { Colaborador } from '../types';
import Banner from './Banner';
import Campo from './Campo';
import Dialogo from './Dialogo';
import { errorDePassword } from './UsuarioModal';

interface Props {
  colaborador: Colaborador;
  alCerrar: () => void;
  alCambiar: (colaborador: Colaborador) => void;
}

/** El Admin fija una contraseña nueva; la anterior deja de servir de inmediato */
export default function PasswordModal({ colaborador, alCerrar, alCambiar }: Props) {
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [ver, setVer] = useState(false);
  const [errores, setErrores] = useState<{ password?: string; confirmacion?: string }>({});
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nuevos: typeof errores = {
      password: errorDePassword(password),
      confirmacion: confirmacion !== password ? 'Las contraseñas no coinciden.' : undefined,
    };
    setErrores(nuevos);
    if (nuevos.password || nuevos.confirmacion) return;

    setEnviando(true);
    setErrorEnvio(null);
    try {
      await client.patch(`/usuarios/${colaborador.id}/password`, { password });
      alCambiar(colaborador);
    } catch (error) {
      setErrorEnvio(mensajeDeError(error, 'No se pudo cambiar la contraseña. Intenta de nuevo.'));
      setEnviando(false);
    }
  }

  return (
    <Dialogo titulo="Cambiar contraseña" ancho="max-w-md" alCerrar={alCerrar}>
      {errorEnvio && <Banner tipo="error">{errorEnvio}</Banner>}
      <form onSubmit={(e) => void guardar(e)} noValidate>
        <div className="space-y-4 px-6 py-5">
          <p className="text-sm text-tinta-suave">
            Nueva contraseña para <span className="font-extrabold text-tinta">{colaborador.nombre}</span>{' '}
            <span className="font-mono">@{colaborador.usuario}</span>.
          </p>
          <Campo id="pw-nueva" etiqueta="Contraseña nueva" error={errores.password} ayuda="Mínimo 8 caracteres.">
            <div className="relative">
              <input
                id="pw-nueva"
                data-autofoco=""
                type={ver ? 'text' : 'password'}
                maxLength={72}
                value={password}
                autoComplete="new-password"
                aria-invalid={Boolean(errores.password)}
                onChange={(e) => setPassword(e.target.value)}
                className="campo w-full pr-11 font-mono"
              />
              <button
                type="button"
                onClick={() => setVer((v) => !v)}
                aria-label={ver ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
                aria-pressed={ver}
                className="foco absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-tinta-suave hover:bg-orange-50 hover:text-orange-700"
              >
                {ver ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
          </Campo>
          <Campo id="pw-confirmacion" etiqueta="Repite la contraseña" error={errores.confirmacion}>
            <input
              id="pw-confirmacion"
              type={ver ? 'text' : 'password'}
              maxLength={72}
              value={confirmacion}
              autoComplete="new-password"
              aria-invalid={Boolean(errores.confirmacion)}
              onChange={(e) => setConfirmacion(e.target.value)}
              className="campo w-full font-mono"
            />
          </Campo>
        </div>
        <footer className="flex justify-end gap-3 border-t border-borde bg-crema px-6 py-4">
          <button type="button" onClick={alCerrar} disabled={enviando} className="boton h-11 px-6">
            Cancelar
          </button>
          <button type="submit" disabled={enviando} className="boton-primario h-11 px-6">
            {enviando && <Loader2 size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            {enviando ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </footer>
      </form>
    </Dialogo>
  );
}
