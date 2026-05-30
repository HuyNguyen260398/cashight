import { listStatements } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type StatementItem = {
  key: string;
  cardLast4: string;
  year: number;
  month: number;
  lastModified: Date | undefined;
};

export default async function StatementsPage() {
  let items: StatementItem[] = [];
  let error: string | null = null;

  try {
    items = await listStatements();
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load statements';
  }

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Saved Statements</h1>
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      {items.length === 0 && !error && <p>No statements saved yet.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map((item) => {
          const mm = String(item.month).padStart(2, '0');
          return (
            <li
              key={item.key}
              style={{
                border: '1px solid #ccc',
                borderRadius: '6px',
                padding: '0.75rem 1rem',
                marginBottom: '0.5rem',
              }}
            >
              Card ****{item.cardLast4} — {item.year}-{mm}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
