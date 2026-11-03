import { useAuthStore } from '../store/authStore';

const INICIALES = { Admin: 'AD', Encargado: 'EN', Cajero: 'CA' } as const;

/** Sucursal y usuario en curso, a la derecha; cada pantalla trae su propio buscador */
export default function Header() {
  const rol = useAuthStore((s) => s.rol);

  return (
    <header className="flex h-[68px] shrink-0 items-center justify-end gap-4 px-4 sm:px-6">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-2 text-sm font-bold text-tinta">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15" />
          Tienda Principal
        </span>
        <span
          title={rol ?? undefined}
          className="flex size-11 items-center justify-center rounded-full bg-orange-500 text-sm font-extrabold text-white shadow-boton"
        >
          <span aria-hidden="true">{rol ? INICIALES[rol] : '?'}</span>
          <span className="sr-only">Sesión de {rol}</span>
        </span>
      </div>
    </header>
  );
}
