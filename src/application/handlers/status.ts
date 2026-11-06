import type { BotStatus, CommandContext } from './types.js';

function formatUptime(uptimeMs: number): string {
  const totalSeconds = Math.floor(uptimeMs / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  if (days > 0 || hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

/** `/status` - Estado del bot y worker (usuario autorizado). */
export async function handleStatus(ctx: CommandContext, status: BotStatus): Promise<void> {
  const readyAt = status.readyAt ? status.readyAt.toISOString() : 'n/d';
  await ctx.reply(
    [
      '**DevBot - Estado**',
      `Uptime: ${formatUptime(status.uptimeMs)}`,
      `Latencia del gateway: ${status.webSocketPingMs} ms`,
      `Servidores: ${status.guildCount}`,
      `Listo desde: ${readyAt}`,
      'Motor de ejecucion: no implementado en esta iteracion.',
    ].join('\n'),
    { ephemeral: true },
  );
}
