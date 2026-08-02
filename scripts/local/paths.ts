import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root, derived from this file's location (scripts/local/). */
export const REPO_ROOT = path.resolve(here, '..', '..');

/**
 * Root of the local-only data directory. Everything the dev stack persists
 * (fake S3 objects, fake DynamoDB table) lives under here. Gitignored.
 * Override with LOCAL_DATA_DIR — the vitest suites use a temp dir.
 */
export function localDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOCAL_DATA_DIR
    ? path.resolve(env.LOCAL_DATA_DIR)
    : path.join(REPO_ROOT, '.local-data');
}
