/**
 * Arranque de prueba: ejecuta el bot real (src/index.ts) y lo cierra a los
 * 10 s para verificar logs de conexion/registro sin quedarse corriendo.
 */
import '../src/index.js';

setTimeout(() => {
  console.log('--- smoke: cierre programado ---');
  process.exit(0);
}, 10000);
