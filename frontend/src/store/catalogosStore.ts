import { create } from 'zustand';
import client, { mensajeDeError } from '../api/client';
import type { Categoria, Cliente } from '../types';

interface CatalogosState {
  categorias: Categoria[];
  clientes: Cliente[];
  error: string | null;
  /** Una sola peticion por sesion; si fallo, la siguiente llamada reintenta */
  cargar: () => Promise<void>;
}

let enCurso: Promise<void> | null = null;

/** Listas de apoyo que comparten POS, Productos y sus filtros */
export const useCatalogosStore = create<CatalogosState>()((set, get) => ({
  categorias: [],
  clientes: [],
  error: null,

  cargar: () => {
    if (get().categorias.length > 0 && get().clientes.length > 0) return Promise.resolve();
    enCurso ??= Promise.all([client.get<Categoria[]>('/categorias'), client.get<Cliente[]>('/clientes')])
      .then(([categorias, clientes]) => {
        set({ categorias: categorias.data, clientes: clientes.data, error: null });
      })
      .catch((e: unknown) => {
        set({ error: mensajeDeError(e, 'No se pudieron cargar categorías y clientes.') });
      })
      .finally(() => {
        enCurso = null;
      });
    return enCurso;
  },
}));
