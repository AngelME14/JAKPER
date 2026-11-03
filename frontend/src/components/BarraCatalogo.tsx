import type { KeyboardEvent, Ref } from 'react';
import { Loader2, Search } from 'lucide-react';
import { useCatalogosStore } from '../store/catalogosStore';

interface BuscadorProps {
  ref?: Ref<HTMLInputElement>;
  valor: string;
  alCambiar: (valor: string) => void;
  alTeclear: (e: KeyboardEvent<HTMLInputElement>) => void;
  cargando: boolean;
  etiqueta: string;
  placeholder: string;
  listaId?: string;
  filaActivaId?: string;
}

export function Buscador({
  ref,
  valor,
  alCambiar,
  alTeclear,
  cargando,
  etiqueta,
  placeholder,
  listaId,
  filaActivaId,
}: BuscadorProps) {
  return (
    <div className="relative min-w-52 flex-1">
      <Search
        size={18}
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-tinta-suave"
      />
      <input
        ref={ref}
        type="search"
        role={listaId ? 'combobox' : undefined}
        aria-expanded={listaId ? true : undefined}
        aria-controls={listaId}
        aria-activedescendant={filaActivaId}
        aria-label={etiqueta}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        onKeyDown={alTeclear}
        placeholder={placeholder}
        autoComplete="off"
        className="campo h-12 w-full pl-11 pr-10 [&::-webkit-search-cancel-button]:hidden"
      />
      {cargando && (
        <Loader2
          size={16}
          aria-hidden="true"
          className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-orange-600 motion-reduce:animate-none"
        />
      )}
    </div>
  );
}

export function SelectorCategoria({
  valor,
  alCambiar,
}: {
  valor: number | null;
  alCambiar: (categoriaId: number | null) => void;
}) {
  const categorias = useCatalogosStore((s) => s.categorias);
  return (
    <select
      aria-label="Filtrar por categoría"
      value={valor ?? ''}
      onChange={(e) => alCambiar(e.target.value ? Number(e.target.value) : null)}
      className="campo h-12 pr-8 font-semibold"
    >
      <option value="">Todas las categorías</option>
      {categorias.map((c) => (
        <option key={c.id} value={c.id}>
          {c.nombre}
        </option>
      ))}
    </select>
  );
}

/** Categorias como pastillas: un toque filtra el mostrador */
export function PastillasCategoria({
  valor,
  alCambiar,
}: {
  valor: number | null;
  alCambiar: (categoriaId: number | null) => void;
}) {
  const categorias = useCatalogosStore((s) => s.categorias);
  const base =
    'foco presion shrink-0 rounded-full border px-4 py-1.5 text-sm font-bold whitespace-nowrap ';
  const activa = 'border-orange-600 bg-orange-600 text-white shadow-boton';
  const inactiva = 'border-orange-200 bg-white text-tinta hover:bg-orange-50';
  return (
    <div role="group" aria-label="Filtrar por categoría" className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      <button
        type="button"
        aria-pressed={valor === null}
        onClick={() => alCambiar(null)}
        className={base + (valor === null ? activa : inactiva)}
      >
        Todas
      </button>
      {categorias.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={valor === c.id}
          onClick={() => alCambiar(valor === c.id ? null : c.id)}
          className={base + (valor === c.id ? activa : inactiva)}
        >
          {c.nombre}
        </button>
      ))}
    </div>
  );
}
