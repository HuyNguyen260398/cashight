# Step 07 — Storage Layer & Statements CRUD

> Build the S3 abstraction and the API routes that persist, list, fetch, and delete statements.

**Estimated effort:** 2–3 hours
**Prerequisites:** Step 06
**Phase:** 2 — Persistence

---

## Goal

Uploaded statements are saved to S3. The user can list all uploaded statements and fetch any one of them by ID. Phase 1 still works — same upload flow, just now with a "save" step.

## Tasks

### Storage abstraction (`lib/storage.ts`)

```ts
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { Statement } from './schemas';
import { StatementSchema } from './schemas';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.STATEMENTS_BUCKET!;

function statementKey(cardLast4: string, year: number, month: number): string {
  const mm = month.toString().padStart(2, '0');
  return `statements/${cardLast4}/${year}/${year}-${mm}.json`;
}

export async function saveStatement(s: Statement): Promise<string> {
  const key = statementKey(s.cardLast4, s.period.year, s.period.month);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: JSON.stringify(s),
    ContentType: 'application/json',
  }));
  return key;
}

export async function getStatement(key: string): Promise<Statement> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const text = await res.Body!.transformToString();
  return StatementSchema.parse(JSON.parse(text));
}

export async function listStatements(prefix = 'statements/'): Promise<Array<{
  key: string;
  cardLast4: string;
  year: number;
  month: number;
  lastModified: Date;
}>> {
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  }));

  return (res.Contents ?? []).map((obj) => {
    // Key format: statements/9674/2026/2026-05.json
    const match = obj.Key!.match(/statements\/(\d{4})\/(\d{4})\/(\d{4})-(\d{2})\.json/);
    return {
      key: obj.Key!,
      cardLast4: match![1],
      year: parseInt(match![2]),
      month: parseInt(match![4]),
      lastModified: obj.LastModified!,
    };
  });
}

export async function deleteStatement(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function getAllStatements(): Promise<Statement[]> {
  const list = await listStatements();
  return Promise.all(list.map((item) => getStatement(item.key)));
}
```

### Update parse route to save (`app/api/parse/route.ts`)

Modify Step 03's route to call `saveStatement()` after parsing:

```ts
const statement = await parseTPBankStatement(buffer);
const key = await saveStatement(statement);
return Response.json({ ...statement, _storageKey: key });
```

### Statements list route (`app/api/statements/route.ts`)

```ts
import { listStatements } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const items = await listStatements();
    return Response.json(items);
  } catch (err) {
    console.error('List failed:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Failed to list statements' }, { status: 500 });
  }
}
```

### Single statement routes (`app/api/statements/[id]/route.ts`)

The "id" here is the URL-encoded S3 key:

```ts
import { getStatement, deleteStatement } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const key = decodeURIComponent(id);
  try {
    return Response.json(await getStatement(key));
  } catch {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteStatement(decodeURIComponent(id));
  return new Response(null, { status: 204 });
}
```

### Duplicate handling

The S3 key derives from `cardLast4` + `period.year-month`, so re-uploading the same month overwrites. With versioning enabled (Step 06), the old version is retained for 90 days. This is the desired behavior — re-parsing should update, not duplicate.

Add a small confirmation UI in Step 10 ("This month's statement already exists. Replace it?") if you want.

### Optional: simple statements list page

For testing this step, add a quick `app/statements/page.tsx` that lists all uploaded statements. This becomes the proper "manage statements" view in Step 10.

```tsx
async function getStatements() {
  const res = await fetch('http://localhost:3000/api/statements', { cache: 'no-store' });
  return res.json();
}

export default async function StatementsPage() {
  const items = await getStatements();
  return (
    <main className="container mx-auto p-6">
      <h1>All statements</h1>
      <ul>
        {items.map((item: any) => (
          <li key={item.key}>
            Card ****{item.cardLast4} — {item.year}-{item.month.toString().padStart(2, '0')}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

## Files affected

- `lib/storage.ts` — **create**
- `app/api/parse/route.ts` — modify (call saveStatement)
- `app/api/statements/route.ts` — **create**
- `app/api/statements/[id]/route.ts` — **create**
- `app/statements/page.tsx` — **create** (basic list for testing)

## Acceptance criteria

- Upload the sample PDF → check S3 (`aws s3 ls s3://<bucket>/statements/9674/2026/`) shows `2026-05.json`
- Hit `http://localhost:3000/api/statements` → returns array with one item
- Hit `http://localhost:3000/statements` → see the statement listed
- Re-upload the same PDF → S3 has 1 current version + 1 noncurrent version (`aws s3api list-object-versions --bucket <bucket> --prefix statements/9674/2026/`)
- Delete via `curl -X DELETE http://localhost:3000/api/statements/<encoded-key>` → S3 object removed

## Notes & gotchas

- **Use AWS profile locally:** set `AWS_PROFILE=default` in `.env.local` if you have multiple profiles. The SDK picks it up automatically.
- **Test with `aws s3 ls`** before debugging app code — most issues at this stage are IAM/credential issues, not application bugs.
- **S3 key as ID** keeps things simple: no separate ID generation, no lookup tables. The downside is keys can change if you ever restructure storage — fine for now.
- **`Promise.all` in `getAllStatements()`** parallelizes S3 GETs. For 50+ statements this matters; for personal use with ~12-36 statements/year, it's plenty.
- **Don't add caching here.** Phase 2 keeps things simple. If S3 latency becomes annoying, Step 09 introduces a server-side cache.
- **Bucket name is required** — the app crashes at startup if `STATEMENTS_BUCKET` is unset. That's intentional.

## Next step

[Step 08 — Aggregation engine](./08-aggregation-engine.md)
