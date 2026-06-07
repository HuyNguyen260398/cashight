import 'server-only';

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { StatementSchema } from '@/lib/schemas';
import type { Statement } from '@/lib/schemas';

/**
 * Actionable hint shown when an S3 call fails because credentials are missing,
 * expired, or lack permission — the most common local-dev failure (e.g. an
 * expired SSO session). Routes surface this instead of a cryptic 500.
 */
export const STORAGE_AUTH_HINT =
  'Could not reach storage — your AWS credentials are missing, expired, or lack permission. ' +
  'Re-authenticate (e.g. run `aws login`, then `eval "$(aws configure export-credentials --format env)"`) ' +
  'and restart the dev server.';

/** AWS error `name`s that indicate a credentials/auth problem, not a code bug. */
const AUTH_ERROR_NAMES = new Set([
  'CredentialsProviderError',
  'ExpiredToken',
  'ExpiredTokenException',
  'InvalidToken',
  'TokenRefreshRequired',
  'UnrecognizedClientException',
  'AccessDenied',
  'AccessDeniedException',
]);

/** True when `err` looks like an AWS credentials/authentication/authorization failure. */
export function isAuthError(err: unknown): boolean {
  const name =
    typeof err === 'object' && err !== null
      ? (err as { name?: unknown }).name
      : undefined;
  return typeof name === 'string' && AUTH_ERROR_NAMES.has(name);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env.local, then fully restart the server — ` +
        `env vars and ~/.aws/config are read only at startup, not on hot-reload.`,
    );
  }
  return value;
}

type StorageEnv = Record<string, string | undefined>;
const DEFAULT_STORAGE_REGION = 'ap-southeast-1';

export function getStorageRegion(env: StorageEnv = process.env): string {
  return env.STORAGE_REGION ?? env.AWS_REGION ?? DEFAULT_STORAGE_REGION;
}

// Resolve the client and bucket lazily on first use. Validating at module load
// would break `next build` (it imports route modules with no env present);
// validating on first S3 call still fails fast with a clear message at runtime
// instead of a cryptic AWS error. Amplify does not allow user-defined `AWS_*`
// env vars, so production uses STORAGE_REGION while local dev can keep AWS_REGION.
let cached: { s3: S3Client; bucket: string } | undefined;
function getS3(): { s3: S3Client; bucket: string } {
  if (!cached) {
    const region = getStorageRegion();
    const bucket = requireEnv('STATEMENTS_BUCKET');
    cached = { s3: new S3Client({ region }), bucket };
  }
  return cached;
}

export function statementKey(cardLast4: string, year: number, month: number): string {
  const mm = String(month).padStart(2, '0');
  return `statements/${cardLast4}/${year}/${year}-${mm}.json`;
}

export async function saveStatement(s: Statement): Promise<string> {
  const { s3, bucket } = getS3();
  // statementDate is YYYY-MM-DD; the storage key uses year+month only
  const [year, month] = s.statementDate.split('-').map(Number);
  const key = statementKey(s.cardLast4, year, month);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(s),
      ContentType: 'application/json',
    }),
  );
  return key;
}

export async function statementExists(key: string): Promise<boolean> {
  const { s3, bucket } = getS3();
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'NotFound' || name === 'NoSuchKey' || name === 'NotFoundException') return false;
    throw err; // real error (perms, network) — propagate
  }
}

export async function getStatement(key: string): Promise<Statement> {
  const { s3, bucket } = getS3();
  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const text = await response.Body!.transformToString();
  return StatementSchema.parse(JSON.parse(text));
}

export async function listStatements(prefix = 'statements/'): Promise<
  { key: string; cardLast4: string; year: number; month: number; lastModified: Date | undefined }[]
> {
  const { s3, bucket } = getS3();
  const response = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );
  // NOTE: ListObjectsV2 returns up to 1000 keys; pagination (IsTruncated/NextContinuationToken) is intentionally unhandled — fine for personal scale (~12-36/yr).
  const keyRegex = /^statements\/(\d{4})\/(\d{4})\/(\d{4})-(\d{2})\.json$/;
  return (response.Contents ?? [])
    .filter((obj) => obj.Key !== undefined && keyRegex.test(obj.Key))
    .map((obj) => {
      const match = keyRegex.exec(obj.Key!);
      return {
        key: obj.Key!,
        cardLast4: match![1],
        year: Number(match![3]),
        month: Number(match![4]),
        lastModified: obj.LastModified,
      };
    });
}

export async function deleteStatement(key: string): Promise<void> {
  const { s3, bucket } = getS3();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function getAllStatements(): Promise<Statement[]> {
  const items = await listStatements();
  return Promise.all(items.map((item) => getStatement(item.key)));
}
