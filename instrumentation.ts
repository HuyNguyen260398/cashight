/**
 * Next.js instrumentation hook — `register()` runs once at server startup,
 * before the app handles requests or evaluates route modules.
 *
 * We install the DOM globals pdfjs-dist needs (DOMMatrix/ImageData/Path2D) as
 * early as possible so the bundled `/api/parse` route module can evaluate on the
 * Amplify Lambda, where the native `@napi-rs/canvas` that normally supplies them
 * fails to load. This is belt-and-suspenders alongside the import at the top of
 * lib/parsers/tpbank.ts; see lib/pdf-dom-polyfill.ts for the root-cause writeup.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installPdfDomPolyfills } = await import('@/lib/pdf-dom-polyfill');
    installPdfDomPolyfills();
  }
}
