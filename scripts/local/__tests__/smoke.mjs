#!/usr/bin/env node
/**
 * End-to-end smoke test for the local dev stack: drives the same four steps
 * the browser does (hash → POST /uploads → PUT → poll) against a running
 * `pnpm dev:local`, then checks /statements and /dashboard.
 *
 * Usage:
 *   pnpm dev:local &
 *   node scripts/local/__tests__/smoke.mjs test-pdfs/your-statement.pdf
 *
 * Not part of `pnpm test` — it needs a live server and a real PDF, neither of
 * which exists in CI.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const BASE = process.env.LOCAL_API_BASE_URL ?? 'http://localhost:8787';
const file = process.argv[2];

if (!file) {
  console.error('Usage: node scripts/local/__tests__/smoke.mjs <path-to.pdf>');
  process.exit(2);
}

const pdf = await fs.readFile(file);
const sha256 = crypto.createHash('sha256').update(pdf).digest('hex');

async function json(response) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function fail(message, detail) {
  console.error(`✗ ${message}`);
  if (detail !== undefined) console.error(detail);
  process.exit(1);
}

// 1. Create the job
const created = await fetch(`${BASE}/uploads`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    fileName: file.split('/').pop(),
    contentType: 'application/pdf',
    size: pdf.length,
    sha256,
    force: true,
  }),
});
const createdBody = await json(created);
if (!created.ok) fail(`POST /uploads → ${created.status}`, createdBody);
const { job, upload } = createdBody;
console.log(`✓ job ${job.jobId} created (${job.state})`);

// 2. Upload the bytes to the "presigned" URL
const put = await fetch(upload.url, {
  method: upload.method,
  headers: upload.headers,
  body: pdf,
});
if (!put.ok) fail(`PUT ${upload.url} → ${put.status}`);
console.log('✓ PDF uploaded');

// 3. Poll until terminal
let final;
for (let attempt = 0; attempt < 60; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const polled = await json(await fetch(`${BASE}/uploads/${job.jobId}`));
  if (!polled.job) fail('GET /uploads/{jobId} returned no job', polled);
  if (polled.job.state !== 'PENDING_UPLOAD' && polled.job.state !== 'PROCESSING') {
    final = polled.job;
    break;
  }
}
if (!final) fail('job never reached a terminal state');
if (final.state !== 'SUCCEEDED') fail(`job ended in ${final.state}`, final);
console.log(`✓ parsed → statement ${final.statementId}`);

// 4. Read it back through the API
const list = await json(await fetch(`${BASE}/statements`));
const summary = list.items?.find((item) => item.statementId === final.statementId);
if (!summary) fail('statement missing from GET /statements', list);
console.log(
  `✓ listed: ${summary.statementDate} · card ${summary.cardLast4} · ` +
    `${summary.transactionCount} txns · totalSpend ${summary.totalSpend.toLocaleString()}`,
);

const detail = await json(await fetch(`${BASE}/statements/${final.statementId}`));
if (!detail.statement) fail('GET /statements/{id} returned no statement', detail);
if (/\d{9,}/.test(detail.statement.cardLast4)) fail('cardLast4 is not masked');

const [year, month] = summary.statementDate.split('-').map(Number);
const dashboard = await json(
  await fetch(`${BASE}/dashboard?period=month&year=${year}&month=${month}`),
);
if (typeof dashboard.totals?.totalSpend !== 'number') {
  fail('GET /dashboard returned no totals', dashboard);
}
console.log(`✓ dashboard totalSpend ${dashboard.totals.totalSpend.toLocaleString()}`);

console.log('\nAll local stack checks passed.');
