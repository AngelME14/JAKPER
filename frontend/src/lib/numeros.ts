/** "12,5" o "12.50" a entero escalado (sin pasar por flotantes); null si el formato no es valido */
export function aEscala(texto: string, decimales: number): number | null {
  const m = /^(\d+)(?:[.,](\d*))?$/.exec(texto.trim());
  if (!m) return null;
  const fraccion = m[2] ?? '';
  if (fraccion.length > decimales) return null;
  return Number(m[1] + fraccion.padEnd(decimales, '0'));
}

/** Inverso de aEscala: 1255 con 3 decimales -> "1.255" */
export function escalaATexto(valor: number, decimales: number): string {
  const factor = 10 ** decimales;
  return `${Math.floor(valor / factor)}.${String(valor % factor).padStart(decimales, '0')}`;
}

export const formatoDinero = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatoCantidad = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 });

export const pesos = (centavos: number) => `$${formatoDinero.format(centavos / 100)}`;
export const dinero = (valor: string | number) => `$${formatoDinero.format(Number(valor))}`;
export const cantidad = (valor: string | number) => formatoCantidad.format(Number(valor));

/** Fecha local en formato yyyy-mm-dd (lo que usan los input type=date) */
export function fechaISO(fecha: Date = new Date()): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

/** Numero ya validado a entero escalado; null si trae mas decimales de los que soporta la escala */
export function aEntero(valor: number, escala: number): number | null {
  if (!Number.isFinite(valor)) return null;
  const entero = Math.round(valor * escala);
  return Math.abs(valor * escala - entero) < 1e-6 ? entero : null;
}
