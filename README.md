# DevBot

Herramienta personal de automatización para desarrollo de software.
Interfaz inicial: **bot privado de Discord**. Ver
`DevBot-MVP-Architecture.md` para la especificación completa.

**Estado actual: Iteración 1** — bot de Discord tipado, autenticado, con
allowlist, slash commands (`/help`, `/status`) y logging estructurado.
Sin motor de ejecución, scheduler ni base de datos todavía.

## Requisitos

- Node.js **24.17 o superior** (LTS) — requerido por `discord.js` v14 actual.
- Git (el bot operará sobre repositorios locales en iteraciones futuras).

## Configuración

1. Crea una aplicación en el [Discord Developer Portal](https://discord.com/developers/applications).
2. En **Bot**, copia el **token** y verifica que NO necesitas intents
   privilegiados (solo `Guilds` para slash commands).
3. Copia el **Application ID** (General Information).
4. En tu servidor de pruebas, invita el bot con scopes `bot` y
   `applications.commands` y permisos mínimos
   (View Channels + Send Messages):

   ```
   https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot%20applications.commands&permissions=3072
   ```

5. Copia `.env.example` a `.env` y complétalo. Activar la allowlist es
   obligatorio (`DEVBOT_ALLOWED_USER_IDS`): sin al menos un ID el bot
   no arranca. Para obtener tu ID, activa el modo desarrollador en
   Discord y clic derecho sobre tu perfil → Copiar ID.

## Desarrollo

```bash
npm install
npm run dev            # arranca el bot con recarga (tsx watch)
npm run deploy:commands # registro manual (global si no hay DEVBOT_GUILD_ID)
npm test               # vitest
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run build          # tsc -> dist/
```

En desarrollo, con `DEVBOT_GUILD_ID` definido, los comandos se
registran automáticamente al conectar (propagación inmediata).

## Estructura

Monolito modular según §5/§7 de la arquitectura. El núcleo
(`application/`, `config/`) no importa `discord.js`; el adaptador
(`infrastructure/discord/`) traduce interacciones a casos de uso.

```
src/
├── application/        # casos de uso: handlers, autorización
├── config/             # validación de entorno (Zod)
├── infrastructure/     # adaptadores: discord, logging
└── index.ts            # composition root
tests/                  # unitarias e integración (Vitest)
```

## Roadmap del MVP (§14)

- [x] **Iteración 1** — esqueleto, Discord, `/help`, `/status`, allowlist, logging
- [ ] **Iteración 2** — SQLite + Drizzle, proyectos y tareas
- [ ] **Iteración 3** — TaskRunner, cola, `/run`, `/history`
- [ ] **Iteración 4** — scheduler (`node-cron`), notificaciones
- [ ] **Iteración 5** — integraciones: Git, tests, build, GitHub, HTTP

## Seguridad (§11)

- Solo usuarios (y opcionalmente servidores) en allowlist pueden interactuar.
- Sin comandos arbitrarios: el bot solo ejecuta tareas registradas (iteración 3+).
- Secretos exclusivamente en `.env` (nunca en Git, ignorado por `.gitignore`).
- Logs estructurados sin secretos; salida truncada.
