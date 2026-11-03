import { useCallback, useEffect, useRef, useState } from 'react';
import client, { mensajeDeError } from '../api/client';
import type { ProductoBusqueda } from '../types';

export const RETARDO_BUSQUEDA_MS = 300;
export const MIN_CARACTERES = 2;
const LIMITE_RESULTADOS = 20;

/** Busqueda difusa con debounce; cancela la peticion anterior si sigues escribiendo */
export function useBusquedaProductos() {
  const [consulta, setConsulta] = useState('');
  const [resultados, setResultados] = useState<ProductoBusqueda[]>([]);
  const [resuelta, setResuelta] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activo, setActivo] = useState(0);
  const temporizador = useRef<number | undefined>(undefined);
  const aborto = useRef<AbortController | null>(null);

  const cancelarPendiente = useCallback(() => {
    window.clearTimeout(temporizador.current);
    aborto.current?.abort();
    aborto.current = null;
  }, []);

  useEffect(() => cancelarPendiente, [cancelarPendiente]);

  const limpiar = useCallback(() => {
    cancelarPendiente();
    setConsulta('');
    setResultados([]);
    setResuelta('');
    setCargando(false);
    setError(null);
    setActivo(0);
  }, [cancelarPendiente]);

  /** Busca sin esperar el debounce (Enter, lectores de codigo de barras) */
  const buscarAhora = useCallback(
    async (q: string): Promise<ProductoBusqueda[] | null> => {
      cancelarPendiente();
      const controlador = new AbortController();
      aborto.current = controlador;
      setCargando(true);
      setError(null);
      try {
        const { data } = await client.get<ProductoBusqueda[]>('/productos', {
          params: { q, activo: true, limite: LIMITE_RESULTADOS },
          signal: controlador.signal,
        });
        setResultados(data);
        setResuelta(q);
        setActivo(0);
        return data;
      } catch (e) {
        if (controlador.signal.aborted) return null;
        setError(mensajeDeError(e, 'No se pudo buscar. Intenta de nuevo.'));
        return null;
      } finally {
        if (!controlador.signal.aborted) setCargando(false);
      }
    },
    [cancelarPendiente],
  );

  const escribir = useCallback(
    (valor: string) => {
      setConsulta(valor);
      cancelarPendiente();
      const q = valor.trim();
      if (q.length < MIN_CARACTERES) {
        setCargando(false);
        setResultados([]);
        setResuelta('');
        setError(null);
        return;
      }
      temporizador.current = window.setTimeout(() => void buscarAhora(q), RETARDO_BUSQUEDA_MS);
    },
    [buscarAhora, cancelarPendiente],
  );

  return { consulta, resultados, resuelta, cargando, error, activo, setActivo, escribir, buscarAhora, limpiar };
}
