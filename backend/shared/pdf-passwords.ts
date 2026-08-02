/**
 * Interpret the PDF password secret.
 *
 * Two shapes are accepted so a deploy and a secret rotation do not have to be
 * simultaneous:
 *   - a plain string  -> one candidate password (the original shape)
 *   - a JSON object   -> its values, in declaration order
 *
 * The JSON keys are human labels only. Passwords cannot be selected by bank
 * because the PDF must be decrypted before its bank can be detected, so every
 * candidate is tried in turn.
 *
 * Never log the input or the output of this function.
 */
export function parsePdfPasswords(secretString: string): string[] {
  const trimmed = secretString.trim();
  if (trimmed === '') return [];

  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const values = Object.values(parsed as Record<string, unknown>).filter(
          (value): value is string => typeof value === 'string' && value !== '',
        );
        return [...new Set(values)];
      }
    } catch {
      // Not JSON after all — fall through and treat it as a single password.
    }
  }

  return [trimmed];
}
