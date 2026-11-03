import { useState } from 'react';
import { Bone, Droplets, PawPrint, Pill, ToyBrick } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Sin fotografia, la miniatura la da la categoria */
function iconoDe(categoria: string): LucideIcon {
  const c = categoria.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (/aliment|croquet|comida|snack/.test(c)) return Bone;
  if (/medic|farmac|vitamin|vacun/.test(c)) return Pill;
  if (/higien|shampoo|limpi|belleza/.test(c)) return Droplets;
  if (/accesor|juguet|correa|cama/.test(c)) return ToyBrick;
  return PawPrint;
}

const TAMANOS = {
  sm: { caja: 'size-12 rounded-xl', icono: 22 },
  md: { caja: 'size-20 rounded-2xl', icono: 36 },
  lg: { caja: 'size-40 rounded-3xl', icono: 72 },
} as const;

export default function MiniaturaProducto({
  categoria,
  tamano = 'md',
  apagada = false,
  imagenUrl,
}: {
  categoria: string;
  tamano?: keyof typeof TAMANOS;
  apagada?: boolean;
  /** URL completa de la fotografia del producto, si tiene */
  imagenUrl?: string | null;
}) {
  // Guarda la URL que fallo (no un booleano): si cambia la foto, se vuelve a intentar
  const [urlFallida, setUrlFallida] = useState<string | null>(null);
  const { caja, icono } = TAMANOS[tamano];
  const Icono = iconoDe(categoria);
  if (imagenUrl && imagenUrl !== urlFallida) {
    return (
      <span className={`block shrink-0 overflow-hidden ${caja} ${apagada ? 'opacity-50 grayscale' : ''}`}>
        <img
          src={imagenUrl}
          alt=""
          loading="lazy"
          onError={() => setUrlFallida(imagenUrl)}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-orange-50 to-orange-100 text-orange-500 ${caja} ${
        apagada ? 'opacity-50 grayscale' : ''
      }`}
    >
      <PawPrint
        size={icono * 1.5}
        strokeWidth={1}
        className="absolute -bottom-1/4 -right-1/4 rotate-12 text-orange-200/60"
      />
      <Icono size={icono} strokeWidth={1.6} className="relative" />
    </span>
  );
}
