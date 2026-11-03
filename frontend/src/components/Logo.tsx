interface MarcaProps {
  className?: string;
  /** Color de las orejas del perro y las manchas del gato */
  acento?: string;
}

/** Perro y gato asomados juntos: la marca de Lucky Pet */
export function MarcaMascotas({ className, acento = '#EA580C' }: MarcaProps) {
  const trazo = { stroke: '#3A1F0F', strokeWidth: 3.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <svg viewBox="0 0 132 96" role="img" aria-label="Lucky Pet" className={className}>
      {/* Perro: orejas caidas detras de la cabeza */}
      <path d="M22 26C8 26 6 56 14 68c6 6 14 2 16-8l2-24C32 30 28 26 22 26Z" fill={acento} {...trazo} />
      <path d="M60 24c14-4 22 22 14 40-5 8-14 6-16-4l-1-26C57 29 58 25 60 24Z" fill={acento} {...trazo} />
      <path d="M41 10c-14 0-22 12-22 28s8 34 22 34 22-18 22-34S55 10 41 10Z" fill="#fff" {...trazo} />
      <circle cx="31" cy="38" r="3.2" fill="#3A1F0F" />
      <circle cx="51" cy="38" r="3.2" fill="#3A1F0F" />
      <ellipse cx="41" cy="48" rx="6.5" ry="4.6" fill="#3A1F0F" />
      <path d="M41 52v5m-9 2c4 6 14 6 18 0" fill="none" {...trazo} />
      <path d="M36 61c1 7 9 7 10 0Z" fill="#F9739B" stroke="#3A1F0F" strokeWidth="2.4" strokeLinejoin="round" />

      {/* Gato: orejas puntiagudas y rayas de acento */}
      <path d="M76 56 78 30l16 12Z" fill="#fff" {...trazo} />
      <path d="M118 56l-2-26-16 12Z" fill="#fff" {...trazo} />
      <path d="M97 38c-15 0-24 9-24 20s9 21 24 21 24-10 24-21-9-20-24-20Z" fill="#fff" {...trazo} />
      <path d="M92 40l5 8 5-8Z" fill={acento} stroke="#3A1F0F" strokeWidth="2.4" strokeLinejoin="round" />
      <circle cx="87" cy="58" r="2.8" fill="#3A1F0F" />
      <circle cx="107" cy="58" r="2.8" fill="#3A1F0F" />
      <path d="M94 65h6l-3 3.6Z" fill="#3A1F0F" stroke="#3A1F0F" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M97 69c-1 4-6 5-8 2m8-2c1 4 6 5 8 2" fill="none" {...trazo} strokeWidth="2.6" />
      <path d="M72 64l9 2m-9 6 9-1m43-7-9 2m9 4-9-1" fill="none" {...trazo} strokeWidth="2.2" />
    </svg>
  );
}

interface LogotipoProps {
  /** claro = texto oscuro sobre crema; oscuro = texto blanco sobre naranja */
  fondo: 'claro' | 'oscuro';
  compacto?: boolean;
}

/** Marca + "Lucky Pet — MTY —" apilados, como en el logotipo original */
export default function Logotipo({ fondo, compacto = false }: LogotipoProps) {
  const oscuro = fondo === 'oscuro';
  return (
    <div className="flex flex-col items-center text-center leading-none">
      <MarcaMascotas
        className={compacto ? 'w-14' : 'w-28 sm:w-36'}
        acento={oscuro ? '#FDBA74' : '#EA580C'}
      />
      <span
        className={`mt-1 font-extrabold tracking-tight ${compacto ? 'text-base' : 'text-4xl sm:text-5xl'} ${
          oscuro ? 'text-white' : 'text-tinta'
        }`}
      >
        Lucky Pet
      </span>
      <span
        className={`mt-0.5 flex items-center gap-1.5 font-extrabold ${compacto ? 'text-[11px]' : 'text-2xl sm:text-3xl'} ${
          oscuro ? 'text-orange-100' : 'text-orange-600'
        }`}
      >
        <span aria-hidden="true" className={`h-0.5 rounded-full bg-current ${compacto ? 'w-3' : 'w-6 sm:w-9'}`} />
        MTY
        <span aria-hidden="true" className={`h-0.5 rounded-full bg-current ${compacto ? 'w-3' : 'w-6 sm:w-9'}`} />
      </span>
    </div>
  );
}
