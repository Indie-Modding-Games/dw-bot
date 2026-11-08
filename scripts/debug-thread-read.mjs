/**
 * Diagnostico de lectura de posts de foro con el token REAL del bot.
 * Uso: node scripts/debug-thread-read.mjs
 * No imprime secretos; solo metadatos de hilos/mensajes del servidor propio.
 */
import 'dotenv/config';

const API = 'https://discord.com/api/v10';
const token = process.env.DISCORD_TOKEN;
const guild = process.env.DEVBOT_GUILD_ID;
const forums = [
  ['bugs', process.env.DEVBOT_FEEDBACK_BUGS_CHANNEL_ID],
  ['propuestas', process.env.DEVBOT_FEEDBACK_PROPOSALS_CHANNEL_ID],
].filter(([, id]) => id);

async function call(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 200);
  }
  return { status: r.status, data };
}

const me = await call('GET', '/users/@me');
console.log('bot id:', me.data?.id, '| username:', me.data?.username);

const act = await call('GET', `/guilds/${guild}/threads/active`);
if (!act.status.toString().startsWith('2')) {
  console.log('threads/active fallo:', act.status, JSON.stringify(act.data).slice(0, 300));
  process.exit(1);
}
const threads = (act.data.threads ?? []).filter((t) => forums.some(([, id]) => id === t.parent_id));
console.log(`hilos activos en foros: ${threads.length}`);
for (const [label, id] of forums) console.log(`  foro ${label} = ${id}`);

for (const t of threads) {
  const forumName = forums.find(([, id]) => id === t.parent_id)?.[0] ?? t.parent_id;
  console.log(`\n=== ${forumName} | ${t.id} | ${t.name} | tags=${JSON.stringify(t.applied_tags)}`);

  // 1) lectura de mensajes tal como la hace el worker
  const msgs = await call('GET', `/channels/${t.id}/messages?limit=100`);
  const ok = Array.isArray(msgs.data);
  console.log(`  GET messages: HTTP ${msgs.status}${ok ? ` | ${msgs.data.length} mensajes` : ` | ${JSON.stringify(msgs.data).slice(0, 160)}`}`);
  if (ok && msgs.data.length > 0) {
    const old = [...msgs.data].reverse(); // cronologico: [0] = starter
    for (const m of old.slice(0, 3)) {
      console.log(
        `    starter? id=${m.id} type=${m.type} bot=${m.author?.bot} att=${(m.attachments ?? []).length} content=${JSON.stringify((m.content ?? '').slice(0, 80))}`,
      );
    }
  }

  // 2) es el bot miembro del hilo?
  const members = await call('GET', `/channels/${t.id}/thread-members`);
  const isMember =
    Array.isArray(members.data) && members.data.some((tm) => tm.id === me.data?.id);
  console.log(`  thread-members: HTTP ${members.status} | bot miembro: ${isMember}`);

  // 3) si puede leerse pero el starter sale vacio o no se puede leer, probar join
  if (!ok || !isMember) {
    const join = await call('PUT', `/channels/${t.id}/thread-members/@me`);
    console.log(`  JOIN (PUT thread-members/@me): HTTP ${join.status}`);
    const again = await call('GET', `/channels/${t.id}/messages?limit=100`);
    const ok2 = Array.isArray(again.data);
    console.log(`  relectura tras join: HTTP ${again.status}${ok2 ? ` | ${again.data.length} mensajes` : ''}`);
    if (ok2 && again.data.length > 0) {
      const old = [...again.data].reverse();
      const starter = old[0];
      console.log(`    starter id=${starter.id} type=${starter.type} content=${JSON.stringify((starter.content ?? '').slice(0, 80))} att=${(starter.attachments ?? []).length}`);
      const firstText = old.find(
        (m) => m.type === 0 && !m.author?.bot && (m.content ?? '').trim() !== '',
      );
      if (firstText) {
        console.log(
          `    primer mensaje con texto: id=${firstText.id} autor=${firstText.author?.username} content=${JSON.stringify(firstText.content.slice(0, 120))}`,
        );
      }
    }
  }
}
