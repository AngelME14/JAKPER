import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Camera, Pencil, X } from 'lucide-react';
import MiniaturaProducto from './MiniaturaProducto';

// Lo que acepta el servidor (JPG, PNG o WEBP)
const TIPOS_VALIDOS = ['image/jpeg', 'image/png', 'image/webp'];

interface Props {
  categoria: string;
  /** Foto ya guardada (ruta relativa del servidor), si el producto tiene una */
  guardada?: string | null;
  archivo: File | null;
  alCambiar: (archivo: File | null) => void;
}

/** Recuadro de fotografia: clic o arrastrar y soltar; la vista previa reemplaza el icono al instante */
export default function SelectorFoto({ categoria, guardada, archivo, alCambiar }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!archivo) {
      setVista(null);
      return;
    }
    const url = URL.createObjectURL(archivo);
    setVista(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  function recibir(lista: FileList | null) {
    const elegido = lista?.[0];
    if (!elegido) return;
    if (!TIPOS_VALIDOS.includes(elegido.type)) {
      setError('Usa una imagen JPG, PNG o WEBP.');
      return;
    }
    setError(null);
    alCambiar(elegido);
  }

  function alSoltar(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setArrastrando(false);
    recibir(e.dataTransfer.files);
  }

  function quitar() {
    setError(null);
    alCambiar(null);
    if (entrada.current) entrada.current.value = '';
  }

  const imagen = vista ?? guardada ?? null;

  return (
    <div className="flex flex-col items-center gap-2 sm:items-start">
      <div className="relative">
        <button
          type="button"
          onClick={() => entrada.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setArrastrando(true);
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={alSoltar}
          aria-label={imagen ? 'Cambiar fotografía del producto' : 'Agregar fotografía del producto'}
          className="foco group relative block size-40 overflow-hidden rounded-3xl"
        >
          {imagen ? (
            <img src={imagen} alt="" className="size-full object-cover" />
          ) : (
            <MiniaturaProducto categoria={categoria} tamano="lg" />
          )}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 rounded-3xl border-2 border-dashed transition-colors ${
              arrastrando
                ? 'border-orange-500 bg-orange-500/10'
                : imagen
                  ? 'border-transparent'
                  : 'border-stone-300 group-hover:border-orange-500'
            }`}
          />
          {!imagen && (
            <span className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-tinta shadow-sm">
                <Camera size={13} aria-hidden="true" />
                {arrastrando ? 'Suelta la foto' : 'Subir foto'}
              </span>
            </span>
          )}
        </button>

        {imagen && (
          <div className="absolute right-2 top-2 flex gap-1">
            <button
              type="button"
              onClick={() => entrada.current?.click()}
              aria-label="Cambiar fotografía"
              title="Cambiar foto"
              className="foco presion inline-flex size-8 items-center justify-center rounded-full bg-white text-tinta shadow-boton hover:text-orange-700"
            >
              <Pencil size={14} aria-hidden="true" />
            </button>
            {archivo && (
              <button
                type="button"
                onClick={quitar}
                aria-label="Quitar la foto elegida"
                title="Quitar foto"
                className="foco presion inline-flex size-8 items-center justify-center rounded-full bg-white text-tinta shadow-boton hover:text-rose-600"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      <input
        ref={entrada}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          recibir(e.target.files);
          // Permite volver a elegir el mismo archivo despues de quitarlo
          e.target.value = '';
        }}
      />
      {error && (
        <p role="alert" className="max-w-40 text-xs font-semibold text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
