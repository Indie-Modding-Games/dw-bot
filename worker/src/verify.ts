/**
 * Verificacion de firmas Ed25519 de Discord (Interactions Endpoint) con WebCrypto,
 * sin dependencias: disponible en Cloudflare Workers.
 * El mensaje firmado es timestamp + cuerpo JSON crudo (concatenacion directa).
 */

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export interface SignatureInput {
  publicKey: string; // base64
  signature: string | null; // hex
  timestamp: string | null;
  body: string; // raw JSON text
}

export async function isValidDiscordRequest(input: SignatureInput): Promise<boolean> {
  const { publicKey, signature, timestamp, body } = input;
  if (!publicKey || !signature || !timestamp) return false;

  // Discord exige firmas de menos de 5 minutos.
  const ageMs = Math.abs(Date.now() - Number(timestamp) * 1000);
  if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) return false;

  try {
    const keyBytes = base64ToBytes(publicKey);
    const key = await crypto.subtle.importKey('raw', keyBytes, 'Ed25519' as never, false, [
      'verify',
    ]);
    const message = new TextEncoder().encode(timestamp + body);
    return await crypto.subtle.verify('Ed25519' as never, key, hexToBytes(signature), message);
  } catch {
    return false;
  }
}
