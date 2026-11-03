import type { ReactNode } from 'react';

interface Props {
  id: string;
  etiqueta: string;
  error?: string;
  ayuda?: string;
  children: ReactNode;
}

/** Etiqueta, control y mensaje de error de un campo de formulario */
export default function Campo({ id, etiqueta, error, ayuda, children }: Props) {
  return (
    <div>
      <label htmlFor={id} className="etiqueta mb-1.5 block">
        {etiqueta}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} className="mt-1 text-sm font-semibold text-rose-700">
          {error}
        </p>
      ) : (
        ayuda && (
          <p id={`${id}-msg`} className="mt-1 text-xs text-tinta-suave">
            {ayuda}
          </p>
        )
      )}
    </div>
  );
}
