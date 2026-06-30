#!/usr/bin/env node
/**
 * create-release-manifest.mjs
 *
 * Records a release manifest in the artifacts S3 bucket after a successful
 * deploy. Reads deployed Lambda alias versions from AWS and computes SHA-256
 * checksums for the uploaded frontend files.
 *
 * Required environment variables:
 *   GIT_SHA                    — git commit SHA being deployed
 *   ARTIFACTS_BUCKET           — S3 bucket used for Lambda artifacts and manifests
 *   CLOUDFRONT_DISTRIBUTION_ID — CloudFront distribution ID
 *   AWS_REGION                 — defaults to ap-southeast-1
 *
 * Optional:
 *   OUT_DIR                    — path to frontend build output (default: out/)
 *   CLOUDFRONT_API_DEPLOYMENT_ID — API Gateway deployment ID (informational)
 *
 * Writes to:
 *   s3://{ARTIFACTS_BUCKET}/manifests/{GIT_SHA}.json — versioned manifest
 *   s3://{ARTIFACTS_BUCKET}/manifests/latest.json    — current pointer
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { LambdaClient, GetAliasCommand } from '@aws-sdk/client-lambda';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = process.env.OUT_DIR ?? path.join(ROOT, 'out');
const GIT_SHA = process.env.GIT_SHA ?? process.env.GITHUB_SHA;
const BUCKET = process.env.ARTIFACTS_BUCKET;
const DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID;
const REGION = process.env.AWS_REGION ?? 'ap-southeast-1';

if (!GIT_SHA) throw new Error('GIT_SHA or GITHUB_SHA env var is required');
if (!BUCKET) throw new Error('ARTIFACTS_BUCKET env var is required');
if (!DISTRIBUTION_ID)
  throw new Error('CLOUDFRONT_DISTRIBUTION_ID env var is required');

const s3 = new S3Client({ region: REGION });
const lambda = new LambdaClient({ region: REGION });

const FUNCTION_NAMES = [
  'auth-guard',
  'uploads-api',
  'upload-status-api',
  'parser-worker',
  'statements-api',
  'dashboard-api',
  'summary-api',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(abs, base)));
    } else {
      files.push(path.relative(base, abs));
    }
  }
  return files;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function getS3Json(key) {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    const text = await res.Body.transformToString();
    return JSON.parse(text);
  } catch (err) {
    if (err?.name === 'NoSuchKey') return null;
    throw err;
  }
}

// ── Lambda artifact info ──────────────────────────────────────────────────────

async function getLambdaArtifacts() {
  const artifacts = {};
  await Promise.all(
    FUNCTION_NAMES.map(async (fn) => {
      const functionName = `cashight-${fn}`;
      const alias = await lambda.send(
        new GetAliasCommand({ FunctionName: functionName, Name: 'live' }),
      );
      artifacts[fn] = {
        s3Key: `lambdas/${GIT_SHA}/${fn}.zip`,
        functionVersion: alias.FunctionVersion,
        aliasArn: alias.AliasArn,
      };
    }),
  );
  return artifacts;
}

// ── Frontend checksums ────────────────────────────────────────────────────────

async function getFrontendChecksums() {
  if (!existsSync(OUT_DIR)) return {};
  const files = await walk(OUT_DIR);
  const checksums = {};
  await Promise.all(
    files.map(async (f) => {
      const posix = f.replace(/\\/g, '/');
      checksums[posix] = await sha256File(path.join(OUT_DIR, f));
    }),
  );
  return checksums;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Creating release manifest for ${GIT_SHA}`);

  const [lambdaArtifacts, frontendChecksums, previousManifest] =
    await Promise.all([
      getLambdaArtifacts(),
      getFrontendChecksums(),
      getS3Json('manifests/latest.json'),
    ]);

  const manifest = {
    gitSha: GIT_SHA,
    buildTimestamp: new Date().toISOString(),
    lambdaArtifacts,
    frontendChecksums,
    cloudfrontDistributionId: DISTRIBUTION_ID,
    apiDeploymentId: process.env.CLOUDFRONT_API_DEPLOYMENT_ID ?? null,
    previousManifestKey: previousManifest
      ? `manifests/${previousManifest.gitSha}.json`
      : null,
  };

  const body = `${JSON.stringify(manifest, null, 2)}\n`;

  // Write versioned manifest
  const versionedKey = `manifests/${GIT_SHA}.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: versionedKey,
      Body: body,
      ContentType: 'application/json',
    }),
  );
  console.log(`Wrote s3://${BUCKET}/${versionedKey}`);

  // Update latest pointer
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: 'manifests/latest.json',
      Body: body,
      ContentType: 'application/json',
    }),
  );
  console.log(`Updated s3://${BUCKET}/manifests/latest.json`);

  const fnCount = Object.keys(lambdaArtifacts).length;
  const fileCount = Object.keys(frontendChecksums).length;
  console.log(
    `Manifest recorded: ${fnCount} Lambda functions, ${fileCount} frontend files`,
  );
  if (manifest.previousManifestKey) {
    console.log(`Previous release: ${manifest.previousManifestKey}`);
  }
}

main().catch((err) => {
  console.error(
    `Manifest creation failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});
