/**
 * Returns a Promise that resolves after `ms` milliseconds.
 * Extracted as its own module so tests can mock it to make sleeps instant.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
