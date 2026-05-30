'use client';

import { useState } from 'react';
import { UploadDropzone } from '@/app/components/upload-dropzone';
import { Dashboard } from '@/app/components/dashboard';
import type { Statement } from '@/lib/schemas';

export default function UploadPage() {
  const [statement, setStatement] = useState<Statement | null>(null);

  return (
    <main
      className={`container mx-auto p-6 ${statement ? 'max-w-7xl' : 'max-w-4xl'}`}
    >
      <h1 className="text-2xl font-medium mb-6">Upload statement</h1>
      <UploadDropzone onParsed={setStatement} />
      {statement && (
        <div className="mt-6">
          <Dashboard statement={statement} />
        </div>
      )}
    </main>
  );
}
