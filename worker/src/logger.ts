import type { Logger } from 'pino';

/**
 * Shim console→pino: la capa de aplicacion (FeedbackService, PostIngestor)
 * esta tipada con pino; en Workers se usan logs estructurados de consola.
 */
function level(name: string) {
  return (obj?: unknown, msg?: string) => {
    console.log(
      JSON.stringify({
        level: name,
        msg,
        ...(typeof obj === 'object' && obj ? obj : { detail: obj }),
      }),
    );
  };
}

export const logger = {
  info: level('info'),
  warn: level('warn'),
  error: level('error'),
  debug: level('debug'),
  fatal: level('error'),
  trace: level('debug'),
} as unknown as Logger;
