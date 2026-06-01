import { spawnSync } from 'node:child_process';

const LEGACY_BUCKETS = [
  'cashight-statements-cashight-2026',
  'cashight-tfstate-cashight-2026',
  'expense-tracker-statements-cashight-2026',
  'expense-tracker-tfstate-cashight',
];

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const region = readOption('--region') ?? process.env.AWS_REGION ?? 'ap-southeast-1';
const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--confirm-delete-legacy-buckets');

if (!dryRun && !confirmed) {
  throw new Error(
    'Refusing to delete legacy buckets without --confirm-delete-legacy-buckets. ' +
      'Run with --dry-run first to inspect targets.',
  );
}

console.log(`${dryRun ? 'Dry-running' : 'Deleting'} legacy S3 buckets in ${region}:`);
for (const bucket of LEGACY_BUCKETS) {
  console.log(`- ${bucket}`);
}

for (const bucket of LEGACY_BUCKETS) {
  const args = [
    'tsx',
    'scripts/delete-versioned-s3-bucket.ts',
    '--bucket',
    bucket,
    '--confirm-bucket',
    bucket,
    '--region',
    region,
  ];

  if (dryRun) {
    args.push('--dry-run');
  }

  const result = spawnSync('pnpm', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Legacy bucket cleanup failed for ${bucket}.`);
  }
}
