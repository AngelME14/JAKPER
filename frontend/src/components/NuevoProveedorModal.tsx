import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import client, { mensajeDeError } from '../api/client';
import type { Proveedor } from '../types';
import Banner from './Banner';
import Dialogo from './Dialogo';

interface Props {
  alCerrar: () => void;
  alCrear: (proveedor: Proveedor) => void;
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Alta rapida de proveedor desde Compras */
export default function NuevoProveedorModal({ alCerrar, alCrear }: Props) {
  const [razonSocial, setRazonSocial] = useState('');
  const [rfc, setRfc] = useState('');
  const [telefono, setTelefono] = useState('');
  const [correo, setCorreo] = useState('');
  const [errores, setErrores] = useState<{ razon?: string; correo?: string }>({});
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Este formulario vive dentro de la pagina de Compras: que el envio no suba por el arbol
    e.stopPropagation();
    const nuevos: typeof errores = {};
    if (!razonSocial.trim()) nuevos.razon = 'Escribe la razón social.';
    if (correo.trim() && !CORREO.test(correo.trim())) nuevos.correo = 'Escribe un correo válido.';
    setErrores(nuevos);
    if (Object.keys(nuevos).length > 0) return;

    setEnviando(true);
    setErrorEnvio(null);
    try {
      const { data } = await client.post<Proveedor>('/proveedores', {
        razon_social: razonSocial.trim(),
        rfc: rfc.trim().toUpperCase() || null,
        telefono: telefono.trim() || null,
        correo: correo.trim() || null,
      });
      alCrear(data);
    } catch (error) {
      setErrorEnvio(mensajeDeError(error, 'No se pudo guardar el proveedor. Revisa los datos.'));
      setEnviando(false);
    }
  }

  return (
    <Dialogo titulo="Nuevo proveedor" ancho="max-w-lg" alCerrar={alCerrar}>
      {errorEnvio && <Banner tipo="error">{errorEnvio}</Banner>}
      <form onSubmit={(e) => void guardar(e)} noValidate>
        <div className="space-y-4 px-6 py-5">
          <Campo id="prov-razon" etiqueta="Razón social" error={errores.razon}>
            <input
              id="prov-razon"
              data-autofoco=""
              maxLength={150}
              value={razonSocial}
              aria-invalid={Boolean(errores.razon)}
              onChange={(e) => setRazonSocial(e.target.value)}
              className="campo w-full font-semibold"
            />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="prov-rfc" etiqueta="RFC">
              <input
                id="prov-rfc"
                maxLength={15}
                value={rfc}
                autoComplete="off"
                onChange={(e) => setRfc(e.target.value)}
                className="campo w-full font-mono uppercase"
              />
            </Campo>
            <Campo id="prov-telefono" etiqueta="Teléfono">
              <input
                id="prov-telefono"
                type="tel"
                maxLength={20}
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                className="campo w-full font-mono"
              />
            </Campo>
          </div>
          <Campo id="prov-correo" etiqueta="Correo" error={errores.correo}>
            <input
              id="prov-correo"
              type="email"
              maxLength={120}
              value={correo}
              aria-invalid={Boolean(errores.correo)}
              onChange={(e) => setCorreo(e.target.value)}
              className="campo w-full"
            />
          </Campo>
        </div>
        <footer className="flex justify-end gap-3 border-t border-borde bg-crema px-6 py-4">
          <button type="button" onClick={alCerrar} className="boton h-11 px-6">
            Cancelar
          </button>
          <button type="submit" disabled={enviando} className="boton-primario h-11 px-6">
            {enviando ? 'Guardando…' : 'Guardar proveedor'}
          </button>
        </footer>
      </form>
    </Dialogo>
  );
}

function Campo({ id, etiqueta, error, children }: { id: string; etiqueta: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="etiqueta mb-1.5 block">
        {etiqueta}
      </label>
      {children}
      {error && <p className="mt-1 text-sm font-semibold text-rose-700">{error}</p>}
    </div>
  );
}
