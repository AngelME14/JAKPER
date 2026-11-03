import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ArrowLeftRight,
  LayoutDashboard,
  LogOut,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  PawPrint,
  ShoppingCart,
  Truck,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import type { Rol } from '../types';
import Logotipo, { MarcaMascotas } from './Logo';

export interface ItemNav {
  to: string;
  etiqueta: string;
  icono: LucideIcon;
  /** Sin definir = todos los roles. El servidor valida los permisos igualmente */
  roles?: Rol[];
}

export const NAVEGACION: ItemNav[] = [
  { to: '/dashboard', etiqueta: 'Dashboard', icono: LayoutDashboard, roles: ['Admin', 'Encargado'] },
  { to: '/', etiqueta: 'Punto de Venta', icono: ShoppingCart },
  { to: '/productos', etiqueta: 'Inventario', icono: Package },
  { to: '/compras', etiqueta: 'Compras', icono: Truck },
  { to: '/kardex', etiqueta: 'Kardex y Mermas', icono: ArrowLeftRight },
  { to: '/usuarios', etiqueta: 'Equipo', icono: Users, roles: ['Admin'] },
];

export const permitido = (item: ItemNav, rol: Rol | null) =>
  !item.roles || (rol !== null && item.roles.includes(rol));

const CLAVE_DOCK = 'luckypet-menu-abierto';

const boton =
  'presion group relative flex h-11 w-full items-center gap-3 rounded-2xl px-3.5 text-sm font-bold text-white/90 ' +
  'hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

function leerDock(): boolean {
  try {
    const guardado = localStorage.getItem(CLAVE_DOCK);
    if (guardado !== null) return guardado === '1';
  } catch {
    // Sin almacenamiento se decide por el ancho de la pantalla
  }
  return window.innerWidth >= 1024;
}

/** Con el menu cerrado el nombre aparece como tooltip lateral; abierto, va junto al icono */
function Rotulo({ abierto, children }: { abierto: boolean; children: string }) {
  if (abierto) return <span className="truncate">{children}</span>;
  return (
    <span
      role="tooltip"
      className="tooltip-dock pointer-events-none absolute left-full z-30 ml-3 whitespace-nowrap rounded-xl bg-tinta px-2.5 py-1.5 text-xs font-bold text-white shadow-flota"
    >
      {children}
    </span>
  );
}

export default function Sidebar() {
  const logout = useAuthStore((s) => s.logout);
  const rol = useAuthStore((s) => s.rol);
  const [abierto, setAbierto] = useState(leerDock);

  function alternar() {
    setAbierto((actual) => {
      try {
        localStorage.setItem(CLAVE_DOCK, actual ? '0' : '1');
      } catch {
        // Sin almacenamiento el menu solo olvida su estado al recargar
      }
      return !actual;
    });
  }

  const IconoMenu = abierto ? PanelLeftClose : PanelLeftOpen;

  return (
    <nav
      aria-label="Principal"
      className={`relative z-20 flex h-dvh shrink-0 flex-col overflow-hidden bg-orange-600 ${abierto ? 'w-60' : 'w-[84px]'}`}
    >
      {/* Ondas y huellas de fondo: solo decoracion */}
      <svg
        aria-hidden="true"
        viewBox="0 0 240 420"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 w-full"
      >
        <path d="M0 140C60 90 130 190 240 120V420H0Z" fill="#F97316" fillOpacity=".55" />
        <path d="M0 260C80 210 150 300 240 240V420H0Z" fill="#C2410C" fillOpacity=".4" />
      </svg>
      <PawPrint
        aria-hidden="true"
        strokeWidth={1.4}
        className="pointer-events-none absolute -right-3 bottom-24 size-20 rotate-12 text-white/10"
      />

      <div className="relative flex shrink-0 justify-center px-3 pb-3 pt-5">
        {abierto ? <Logotipo fondo="oscuro" compacto /> : <MarcaMascotas className="w-12" acento="#FDBA74" />}
      </div>

      <ul className="relative flex-1 space-y-1 px-3 py-3">
        {NAVEGACION.filter((item) => permitido(item, rol)).map(({ to, etiqueta, icono: Icono }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              aria-label={etiqueta}
              className={({ isActive }) =>
                `${boton} ${isActive ? 'bg-white !text-orange-700 shadow-sm hover:bg-white' : ''}`
              }
            >
              <Icono size={20} strokeWidth={1.9} aria-hidden="true" className="shrink-0" />
              <Rotulo abierto={abierto}>{etiqueta}</Rotulo>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="relative space-y-1 px-3 pb-4">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={abierto}
          aria-label={abierto ? 'Contraer menú' : 'Expandir menú'}
          className={boton}
        >
          <IconoMenu size={20} strokeWidth={1.9} aria-hidden="true" className="shrink-0" />
          <Rotulo abierto={abierto}>{abierto ? 'Contraer menú' : 'Expandir menú'}</Rotulo>
        </button>
        <button type="button" aria-label="Cerrar sesión" onClick={logout} className={boton}>
          <LogOut size={20} strokeWidth={1.9} aria-hidden="true" className="shrink-0" />
          <Rotulo abierto={abierto}>Cerrar Sesión</Rotulo>
        </button>
      </div>
    </nav>
  );
}
