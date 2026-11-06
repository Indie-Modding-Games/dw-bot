import type { CommandContext } from './types.js';

/** `/help` - Mostrar ayuda (usuario autorizado). */
export async function handleHelp(ctx: CommandContext): Promise<void> {
  await ctx.reply(
    [
      '**DevBot - Ayuda**',
      '',
      'Comandos disponibles:',
      '`/help` - Muestra esta ayuda.',
      '`/status` - Estado del bot y de la conexion con Discord.',
      '`/bug title description` - Reporta un bug al backlog de GitHub.',
      '`/suggest title description` - Propone una mejora al backlog de GitHub.',
      '',
      'Los reportes se registran como issues en GitHub y su ficha en el canal',
      'de backlog se actualiza automaticamente cuando cambia el estado.',
      '',
      'Proximas iteraciones: `/projects`, `/tasks`, `/run`, `/history`.',
    ].join('\n'),
    { ephemeral: true },
  );
}
