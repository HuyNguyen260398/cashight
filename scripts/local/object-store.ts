import fs from 'node:fs/promises';
import path from 'node:path';

import { localDataDir } from './paths';

/**
 * Filesystem-backed stand-in for S3, used only by the local dev stack.
 *
 * Each bucket is a directory under `<LOCAL_DATA_DIR>/objects/<bucket>/`, and
 * an object key maps 1:1 to a relative path inside it — so you can open
 * `.local-data/objects/statements/users/local-dev-user/statements/9674/2026/2026-05.json`
 * in an editor and read exactly what the API would return.
 *
 * Deliberately not an S3 emulator: no versioning, no presigning, no
 * checksums. The upload checksum is verified by the parser worker itself
 * (process-job.ts), which is the behaviour worth exercising locally.
 */

/** Bucket names used by the local stack. Mirrors the two real buckets. */
export const UPLOAD_BUCKET = 'uploads';
export const STATEMENTS_BUCKET = 'statements';

export class ObjectNotFoundError extends Error {
  constructor(bucket: string, key: string) {
    super(`No such object: ${bucket}/${key}`);
    this.name = 'ObjectNotFoundError';
  }
}

/**
 * Reject anything that could escape the bucket directory. Real S3 keys are
 * opaque strings, but here they become filesystem paths, so `..`, absolute
 * paths, and empty segments have to be refused explicitly.
 */
function assertSafeKey(key: string): void {
  if (!key || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
    throw new Error(`Unsafe object key: ${JSON.stringify(key)}`);
  }
  for (const segment of key.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`Unsafe object key: ${JSON.stringify(key)}`);
    }
  }
}

function objectPath(bucket: string, key: string): string {
  assertSafeKey(key);
  if (!/^[a-z0-9-]+$/.test(bucket)) {
    throw new Error(`Unsafe bucket name: ${JSON.stringify(bucket)}`);
  }
  return path.join(localDataDir(), 'objects', bucket, key);
}

export async function putObject(
  bucket: string,
  key: string,
  body: Buffer | string,
): Promise<void> {
  const file = objectPath(bucket, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

export async function getObject(bucket: string, key: string): Promise<Buffer> {
  try {
    return await fs.readFile(objectPath(bucket, key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ObjectNotFoundError(bucket, key);
    }
    throw err;
  }
}

export async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await fs.stat(objectPath(bucket, key));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/** Deleting a missing object succeeds, as it does in S3. */
export async function deleteObject(bucket: string, key: string): Promise<void> {
  try {
    await fs.unlink(objectPath(bucket, key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/** List every key in a bucket, optionally filtered by prefix. */
export async function listObjects(bucket: string, prefix = ''): Promise<string[]> {
  const root = path.join(localDataDir(), 'objects', bucket);
  const found: string[] = [];

  async function walk(dir: string, relative: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), childRelative);
      } else if (childRelative.startsWith(prefix)) {
        found.push(childRelative);
      }
    }
  }

  await walk(root, '');
  return found.sort();
}
