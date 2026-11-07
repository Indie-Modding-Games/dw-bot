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

  new SlashCommandBuilder()
    .setName('bug')
    .setDescription('Reporta un bug al backlog de GitHub.')
    .addStringOption((option) =>
      option
        .setName('title')
        .setDescription('Titulo breve del bug')
        .setRequired(true)
        .setMaxLength(255),
    )
    .addStringOption((option) =>
      option
        .setName('description')
        .setDescription('Que paso, como reproducirlo y que esperabas')
        .setRequired(true)
        .setMaxLength(3500),
    ),

  new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Propone una mejora al backlog de GitHub.')
    .addStringOption((option) =>
      option
        .setName('title')
        .setDescription('Titulo breve de la sugerencia')
        .setRequired(true)
        .setMaxLength(255),
    )
    .addStringOption((option) =>
      option
        .setName('description')
        .setDescription('Que mejoraria y por que')
        .setRequired(true)
        .setMaxLength(3500),
    ),

  new SlashCommandBuilder()
    .setName('sync-now')
    .setDescription(
      'Ejecuta ya el ciclo: ingiere posts etiquetados de los foros y sincroniza estados con GitHub.',
    ),
];

/** Version serializada para el registro via REST. */
export const slashCommandsJson = slashCommands.map((command) => command.toJSON());
