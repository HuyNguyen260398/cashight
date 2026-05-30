'use client';

import { useState } from 'react';
import { UploadDropzone } from '@/app/components/upload-dropzone';
import { Dashboard } from '@/app/components/dashboard';
import { AiSummaryCard } from '@/app/components/ai-summary-card';
import { aggregate } from '@/lib/aggregations';
import type { Statement } from '@/lib/schemas';

export default function UploadPage() {
  const [statement, setStatement] = useState<Statement | null>(null);

  let view = null;
  if (statement) {
    const [year, month] = statement.statementDate.split('-').map(Number);
    view = aggregate([statement], { type: 'month', year, month });
  }

  return (
    <main
      className={`container mx-auto p-6 ${statement ? 'max-w-7xl' : 'max-w-4xl'}`}
    >
      <h1 className="text-2xl font-medium mb-6">Upload statement</h1>
      <UploadDropzone onParsed={setStatement} />
      {statement && view && (
        <div className="mt-6 space-y-6">
          <AiSummaryCard statement={statement} />
          <Dashboard view={view} />
        </div>
      )}
    </main>
  );
}
