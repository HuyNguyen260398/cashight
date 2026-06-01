import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ObjectIdentifier } from '@aws-sdk/client-s3';

type Options = {
  bucket: string;
  confirmBucket: string;
  region: string;
  dryRun: boolean;
};

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseOptions(): Options {
  const bucket = readOption('--bucket');
  const confirmBucket = readOption('--confirm-bucket');
  const region = readOption('--region') ?? process.env.AWS_REGION ?? 'ap-southeast-1';
  const dryRun = process.argv.includes('--dry-run');

  if (!bucket || !confirmBucket) {
    throw new Error(
      'Usage: pnpm tsx scripts/delete-versioned-s3-bucket.ts ' +
        '--bucket <name> --confirm-bucket <same-name> [--region ap-southeast-1] [--dry-run]',
    );
  }

  if (bucket !== confirmBucket) {
    throw new Error(`Refusing to run: --bucket (${bucket}) must equal --confirm-bucket (${confirmBucket}).`);
  }

  return { bucket, confirmBucket, region, dryRun };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function isMissingBucketError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as { name?: unknown; Code?: unknown; message?: unknown };
  return (
    err.name === 'NoSuchBucket' ||
    err.Code === 'NoSuchBucket' ||
    (typeof err.message === 'string' && err.message.includes('The specified bucket does not exist'))
  );
}

async function collectVersions(s3: S3Client, bucket: string): Promise<ObjectIdentifier[]> {
  const objects: ObjectIdentifier[] = [];
  let KeyMarker: string | undefined;
  let VersionIdMarker: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        KeyMarker,
        VersionIdMarker,
      }),
    );

    for (const version of response.Versions ?? []) {
      if (version.Key && version.VersionId) {
        objects.push({ Key: version.Key, VersionId: version.VersionId });
      }
    }

    for (const marker of response.DeleteMarkers ?? []) {
      if (marker.Key && marker.VersionId) {
        objects.push({ Key: marker.Key, VersionId: marker.VersionId });
      }
    }

    KeyMarker = response.NextKeyMarker;
    VersionIdMarker = response.NextVersionIdMarker;
  } while (KeyMarker || VersionIdMarker);

  return objects;
}

async function main() {
  const options = parseOptions();
  const s3 = new S3Client({ region: options.region });

  let objects: ObjectIdentifier[];
  try {
    objects = await collectVersions(s3, options.bucket);
  } catch (error) {
    if (isMissingBucketError(error)) {
      console.log(`Bucket already absent: ${options.bucket}`);
      return;
    }

    throw error;
  }

  console.log(`Bucket: ${options.bucket}`);
  console.log(`Region: ${options.region}`);
  console.log(`Object versions and delete markers found: ${objects.length}`);

  if (options.dryRun) {
    console.log('Dry run only. No objects or buckets were deleted.');
    return;
  }

  for (const batch of chunk(objects, 1000)) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: options.bucket,
        Delete: {
          Objects: batch,
          Quiet: true,
        },
      }),
    );
    console.log(`Deleted batch of ${batch.length} object versions/delete markers.`);
  }

  const remaining = await collectVersions(s3, options.bucket);
  if (remaining.length > 0) {
    throw new Error(`Refusing to delete bucket: ${remaining.length} object versions/delete markers remain.`);
  }

  await s3.send(new DeleteBucketCommand({ Bucket: options.bucket }));
  console.log(`Deleted bucket: ${options.bucket}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
