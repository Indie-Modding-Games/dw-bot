import type { CommandContext } from './types.js';

/** `/help` - Mostrar ayuda (usuario autorizado). */
export async function handleHelp(ctx: CommandContext): Promise<void> {
  await ctx.reply(
    [
      '**DevBot - Ayuda**',
      '',
      'Comandos disponibles en esta version (Iteracion 1):',
      '`/help` - Muestra esta ayuda.',
      '`/status` - Estado del bot y de la conexion con Discord.',
      '',
      'Proximas iteraciones: `/projects`, `/tasks`, `/run`, `/history`, programaciones y notificaciones.',
    ].join('\n'),
    { ephemeral: true },
  );
}
