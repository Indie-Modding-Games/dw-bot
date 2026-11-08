# DevBot

Herramienta personal de automatización para desarrollo de software.
Interfaz inicial: **bot privado de Discord**. Ver
`DevBot-MVP-Architecture.md` para la especificación completa.

**Estado actual: Iteración 1 + módulo de feedback** — bot de Discord tipado,
autenticado, con allowlist, slash commands (`/help`, `/status`, `/bug`,
`suggest`) y logging estructurado. `/bug` y `/suggest` registran issues en un
backlog de GitHub con ficha sincronizada en Discord (requiere credenciales;
si faltan, el módulo se deshabilita con aviso). Sin motor de ejecución ni
base de datos todavía.

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
   (View Channels + Send Messages + Embed Links + lectura/gestión de hilos
   de foro, ver secciones de abajo):

   ```
   https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot%20applications.commands&permissions=292057861120
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

## Ingestión desde foros de Discord (posts → tickets)

El bot lee dos **canales de foro** de Discord y convierte posts en tickets:

- **Propuestas**: solo los posts etiquetados **`Aceptado`** entran al backlog.
  Cuando su issue llega a **done** (cerrada como completada en GitHub), el bot
  **cierra el post por sí solo**: quita `Aceptado`, pone `Hecho`, comenta el
  cierre dentro del post y lo **archiva** (queda bloqueado, fuera del foro
  activo y de las busquedas, con el historial intacto y desarchivable).
  Como los posts archivados ya no aparecen en los hilos activos, tampoco
  reciben más sincronizaciones de contenido: el ciclo queda libre para los
  posts que aún importan.
- **Bugs**: solo los posts etiquetados **`En revisión`** entran al backlog
  (con `DEVBOT_BUGS_DONE_TAG` definida, también se etiquetan y archivan al
  llegar a done).

> Si una issue se reabre después de archivar el post, el bot no lo desarchiva
> automáticamente: hay que desarchivarlo a mano desde Discord para seguir
> sincronizando ese ticket.

`/sync-now` fuerza el ciclo completo al instante (ingestión + sincronización)
sin esperar al cron. La ingesta es idempotente: un post ya convertido nunca se
duplica (se rastrea por ID de post en `data/feedback.json`).

### Sincronización continua Discord → GitHub (cada 5 min)

Además de crear el ticket la primera vez, el bot **revisa los cambios del post**
en cada ciclo:

- **Post editado** (titulo, texto o capturas nuevas): la firma de contenido
  (hash del titulo+texto+IDs de adjuntos) cambia y el bot actualiza el
  titulo/cuerpo de la issue. Las issues ya cerradas no se reabren por ediciones.
- **Capturas y videos** adjuntos al post: se descargan del CDN de Discord y se
  **suben a GitHub** como assets de usuario (el mismo endpoint que usa el
  drag-and-drop de la web), embebiendolos en el cuerpo de la issue. Cada
  adjunto se sube UNA sola vez (se rastrea por ID); los que fallan se reintentan
  en el proximo tick; los demasiado grandes o de tipo no soportado se listan
  como "no disponibles" con enlace al post original.
- **Respuestas nuevas del hilo**: se reenvian como **comentarios de la issue**
  (autor + fecha + texto + sus capturas). Se usa una marca de agua por post,
  asi el historial anterior a la creacion del ticket no se spamea y nada se
  reenvia dos veces. Los mensajes del propio bot y del sistema se ignoran.

Requisitos extra del token de GitHub: el upload de assets usa
`uploads.github.com/user-attachments` con el mismo `DEVBOT_GITHUB_TOKEN`.
Con PAT classic funciona; si usas fine-grained y el upload devuelve 401/403,
prueba con un token classic o un GitHub App. Si una subida falla, el bot lo
registra en el log (`posts.attachment_upload_failed`) y reintenta solo.

Cuando el ticket llega a done, el post se **archiva** y queda fuera del foro
activo: desde ese momento deja de entrar en los ciclos de revisión (los
reintentos de etiqueta pendientes siguen funcionando porque se resuelven por
ID de post, no por listado).

Nombres de etiquetas y canales configurables con `DEVBOT_FEEDBACK_PROPOSALS_CHANNEL_ID`,
`DEVBOT_PROPOSALS_REQUIRED_TAG/DONE_TAG`, `DEVBOT_FEEDBACK_BUGS_CHANNEL_ID` y
`DEVBOT_BUGS_REQUIRED_TAG`. El bot necesita en **esos foros**: View Channel,
Send Messages, Send Messages In Threads, Read Message History y **Manage Threads**.
Si el bot no ve la etiqueta requerida en el foro, lo avisa en el log y no ingiere
(comprueba que el foro sea tipo **Foro** y que las etiquetas existan con ese nombre exacto).

Requisitos: `DEVBOT_GITHUB_TOKEN` (issues read/write), `DEVBOT_GITHUB_REPO`
(`owner/repo`) y `DEVBOT_FEEDBACK_CHANNEL_ID`. **Si faltan, el módulo queda
deshabilitado con aviso en el arranque y el bot sigue operativo** — credenciales
pendientes para una pasada posterior.

El bot necesita en el canal de backlog: View Channel, Send Messages y
**Embed Links**. El link de invitación con todos los permisos (incluidos los de
foros) usa `permissions=292057861120`:

```
https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot%20applications.commands&permissions=292057861120
```

Si ya invitaste al bot con permisos menores, vuelve a usar el link (reautoriza)
o añade los permisos desde _Server Settings → Roles → DevBot_.

El seguimiento vive en `data/feedback.json` (resiste reinicios).

### Pendientes para más adelante

- Completar credenciales de GitHub y canal de backlog en `.env`.
- Migrar el estado de JSON a SQLite (Iteración 2 del plan).
- Webhook de GitHub en lugar de polling si el bot se expone públicamente.
- Permitir enlazar issues existentes (`/bug link:#123`) y sincronizar issues
  creadas fuera del bot.

