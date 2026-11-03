import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { Eye, EyeOff, Lock, LogIn, PawPrint, User } from 'lucide-react';
import client from '../api/client';
import Logotipo from '../components/Logo';
import mascotas from '../assets/mascotas.webp';
import { useAuthStore } from '../store/authStore';

interface TokenResponse {
  access_token: string;
  token_type: string;
}

interface ErrorApi {
  detail?: string;
}

function mensajeDeError(error: unknown): string {
  if (isAxiosError<ErrorApi>(error)) {
    if (!error.response) return 'Sin conexión con el servidor.';
    if (error.response.status === 401) {
      return error.response.data.detail ?? 'Usuario o contraseña incorrectos.';
    }
    if (error.response.status === 422) return 'Escribe usuario y contraseña.';
  }
  return 'No se pudo iniciar sesión. Intenta de nuevo.';
}

const campoConIcono =
  'flex h-14 items-center gap-3 rounded-2xl border border-orange-200/80 bg-white px-4 text-tinta-suave ' +
  'focus-within:border-orange-500 focus-within:ring-2 focus-within:ring-orange-500/25';

const entrada =
  'h-full min-w-0 flex-1 bg-transparent text-base text-tinta outline-none placeholder:text-tinta-tenue disabled:opacity-60';

/** Ondas del fondo: naranja saturado en las esquinas, beige calido en el centro */
function Ondas() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg viewBox="0 0 1440 900" preserveAspectRatio="none" className="absolute inset-0 size-full">
        <path d="M0 0H300C250 90 190 120 120 150S20 230 0 290Z" fill="#F97316" />
        <path d="M0 0H430C380 80 310 100 250 120S90 190 0 330Z" fill="#FDBA74" fillOpacity=".35" />
        <path d="M0 900V690C120 640 300 700 380 790S520 900 560 900Z" fill="#F97316" />
        <path d="M0 900V760C90 740 190 800 250 900Z" fill="#EA580C" />
        <path d="M1440 900V640C1380 600 1290 650 1240 740S1130 900 1090 900Z" fill="#F97316" />
        <path d="M1440 900V760C1400 740 1350 790 1320 900Z" fill="#EA580C" />
        <path d="M0 520C200 460 360 560 560 520S900 420 1100 470 1340 520 1440 470V900H0Z" fill="#FED7AA" fillOpacity=".28" />
      </svg>
      <PawPrint className="absolute left-[41%] top-[9%] size-16 -rotate-12 text-orange-200/70" strokeWidth={1.2} />
      <PawPrint className="absolute left-[33%] top-[24%] size-12 rotate-12 text-orange-200/70" strokeWidth={1.2} />
      <PawPrint className="absolute bottom-[7%] left-[5%] size-14 -rotate-6 text-white/80" strokeWidth={1.4} />
    </div>
  );
}

export default function Login() {
  const token = useAuthStore((s) => s.token);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (token) return <Navigate to="/" replace />;

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      // OAuth2PasswordRequestForm: application/x-www-form-urlencoded con username/password
      const cuerpo = new URLSearchParams({ username: usuario.trim(), password });
      const { data } = await client.post<TokenResponse>('/auth/login', cuerpo, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (!login(data.access_token)) {
        setError('El servidor devolvió un token inválido.');
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(mensajeDeError(err));
      setPassword('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-gradient-to-br from-crema via-orange-50 to-orange-100/70">
      <Ondas />

      <div className="relative mx-auto grid min-h-dvh max-w-7xl items-center gap-6 px-5 py-8 lg:grid-cols-[1.05fr_1fr] lg:px-10">
        <section aria-label="Lucky Pet MTY" className="flex flex-col items-center lg:self-stretch lg:justify-between">
          <div className="flex flex-col items-center gap-3 lg:mt-6">
            <Logotipo fondo="claro" />
            <p className="flex items-center gap-1.5 text-base font-semibold text-tinta sm:text-lg">
              Tu mascota, en las mejores manos <span aria-hidden="true">🧡</span>
            </p>
          </div>
          <img
            src={mascotas}
            alt="Un perro golden y un gato atigrado, juntos"
            width={900}
            height={937}
            className="asoma mt-4 hidden max-h-[56vh] w-auto object-contain drop-shadow-[0_24px_28px_rgba(194,65,12,0.25)] lg:block"
          />
        </section>

        <form
          onSubmit={enviar}
          noValidate
          className="relative mx-auto w-full max-w-md rounded-3xl border border-white/80 bg-white/90 p-8 shadow-flota backdrop-blur sm:p-10"
        >
          <h1 className="text-4xl font-extrabold tracking-tight text-tinta sm:text-5xl">Iniciar Sesión</h1>
          <p className="mt-2 text-lg text-tinta-suave">Accede a tu cuenta para continuar</p>
          <span aria-hidden="true" className="mt-4 block h-1 w-16 rounded-full bg-orange-500" />

          <label htmlFor="usuario" className="sr-only">
            Usuario
          </label>
          <div className={`${campoConIcono} mt-7`}>
            <User size={22} aria-hidden="true" className="shrink-0" />
            <input
              id="usuario"
              className={entrada}
              placeholder="Usuario"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              disabled={enviando}
            />
          </div>

          <label htmlFor="password" className="sr-only">
            Contraseña
          </label>
          <div className={`${campoConIcono} mt-4`}>
            <Lock size={22} aria-hidden="true" className="shrink-0" />
            <input
              id="password"
              type={verPassword ? 'text' : 'password'}
              className={entrada}
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={enviando}
            />
            <button
              type="button"
              onClick={() => setVerPassword((v) => !v)}
              aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={verPassword}
              className="foco -mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-tinta-suave hover:bg-orange-50 hover:text-orange-700"
            >
              {verPassword ? <EyeOff size={22} aria-hidden="true" /> : <Eye size={22} aria-hidden="true" />}
            </button>
          </div>

          <p role="alert" className="mt-3 min-h-5 text-sm font-semibold text-rose-700">
            {error}
          </p>

          <button
            type="submit"
            disabled={enviando || !usuario || !password}
            className="boton-primario mt-2 h-14 w-full rounded-2xl text-lg"
          >
            <LogIn size={22} aria-hidden="true" />
            {enviando ? 'Entrando…' : 'Iniciar Sesión'}
          </button>

          <p className="mt-6 flex items-center justify-center gap-2 text-center text-sm text-tinta-suave">
            <PawPrint size={16} aria-hidden="true" className="shrink-0 text-orange-500" />
            JAKPER POS · Lucky Pet MTY
          </p>
        </form>
      </div>
    </main>
  );
}
