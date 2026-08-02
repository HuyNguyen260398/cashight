import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dataDir: string;

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cashight-objects-'));
  process.env.LOCAL_DATA_DIR = dataDir;
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  delete process.env.LOCAL_DATA_DIR;
});

const {
  ObjectNotFoundError,
  deleteObject,
  getObject,
  listObjects,
  objectExists,
  putObject,
} = await import('../object-store');

describe('local object store', () => {
  it('writes a key to the matching path on disk and reads it back', async () => {
    const key = 'users/local-dev-user/statements/9674/2026/2026-05.json';
    await putObject('statements', key, '{"ok":true}');

    expect((await getObject('statements', key)).toString('utf8')).toBe('{"ok":true}');
    expect(await fs.readFile(path.join(dataDir, 'objects', 'statements', key), 'utf8')).toBe(
      '{"ok":true}',
    );
  });

  it('reports existence and throws a typed error on a missing key', async () => {
    expect(await objectExists('statements', 'nope/missing.json')).toBe(false);
    await expect(getObject('statements', 'nope/missing.json')).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
  });

  it('deletes idempotently, as S3 does', async () => {
    await putObject('uploads', 'uploads/u/1.pdf', Buffer.from('%PDF-'));
    await deleteObject('uploads', 'uploads/u/1.pdf');
    await deleteObject('uploads', 'uploads/u/1.pdf');
    expect(await objectExists('uploads', 'uploads/u/1.pdf')).toBe(false);
  });

  it('lists keys under a prefix', async () => {
    await putObject('uploads', 'uploads/a/1.pdf', 'x');
    await putObject('uploads', 'uploads/b/2.pdf', 'x');
    await putObject('uploads', 'other/3.pdf', 'x');
    expect(await listObjects('uploads', 'uploads/')).toEqual([
      'uploads/a/1.pdf',
      'uploads/b/2.pdf',
    ]);
  });

  it('refuses keys that would escape the bucket directory', async () => {
    for (const key of ['../escape', 'a/../../escape', '/absolute', '']) {
      await expect(putObject('statements', key, 'x')).rejects.toThrow(/Unsafe object key/);
    }
    await expect(putObject('../evil', 'k', 'x')).rejects.toThrow(/Unsafe bucket name/);
  });
});
