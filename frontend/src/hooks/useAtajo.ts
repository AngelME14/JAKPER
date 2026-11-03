import { useEffect, useRef } from 'react';

/**
 * Atajo global de teclado. Se suscribe una sola vez y siempre ejecuta la accion mas reciente.
 * Con un dialogo abierto solo responde el que declara `enDialogo`.
 */
export function useAtajo(tecla: string, accion: () => void, enDialogo = false) {
  const ultima = useRef(accion);
  useEffect(() => {
    ultima.current = accion;
  });

  useEffect(() => {
    const escuchar = (e: KeyboardEvent) => {
      if (e.key !== tecla) return;
      if (!enDialogo && document.querySelector('dialog[open]')) return;
      e.preventDefault();
      ultima.current();
    };
    window.addEventListener('keydown', escuchar);
    return () => window.removeEventListener('keydown', escuchar);
  }, [tecla, enDialogo]);
}
