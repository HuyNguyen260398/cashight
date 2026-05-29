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