## CI/CD — despliegue en Cloudflare Workers (costo $0)

El objetivo primario es **Cloudflare Workers** (`worker/`): Discord envía cada
slash command al **Interactions Endpoint** del worker y un **Cron Trigger**
cada 5 min ejecuta la ingesta de foros + sincronización GitHub → Discord.
Sin VM, sin SSH, sin gateway persistente, y con `src/core` + `src/application`
reutilizados intactos. El seguimiento vive en **D1** (SQLite serverless free).

Pipeline (`.github/workflows/deploy.yml`), en cada push a `main`:

```
test (typecheck, lint, vitest, typecheck:worker) → deploy (wrangler, GHCR/Docker opcional)
```

### Secretos del worker (3, con wrangler)

```bash
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DEVBOT_GITHUB_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY   # Developer Portal → General Information → Public Key
```

Config no secreta (canales, foros, etiquetas, allowlist, repo) vive en
`wrangler.toml` `[vars]`; las tablas D1 se crean con `npm run worker:seed`.

### Despliegue manual (desde esta máquina)

```bash
npm run typecheck:worker && npm run worker:deploy
```

Primer deploy requiere el **subdominio workers.dev de la cuenta** (alta única,
solo disponible desde el dashboard de Cloudflare; la API/OAuth lo bloquea con
405): _dash.cloudflare.com → Workers → Onboarding_ y registra un subdominio.
Luego el deploy publica `https://andromon.<subdominio>.workers.dev`.

### Conectar Discord (una vez, una URL)

En el Developer Portal de Andromon → **General Information → Interactions
Endpoint URL**: `https://andromon.<subdominio>.workers.dev/interactions`.
El worker responde al PING de verificación con la firma Ed25519 usando el
secreto `DISCORD_PUBLIC_KEY` (se obtiene del mismo portal).

### Automatizar con GitHub Actions

Secretos del repo (_Settings → Secrets and variables → Actions_):

| Secret                  | Valor                                                        |
| ----------------------- | ------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | token con **Workers Scripts: Edit**                          |
| `CLOUDFLARE_ACCOUNT_ID` | ID de cuenta (32 hex, **sin espacios ni comillas al pegar**) |

Un paso de _Sanity de credenciales_ valida el formato antes del deploy y lo
anota rojo si hay espacios/caracteres inválidos o falta el secret.
Con eso, cada push a `main` hace test + `wrangler deploy` automáticamente.

## Alternativa: Docker + VM (conservada)

`Dockerfile` (multi-stage amd64+arm64) + `docker-compose.yml` siguen en el
repo. Si algún día hay VM (Oracle A1 con PAYG, u otro VPS): `/opt/devbot` con
compose + `.env` local, imagen desde GHCR, `restart: unless-stopped`, y el
job `build`/`deploy` del workflow puede reactivarse. El bot no expone puertos
(solo salida a Discord y GitHub).

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
