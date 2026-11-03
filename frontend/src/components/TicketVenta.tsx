import { PawPrint } from 'lucide-react';
import { cantidad, dinero, pesos } from '../lib/numeros';
import type { MetodoPago, VentaResponse } from '../types';

/** Datos fijos del encabezado; las lineas vacias no se imprimen */
const NEGOCIO = {
  nombre: 'Lucky Pet MTY',
  rfc: '', // ej. 'RFC: XXXX000000XXX'
  sucursal: 'Sucursal Monterrey, N.L.',
  telefono: '', // ej. 'Tel. 81 0000 0000'
};

export type PapelMm = 58 | 80;

const METODO: Record<MetodoPago, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transferencia',
};

interface Renglon {
  productoId: number;
  nombre: string;
  milesimas: number;
  precioUnitario: string;
  importeCentavos: number;
}

/** Un renglon por producto: el ticket no expone el reparto interno por lotes */
function agrupar(venta: VentaResponse): Renglon[] {
  const porProducto = new Map<number, Renglon>();
  for (const i of venta.items) {
    const previo = porProducto.get(i.producto_id);
    const milesimas = Math.round(Number(i.cantidad) * 1000);
    const importeCentavos = Math.round(Number(i.subtotal) * 100);
    if (previo) {
      previo.milesimas += milesimas;
      previo.importeCentavos += importeCentavos;
    } else {
      porProducto.set(i.producto_id, {
        productoId: i.producto_id,
        nombre: i.nombre_producto,
        milesimas,
        precioUnitario: i.precio_unitario_aplicado,
        importeCentavos,
      });
    }
  }
  return [...porProducto.values()];
}

const Separador = () => <hr className="my-2 border-0 border-t border-dashed border-zinc-300" />;

function Fila({
  etiqueta,
  valor,
  fuerte = false,
  sangria = false,
}: {
  etiqueta: string;
  valor: string;
  fuerte?: boolean;
  sangria?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-2 ${fuerte ? 'font-bold' : ''} ${sangria ? 'pl-3' : ''}`}>
      <span>{etiqueta}</span>
      <span className="tabular-nums">{valor}</span>
    </div>
  );
}

/**
 * Recibo para impresora termica (58 u 80 mm). Es solo presentacion: el contenedor que lo
 * imprime (`#ticket-impresion`, ver index.css) vive fuera de la interfaz del POS.
 */
export default function TicketVenta({ venta, papel = 80 }: { venta: VentaResponse; papel?: PapelMm }) {
  const fecha = new Date(venta.fecha_venta);
  const renglones = agrupar(venta);
  const descuentoCentavos = Math.max(0, Math.round((Number(venta.subtotal) - Number(venta.total)) * 100));
  const encabezado = [NEGOCIO.rfc, NEGOCIO.sucursal, NEGOCIO.telefono].filter(Boolean);

  return (
    <article
      aria-label={`Ticket ${venta.folio}`}
      style={{ width: `${papel}mm` }}
      className={`ticket-termico mx-auto max-w-[80mm] bg-white px-[3mm] py-[4mm] font-mono leading-snug text-zinc-900 shadow-none ${
        papel === 58 ? 'text-[10px]' : 'text-[12px]'
      }`}
    >
      <header className="text-center">
        <h1 className="text-[1.25em] font-bold uppercase tracking-wide">{NEGOCIO.nombre}</h1>
        {encabezado.map((linea) => (
          <p key={linea}>{linea}</p>
        ))}
      </header>

      <Separador />

      <dl className="space-y-0.5">
        <p className="font-bold">Ticket #{venta.folio}</p>
        <Fila etiqueta="Fecha" valor={fecha.toLocaleDateString('es-MX')} />
        <Fila
          etiqueta="Hora"
          valor={fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })}
        />
        <Fila etiqueta="Cajero" valor={venta.usuario.nombre} />
        <Fila etiqueta="Cliente" valor={venta.cliente.nombre} />
      </dl>

      <Separador />

      <ul className="space-y-1.5">
        {renglones.map((r) => (
          <li key={r.productoId}>
            <p className="break-words font-semibold">
              {cantidad(r.milesimas / 1000)} x {r.nombre}
            </p>
            <div className="flex justify-between gap-2 pl-3 tabular-nums">
              <span>@ {dinero(r.precioUnitario)}</span>
              <span>{pesos(r.importeCentavos)}</span>
            </div>
          </li>
        ))}
      </ul>

      <Separador />

      <div className="space-y-0.5">
        <Fila etiqueta="Subtotal" valor={dinero(venta.subtotal)} />
        {descuentoCentavos > 0 && <Fila etiqueta="Descuento" valor={`-${pesos(descuentoCentavos)}`} />}
        <div className="flex justify-between gap-2 text-[1.3em] font-bold text-orange-600">
          <span>TOTAL</span>
          <span className="tabular-nums">{dinero(venta.total)}</span>
        </div>
      </div>

      <Separador />

      <ul className="space-y-1">
        {venta.pagos.map((p) => (
          <li key={p.id}>
            <Fila etiqueta={METODO[p.metodo] ?? p.metodo} valor={dinero(p.importe)} />
            {p.metodo === 'EFECTIVO' && p.pago_con !== null && (
              <>
                <Fila etiqueta="Recibido" valor={dinero(p.pago_con)} sangria />
                <Fila etiqueta="Cambio" valor={dinero(p.cambio ?? 0)} fuerte sangria />
              </>
            )}
            {p.metodo !== 'EFECTIVO' && p.referencia && (
              <p className="break-all pl-3">
                {p.metodo === 'TARJETA' ? 'Aut./Voucher' : 'Ref.'}: {p.referencia}
              </p>
            )}
          </li>
        ))}
      </ul>

      <Separador />

      <footer className="flex flex-col items-center gap-1 text-center">
        <PawPrint size={22} strokeWidth={1.8} aria-hidden="true" />
        <p className="font-bold">¡Gracias por cuidar a tu mascota con nosotros!</p>
      </footer>
    </article>
  );
}
