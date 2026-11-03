import { useCallback, useEffect, useRef, useState } from 'react';
import client, { mensajeDeError } from '../api/client';
import type { ProductoCatalogo } from '../types';

const RETARDO_MS = 300;
const MIN_CARACTERES = 2;

export interface FiltrosCatalogo {
  q: string;
  categoriaId: number | null;
  /** null = activos e inactivos */
  activo: boolean | null;
}

/**
 * GET /productos con debounce; cancela la peticion anterior al cambiar los filtros.
 * Sus funciones son estables, asi las filas memorizadas no se repintan al escribir.
 */
export function useCatalogo({ q, categoriaId, activo }: FiltrosCatalogo, limite = 100) {
  const [filas, setFilas] = useState<ProductoCatalogo[]>([]);
  const [activa, setActiva] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [resuelta, setResuelta] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aborto = useRef<AbortController | null>(null);
  const temporizador = useRef<number | undefined>(undefined);
  const filtros = useRef<FiltrosCatalogo>({ q, categoriaId, activo });

  const cancelar = useCallback(() => {
    window.clearTimeout(temporizador.current);
    aborto.current?.abort();
    aborto.current = null;
  }, []);

  /** Consulta sin esperar el debounce; `desde` > 0 agrega al final en lugar de reemplazar */
  const consultar = useCallback(
    async (texto: string, desde = 0): Promise<ProductoCatalogo[] | null> => {
      cancelar();
      const controlador = new AbortController();
      aborto.current = controlador;
      const limpio = texto.trim();
      setCargando(true);
      setError(null);
      try {
        const { data } = await client.get<ProductoCatalogo[]>('/productos', {
          params: {
            q: limpio.length >= MIN_CARACTERES ? limpio : undefined,
            categoria_id: filtros.current.categoriaId ?? undefined,
            activo: filtros.current.activo ?? undefined,
            limite,
            desplazamiento: desde,
          },
          signal: controlador.signal,
        });
        if (desde > 0) {
          setFilas((previas) => [...previas, ...data]);
        } else {
          setFilas(data);
          setActiva(0);
        }
        setHayMas(data.length === limite);
        setResuelta(limpio);
        return data;
      } catch (e) {
        if (controlador.signal.aborted) return null;
        setError(mensajeDeError(e, 'No se pudo cargar el catálogo. Intenta de nuevo.'));
        return null;
      } finally {
        if (!controlador.signal.aborted) setCargando(false);
      }
    },
    [cancelar, limite],
  );

  /** Vuelve a pedir la vista actual, por ejemplo tras guardar o cobrar */
  const recargar = useCallback(() => consultar(filtros.current.q), [consultar]);

  useEffect(() => {
    filtros.current = { q, categoriaId, activo };
    temporizador.current = window.setTimeout(() => void consultar(q), RETARDO_MS);
    return cancelar;
  }, [activo, cancelar, categoriaId, consultar, q]);

  return { filas, activa, setActiva, hayMas, resuelta, cargando, error, consultar, recargar };
}
