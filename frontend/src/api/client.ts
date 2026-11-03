import axios, { AxiosError, isAxiosError } from 'axios';

export const TOKEN_KEY = 'token';

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ detail?: unknown }>) => {
    // En /auth/login un 401 es credencial invalida: dejar que el formulario lo muestre
    const esLogin = error.config?.url?.includes('/auth/login') ?? false;
    if (error.response?.status === 401 && !esLogin) {
      localStorage.removeItem(TOKEN_KEY);
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    // 400 y 409 traen en detail el texto escrito para el cajero (triggers, stock, duplicados)
    const estado = error.response?.status;
    const detalle = error.response?.data?.detail;
    if ((estado === 400 || estado === 409) && typeof detalle === 'string') {
      error.message = detalle;
    }
    return Promise.reject(error);
  },
);

/** URL absoluta de un archivo servido por FastAPI en /static (ej. `imagen_url` de un producto) */
export function urlImagen(ruta: string | null | undefined): string | null {
  return ruta ? `${client.defaults.baseURL}/${ruta.replace(/^\/+/, '')}` : null;
}

/** Quita el nombre de la restriccion de BD que el backend agrega al final: "... (uq_algo)" */
const sinRestriccion = (detalle: string) => detalle.replace(/ \([a-z0-9_]+\)$/, '');

/** Texto para el banner de error: el detalle del backend si lo hay, o `porDefecto` */
export function mensajeDeError(error: unknown, porDefecto: string): string {
  if (!isAxiosError<{ detail?: unknown }>(error)) return porDefecto;
  if (!error.response) return 'Sin conexión con el servidor.';
  const detalle = error.response.data?.detail;
  return typeof detalle === 'string' ? sinRestriccion(detalle) : porDefecto;
}

export default client;
