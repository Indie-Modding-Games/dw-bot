import { SlashCommandBuilder } from 'discord.js';

/**
 * Definiciones de slash commands del MVP (seccion 9).
 * Iteracion 1: solo `/help` y `/status`. El resto se anade con sus
 * iteraciones correspondientes.
 */
export const slashCommands = [
  new SlashCommandBuilder().setName('help').setDescription('Muestra la ayuda de DevBot.'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Muestra el estado del bot y de la conexion con Discord.'),
];

/** Version serializada para el registro via REST. */
export const slashCommandsJson = slashCommands.map((command) => command.toJSON());
