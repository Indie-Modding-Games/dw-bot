/**
 * Verificacion temporal de credenciales de GitHub para el modulo de feedback.
 * No imprime el token. Ejecutar: npx tsx scripts/verify-github.ts
 */
import 'dotenv/config';

const token = process.env.DEVBOT_GITHUB_TOKEN;
if (!token) {
  console.error('Falta DEVBOT_GITHUB_TOKEN en .env');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'devbot-verify',
};

async function check(label: string, url: string, opts: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...opts, headers: { ...headers, ...opts.headers } });
  console.log(`${label}: HTTP ${res.status} ${res.ok ? 'OK' : 'FALLO'}`);
  return res;
}

const userRes = await check('autenticacion', 'https://api.github.com/user');
const user = (await userRes.json()) as { login?: string };
console.log('   token pertenece a:', user.login);

// Repositorios visibles para este token (fine-grained solo ve los seleccionados).
const reposRes = await fetch('https://api.github.com/user/repos?per_page=100', { headers });
const repos = (await reposRes.json()) as Array<{ full_name: string; has_issues: boolean }>;
console.log('repos accesibles por el token:');
for (const r of repos) {
  console.log(`   - ${r.full_name} | issues habilitadas: ${r.has_issues}`);
}

const repo = process.env.DEVBOT_GITHUB_REPO;
if (!repo) {
  console.error('Falta DEVBOT_GITHUB_REPO');
  process.exit(1);
}

await check(`acceso al repo ${repo}`, `https://api.github.com/repos/${repo}`);

// 204 = puedo leer issues; 403/404 = sin permiso Issues:read (o repo incorrecto).
await check(
  `permiso issues:read en ${repo}`,
  `https://api.github.com/repos/${repo}/issues?per_page=1`,
);

// Prueba de escritura real: crear y cerrar una issue de diagnostico.
const writeRes = await check(
  `permiso issues:write en ${repo}`,
  `https://api.github.com/repos/${repo}/issues`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Diagnostico DevBot (puede cerrarse)',
      body: 'Prueba automatizada de permisos. Seguridad: creada y cerrada por el script.',
      labels: ['bug'],
    }),
  },
);
if (writeRes.ok) {
  const issue = (await writeRes.json()) as { number: number; html_url: string };
  console.log('   issue creada:', `#${issue.number}`, issue.html_url);
  const closeRes = await check(
    'cerrar issue de diagnostico',
    `https://api.github.com/repos/${repo}/issues/${issue.number}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }),
    },
  );
  void closeRes;
} else {
  const detail = await writeRes.text();
  console.error('   detalle:', detail.slice(0, 400));
}

// Verificacion opcional del upload de capturas (endpoint no documentado
// uploads.github.com/user-attachments). Sube un PNG 1x1 de prueba:
//   DEVBOT_VERIFY_UPLOAD=1 npx tsx scripts/verify-github.ts
if (process.env.DEVBOT_VERIFY_UPLOAD === '1') {
  const metaRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  const meta = (await metaRes.json()) as { id?: number };
  if (typeof meta.id !== 'number') {
    console.error('upload: no se pudo obtener el ID numerico del repo');
  } else {
    // PNG 1x1 transparente (67 bytes).
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const uploadUrl =
      `https://uploads.github.com/user-attachments/assets?name=devbot-verify.png` +
      `&content_type=image/png&repository_id=${meta.id}`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/octet-stream',
        'User-Agent': 'devbot-verify',
      },
      body: png,
    });
    const ok = uploadRes.status === 201;
    console.log(
      `upload de capturas (user-attachments): HTTP ${uploadRes.status} ${ok ? 'OK' : 'FALLO'}`,
    );
    if (ok) {
      const data = (await uploadRes.json()) as { url?: string };
      console.log('   asset creado (no se usa, es solo diagnostico):', data.url);
    } else {
      const detail = await uploadRes.text();
      console.error(
        '   detalle:',
        detail.slice(0, 400),
        '\n   pista: si es 401/403 con fine-grained PAT, prueba classic PAT o GitHub App',
      );
    }
  }
}
