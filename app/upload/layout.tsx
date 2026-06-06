import { requireSession } from '@/lib/require-session';

// `app/upload/page.tsx` is a Client Component and can't run the server-side
// `auth()` check itself, so this server-layout gates the whole /upload route.
// (The data-touching action, /api/parse, is independently guarded too.)
export const dynamic = 'force-dynamic';

export default async function UploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return children;
}
