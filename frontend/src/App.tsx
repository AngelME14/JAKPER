import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import Header from './components/Header';
import Sidebar, { NAVEGACION, permitido } from './components/Sidebar';
import type { ItemNav } from './components/Sidebar';
import Login from './pages/Login';
import Compras from './pages/Compras';
import Dashboard from './pages/Dashboard';
import Equipo from './pages/Equipo';
import Kardex from './pages/Kardex';
import POS from './pages/POS';
import Productos from './pages/Productos';
import { useAuthStore } from './store/authStore';
import { useCatalogosStore } from './store/catalogosStore';

function Layout() {
  const cargarCatalogos = useCatalogosStore((s) => s.cargar);
  useEffect(() => void cargarCatalogos(), [cargarCatalogos]);

  return (
    <div className="flex h-dvh overflow-hidden bg-crema">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="fondo-ondas relative min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function RutaProtegida() {
  const token = useAuthStore((s) => s.token);
  return token ? <Layout /> : <Navigate to="/login" replace />;
}

function pantalla(item: ItemNav) {
  if (item.to === '/') return <POS />;
  if (item.to === '/dashboard') return <Dashboard />;
  if (item.to === '/compras') return <Compras />;
  if (item.to === '/productos') return <Productos />;
  if (item.to === '/usuarios') return <Equipo />;
  return <Kardex />;
}

function RutaConRol({ item }: { item: ItemNav }) {
  const rol = useAuthStore((s) => s.rol);
  return permitido(item, rol) ? pantalla(item) : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RutaProtegida />}>
          {NAVEGACION.map((item) => (
            <Route key={item.to} path={item.to} element={<RutaConRol item={item} />} />
          ))}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
