import { useEffect, useState } from 'react';
import client, { mensajeDeError } from '../api/client';
import Banner from './Banner';
import Dialogo from './Dialogo';
import { cantidad, dinero } from '../lib/numeros';
import type { CompraComprobante, VentaResponse } from '../types';

export interface ComprobanteRef {
  tipo: 'venta' | 'compra';
  id: number;
  folio: string;
}

const METODO: Record<string, string> = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia' };

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Desglose de un ticket de venta o de una compra, consultado al abrir */
export default function ComprobanteModal({
  comprobante,
  alCerrar,
  alDevolver,
}: {
  comprobante: ComprobanteRef;
  alCerrar: () => void;
  /** Si se pasa, cada renglon de una venta vigente ofrece "Devolver" con ese detalle ya elegido */
  alDevolver?: (detalleVentaId: number) => void;
}) {
  const { tipo, id, folio } = comprobante;
  const [venta, setVenta] = useState<VentaResponse | null>(null);
  const [compra, setCompra] = useState<CompraComprobante | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controlador = new AbortController();
    const ruta = tipo === 'venta' ? `/ventas/${id}` : `/compras/${id}`;
    client
      .get(ruta, { signal: controlador.signal })
      .then(({ data }) => (tipo === 'venta' ? setVenta(data as VentaResponse) : setCompra(data as CompraComprobante)))
      .catch((e: unknown) => {
        if (!controlador.signal.aborted) setError(mensajeDeError(e, 'No se pudo cargar el comprobante.'));
      });
    return () => controlador.abort();
  }, [tipo, id]);

  const titulo = `${tipo === 'venta' ? 'Ticket' : 'Compra'} #${folio}`;
  const cargando = !venta && !compra && !error;

  return (
    <Dialogo titulo={titulo} ancho="max-w-3xl" alCerrar={alCerrar}>
      <div className="max-h-[70vh] overflow-auto px-6 py-5">
        {cargando && <p className="py-8 text-center text-sm font-semibold text-tinta-suave">Cargando comprobante…</p>}
        {error && <Banner tipo="error">{error}</Banner>}
        {venta && <DesgloseVenta venta={venta} alDevolver={alDevolver} />}
        {compra && <DesgloseCompra compra={compra} />}
      </div>
      <footer className="flex justify-end border-t border-borde bg-crema px-6 py-3">
        <button type="button" data-autofoco onClick={alCerrar} className="boton">
          Cerrar
        </button>
      </footer>
    </Dialogo>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="etiqueta">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm font-bold text-tinta">{valor}</dd>
    </div>
  );
}

function DesgloseVenta({ venta, alDevolver }: { venta: VentaResponse; alDevolver?: (detalleVentaId: number) => void }) {
  const puedeDevolver = alDevolver !== undefined && venta.estado === 'COMPLETADA';
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Dato etiqueta="Fecha" valor={fechaHora(venta.fecha_venta)} />
        <Dato etiqueta="Cliente" valor={venta.cliente.nombre} />
        <Dato etiqueta="Atendió" valor={venta.usuario.nombre} />
        <Dato etiqueta="Estado" valor={venta.estado === 'CANCELADA' ? 'Cancelada' : 'Completada'} />
      </dl>
      {venta.motivo_cancelacion && (
        <Banner tipo="error">Motivo de cancelación: {venta.motivo_cancelacion}</Banner>
      )}
      <div className="overflow-x-auto rounded-xl border border-borde">
        <table className="tabla w-full min-w-[34rem] text-sm">
          <thead className="text-left text-xs font-bold uppercase tracking-wider text-stone-800">
            <tr>
              <th scope="col" className="celda-titulo">Producto</th>
              <th scope="col" className="celda-titulo">Lote</th>
              <th scope="col" className="celda-titulo text-right">Cant.</th>
              <th scope="col" className="celda-titulo text-right">Precio</th>
              <th scope="col" className="celda-titulo text-right">Subtotal</th>
              {puedeDevolver && <th scope="col" className="celda-titulo"><span className="sr-only">Acciones</span></th>}
            </tr>
          </thead>
          <tbody>
            {venta.items.map((i) => (
              <tr key={i.id}>
                <td className="celda font-extrabold text-tinta">{i.nombre_producto}</td>
                <td className="celda font-mono text-xs">{i.codigo_lote}</td>
                <td className="celda text-right font-mono tabular-nums">{cantidad(i.cantidad)}</td>
                <td className="celda text-right font-mono tabular-nums">{dinero(i.precio_unitario_aplicado)}</td>
                <td className="celda text-right font-mono font-semibold tabular-nums">{dinero(i.subtotal)}</td>
                {puedeDevolver && (
                  <td className="celda text-right">
                    <button
                      type="button"
                      onClick={() => alDevolver(i.id)}
                      aria-label={`Devolver ${i.nombre_producto}`}
                      className="boton h-8 px-2.5"
                    >
                      Devolver
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <ul className="space-y-1 text-sm text-tinta-suave">
          {venta.pagos.map((p) => (
            <li key={p.id}>
              <span className="font-bold text-tinta">{METODO[p.metodo] ?? p.metodo}</span>{' '}
              <span className="font-mono tabular-nums">{dinero(p.importe)}</span>
              {p.cambio !== null && Number(p.cambio) > 0 && (
                <span>
                  {' '}
                  · cambio <span className="font-mono tabular-nums">{dinero(p.cambio)}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="flex items-baseline gap-2">
          <span className="text-lg font-extrabold text-tinta">Total:</span>
          <output className="font-mono text-2xl font-bold tabular-nums text-tinta">{dinero(venta.total)}</output>
        </p>
      </div>
    </div>
  );
}

function DesgloseCompra({ compra }: { compra: CompraComprobante }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Dato etiqueta="Fecha" valor={fechaHora(compra.fecha_compra)} />
        <Dato etiqueta="Proveedor" valor={compra.proveedor_nombre} />
        <Dato etiqueta="Factura / Remisión" valor={compra.factura_proveedor ?? 'Sin dato'} />
        <Dato etiqueta="Registró" valor={compra.usuario_nombre} />
      </dl>
      <div className="overflow-x-auto rounded-xl border border-borde">
        <table className="tabla w-full min-w-[34rem] text-sm">
          <thead className="text-left text-xs font-bold uppercase tracking-wider text-stone-800">
            <tr>
              <th scope="col" className="celda-titulo">Producto</th>
              <th scope="col" className="celda-titulo">Lote</th>
              <th scope="col" className="celda-titulo text-right">Cant.</th>
              <th scope="col" className="celda-titulo text-right">Costo</th>
              <th scope="col" className="celda-titulo text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {compra.items.map((i) => (
              <tr key={i.id}>
                <td className="celda font-extrabold text-tinta">{i.nombre_producto}</td>
                <td className="celda font-mono text-xs">{i.codigo_lote}</td>
                <td className="celda text-right font-mono tabular-nums">{cantidad(i.cantidad)}</td>
                <td className="celda text-right font-mono tabular-nums">{dinero(i.costo_unitario)}</td>
                <td className="celda text-right font-mono font-semibold tabular-nums">{dinero(i.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex items-baseline justify-end gap-2">
        <span className="text-lg font-extrabold text-tinta">Total:</span>
        <output className="font-mono text-2xl font-bold tabular-nums text-tinta">{dinero(compra.total)}</output>
      </p>
    </div>
  );
}
