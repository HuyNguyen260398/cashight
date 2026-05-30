import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { StatementSchema } from '@/lib/schemas';
import type { Statement } from '@/lib/schemas';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.STATEMENTS_BUCKET!;

export function statementKey(cardLast4: string, year: number, month: number): string {
  const mm = String(month).padStart(2, '0');
  return `statements/${cardLast4}/${year}/${year}-${mm}.json`;
}

export async function saveStatement(s: Statement): Promise<string> {
  // statementDate is YYYY-MM-DD; the storage key uses year+month only
  const [year, month] = s.statementDate.split('-').map(Number);
  const key = statementKey(s.cardLast4, year, month);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(s),
      ContentType: 'application/json',
    }),
  );
  return key;
}

export async function getStatement(key: string): Promise<Statement> {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
  );
  const text = await response.Body!.transformToString();
  return StatementSchema.parse(JSON.parse(text));
}

export async function listStatements(prefix = 'statements/'): Promise<
  { key: string; cardLast4: string; year: number; month: number; lastModified: Date | undefined }[]
> {
  const response = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }),
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
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function getAllStatements(): Promise<Statement[]> {
  const items = await listStatements();
  return Promise.all(items.map((item) => getStatement(item.key)));
}
