# Step 03 — Parse API Route & Upload UI

> Wire the parser behind a Next.js API route and build the drag-drop upload page.

**Estimated effort:** 2 hours
**Prerequisites:** Step 02
**Phase:** 1 — MVP

---

## Goal

A working upload page at `/upload` where dropping a PDF sends it to `/api/parse` and displays the resulting JSON. End-to-end browser → server → parser → response.

## Tasks

### Backend (`app/api/parse/route.ts`)

1. **Force Node runtime** (critical — `pdf-parse` doesn't run on Edge):
   ```ts
   export const runtime = 'nodejs';
   export const dynamic = 'force-dynamic';
   export const maxDuration = 30;
   ```

2. **Handle the multipart upload:**
   ```ts
   export async function POST(request: Request) {
     const formData = await request.formData();
     const file = formData.get('file') as File | null;
     if (!file) {
       return Response.json({ error: 'No file provided' }, { status: 400 });
     }

     const buffer = Buffer.from(await file.arrayBuffer());
     try {
       const statement = await parseTPBankStatement(buffer);
       return Response.json(statement);
     } catch (err) {
       console.error('Parse failed:', err instanceof Error ? err.message : err);
       return Response.json(
         { error: 'Could not parse PDF. Make sure it is a TPBank statement.' },
         { status: 422 }
       );
     }
   }
   ```

3. **Validate input:**
   - Reject non-PDF files (`file.type !== 'application/pdf'`)
   - Reject files larger than 5 MB
   - Add size + type checks BEFORE buffering to memory

### Frontend (`app/components/upload-dropzone.tsx`)

1. **Build the dropzone component** using `react-dropzone`:
   ```tsx
   'use client';

   import { useDropzone } from 'react-dropzone';
   import { useState } from 'react';
   import type { Statement } from '@/lib/schemas';

   export function UploadDropzone({
     onParsed,
   }: {
     onParsed: (s: Statement) => void;
   }) {
     const [loading, setLoading] = useState(false);
     const [error, setError] = useState<string | null>(null);

     const { getRootProps, getInputProps, isDragActive } = useDropzone({
       accept: { 'application/pdf': ['.pdf'] },
       maxFiles: 1,
       maxSize: 5 * 1024 * 1024,
       onDrop: async ([file]) => {
         setLoading(true);
         setError(null);
         const fd = new FormData();
         fd.append('file', file);
         const res = await fetch('/api/parse', { method: 'POST', body: fd });
         if (!res.ok) {
           setError((await res.json()).error);
         } else {
           onParsed(await res.json());
         }
         setLoading(false);
       },
     });

     return (
       <div
         {...getRootProps()}
         className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:bg-muted/50 transition"
       >
         <input {...getInputProps()} />
         {loading ? 'Parsing...' :
          isDragActive ? 'Drop the PDF here' :
          'Drag a TPBank statement PDF here, or click to select'}
         {error && <p className="text-destructive mt-2">{error}</p>}
       </div>
     );
   }
   ```

### Upload page (`app/upload/page.tsx`)

1. **Build the page shell** with the dropzone and a preview area:
   ```tsx
   'use client';

   import { useState } from 'react';
   import { UploadDropzone } from '@/app/components/upload-dropzone';
   import type { Statement } from '@/lib/schemas';

   export default function UploadPage() {
     const [statement, setStatement] = useState<Statement | null>(null);

     return (
       <main className="container mx-auto p-6 max-w-4xl">
         <h1 className="text-2xl font-medium mb-6">Upload statement</h1>
         <UploadDropzone onParsed={setStatement} />
         {statement && (
           <pre className="mt-6 p-4 bg-muted rounded text-xs overflow-auto max-h-[500px]">
             {JSON.stringify(statement, null, 2)}
           </pre>
         )}
       </main>
     );
   }
   ```

### Home page redirect

Update `app/page.tsx` to redirect to `/upload` for now — the proper dashboard comes in Step 04.

## Files affected

- `app/api/parse/route.ts` — **create**
- `app/components/upload-dropzone.tsx` — **create**
- `app/upload/page.tsx` — **create**
- `app/page.tsx` — modify (temporary redirect)

## Acceptance criteria

- Navigate to `http://localhost:3000/upload`
- Drag the sample PDF onto the dropzone
- The page shows the parsed JSON with all transactions
- Drop a non-PDF file → see an error message
- Drop a file larger than 5 MB → see an error message
- Browser network tab shows the `/api/parse` request returned 200 with the statement JSON

## Notes & gotchas

- **`maxDuration`** caps the Lambda execution time when deployed to Amplify. 30s is plenty for parsing.
- **CORS isn't an issue** — same-origin from `/upload` to `/api/parse`.
- **Don't render the raw JSON in production.** This `<pre>` block is just a sanity check for this step — Step 04 replaces it with the actual dashboard.
- **No persistence yet.** Refreshing the page wipes the parsed statement. That's intentional — storage comes in Step 07.
- **Error UX is minimal here.** Step 10 polishes it.

## Next step

[Step 04 — Dashboard charts](./04-dashboard-charts.md)
