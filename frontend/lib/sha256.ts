/**
 * Compute SHA-256 of an ArrayBuffer and return a lowercase 64-char hex string.
 * Each byte is zero-padded to two hex characters so the result is always
 * exactly 64 chars for any input.
 */
export async function computeSha256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
