import { NextResponse } from 'next/server';

import { auth } from '@/auth';

// Gate every route behind an authenticated session. The matcher below already
// excludes the Auth.js endpoints (/api/auth/*), the sign-in page (/signin), and
// Next.js static assets, so this callback only runs for protected routes.
export default auth((req) => {
  if (req.auth) {
    return NextResponse.next();
  }

  // Unauthenticated. API routes get a 401 so fetch callers see a clean status
  // instead of an HTML redirect; everything else is a page, so redirect to sign-in.
  if (req.nextUrl.pathname.startsWith('/api')) {
    return new NextResponse(null, { status: 401 });
  }

  return NextResponse.redirect(new URL('/signin', req.nextUrl));
});

export const config = {
  matcher: ['/((?!api/auth|signin|_next/static|_next/image|favicon.ico).*)'],
};
