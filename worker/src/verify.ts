/**
 * Verificacion de firmas Ed25519 de Discord (Interactions Endpoint) con WebCrypto,
 * sin dependencias: disponible en Cloudflare Workers.
 * El mensaje firmado es timestamp + cuerpo JSON crudo (concatenacion directa,
 * confirmado por docs 2026). La public key y la firma que envia Discord son
 * HEX (no base64).
 */

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function sha256Prefix(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export interface SignatureInput {
  publicKey: string; // hex (Portal "Public Key" / verify_key)
  signature: string | null; // hex
  timestamp: string | null;
  body: string; // raw JSON text
}

export interface VerifyResult {
  ok: boolean;
  reason: string;
  bodyHash: string;
}

export async function isValidDiscordRequest(input: SignatureInput): Promise<VerifyResult> {
  const { publicKey, signature, timestamp, body } = input;
  const bodyHash = await sha256Prefix(body).catch(() => '?');

  if (!publicKey) return { ok: false, reason: 'sin_public_key', bodyHash };
  if (!signature || !timestamp) return { ok: false, reason: 'sin_headers', bodyHash };

  // Discord exige firmas de menos de 5 minutos.
  const ageMs = Math.abs(Date.now() - Number(timestamp) * 1000);
  if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) {
    return { ok: false, reason: `ts_demasiado_antiguo(${ageMs})`, bodyHash };
  }

  try {
    const keyBytes = hexToBytes(publicKey);
    const key = await crypto.subtle.importKey('raw', keyBytes, 'Ed25519' as never, false, [
      'verify',
    ]);
    const ok = await crypto.subtle.verify(
      'Ed25519' as never,
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body),
    );
    return ok
      ? { ok: true, reason: 'firma_valida', bodyHash }
      : { ok: false, reason: 'firma_no_coincide', bodyHash };
  } catch (error) {
    return {
      ok: false,
      reason: `excepcion: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
      bodyHash,
    };
  }
}
