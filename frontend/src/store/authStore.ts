import { create } from 'zustand';
import { TOKEN_KEY } from '../api/client';
import type { Rol } from '../types';

const ROLES: readonly string[] = ['Admin', 'Encargado', 'Cajero'];

interface JwtPayload {
  sub: string;
  exp: number;
  rol: Rol;
}

function leerPayload(token: string): JwtPayload | null {
  try {
    const parte = token.split('.')[1];
    if (!parte) return null;
    const base64 = parte.replace(/-/g, '+').replace(/_/g, '/');
    const payload: unknown = JSON.parse(atob(base64));
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'sub' in payload &&
      'exp' in payload &&
      'rol' in payload &&
      typeof payload.sub === 'string' &&
      typeof payload.exp === 'number' &&
      typeof payload.rol === 'string' &&
      ROLES.includes(payload.rol)
    ) {
      // Un token sin rol (emitido antes de este cambio) se descarta: toca iniciar sesion de nuevo
      return { sub: payload.sub, exp: payload.exp, rol: payload.rol as Rol };
    }
    return null;
  } catch {
    return null;
  }
}

function sesionDesde(token: string | null): { token: string; usuarioId: number; rol: Rol } | null {
  if (!token) return null;
  const payload = leerPayload(token);
  if (!payload || payload.exp * 1000 <= Date.now()) return null;
  const usuarioId = Number(payload.sub);
  return Number.isInteger(usuarioId) ? { token, usuarioId, rol: payload.rol } : null;
}

function sesionGuardada() {
  const sesion = sesionDesde(localStorage.getItem(TOKEN_KEY));
  if (!sesion) localStorage.removeItem(TOKEN_KEY);
  return sesion;
}

interface AuthState {
  token: string | null;
  usuarioId: number | null;
  /** Solo para decidir que mostrar; el servidor valida los permisos reales */
  rol: Rol | null;
  /** false si el token recibido no es un JWT valido o ya expiro */
  login: (token: string) => boolean;
  logout: () => void;
}

const inicial = sesionGuardada();

export const useAuthStore = create<AuthState>((set) => ({
  token: inicial?.token ?? null,
  usuarioId: inicial?.usuarioId ?? null,
  rol: inicial?.rol ?? null,
  login: (token) => {
    const sesion = sesionDesde(token);
    if (!sesion) return false;
    localStorage.setItem(TOKEN_KEY, sesion.token);
    set(sesion);
    return true;
  },
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ token: null, usuarioId: null, rol: null });
  },
}));
