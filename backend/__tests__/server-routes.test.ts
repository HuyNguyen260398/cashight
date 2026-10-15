import { describe, expect, it } from 'vitest';

import { matchRoute } from '../server/routes';

describe('matchRoute', () => {
  it.each([
    ['POST', '/uploads', 'uploads', {}, true],
    ['GET', '/uploads/job-1', 'uploadStatus', { jobId: 'job-1' }, false],
    ['GET', '/statements', 'statements', {}, false],
    ['GET', '/statements/9674-2026-05', 'statements', { statementId: '9674-2026-05' }, false],
    ['DELETE', '/statements/9674-2026-05', 'statements', { statementId: '9674-2026-05' }, false],
    ['GET', '/dashboard', 'dashboard', {}, false],
    ['GET', '/session/capabilities', 'sessionCapabilities', {}, false],
    ['POST', '/summaries', 'summaries', {}, true],
    ['POST', '/aws/cost-explorer/query', 'costExplorer', {}, true],
    ['GET', '/aws/cost-explorer/reports', 'costExplorer', {}, false],
    ['DELETE', '/aws/cost-explorer/reports/r-1', 'costExplorer', { reportId: 'r-1' }, false],
    ['POST', '/aws/invoices/summary', 'awsInvoiceSummaries', {}, true],
    ['POST', '/aws/invoices/uploads', 'awsInvoices', {}, true],
    ['GET', '/aws/invoices/uploads/job-2', 'awsInvoices', { jobId: 'job-2' }, false],
    ['GET', '/aws/invoices', 'awsInvoices', {}, false],
    ['GET', '/aws/invoices/dashboard', 'awsInvoices', {}, false],
    ['GET', '/aws/invoices/2026-07', 'awsInvoices', { yearMonth: '2026-07' }, false],
    ['DELETE', '/aws/invoices/2026-07', 'awsInvoices', { yearMonth: '2026-07' }, false],
  ])('%s %s → %s', (method, path, handler, pathParameters, readsBody) => {
    expect(matchRoute(method, path)).toEqual({ handler, pathParameters, readsBody });
  });

  it.each([
    ['GET', '/'],
    ['GET', '/uploads'],
    ['DELETE', '/statements'],
    ['PUT', '/statements/x'],
    ['GET', '/statements/a/b'],
    ['POST', '/dashboard'],
    ['GET', '/session'],
    ['GET', '/summaries'],
    ['GET', '/aws'],
    ['GET', '/aws/cost-explorer'],
    ['GET', '/unknown'],
  ])('%s %s has no route', (method, path) => {
    expect(matchRoute(method, path)).toBeUndefined();
  });

  it.each([
    ['POST', '/aws/invoices/a/b/uploads'],
    ['GET', '/aws/invoices/uploads/job-2/extra'],
    ['GET', '/aws/invoices/2026-07/a/b'],
    ['GET', '/aws/cost-explorer/reports/r-1/extra'],
    ['POST', '/aws/cost-explorer/a/b/c'],
  ])('%s %s is deeper than any real route and has no route', (method, path) => {
    expect(matchRoute(method, path)).toBeUndefined();
  });

  it('keeps the AWS handlers deliberately broad below the depth cap', () => {
    // The handlers own their own method and subpath validation.
    expect(matchRoute('PUT', '/aws/invoices/anything')?.handler).toBe('awsInvoices');
    expect(matchRoute('GET', '/aws/invoices/a/b')?.handler).toBe('awsInvoices');
    expect(matchRoute('PATCH', '/aws/cost-explorer/whatever')?.handler).toBe('costExplorer');
    expect(matchRoute('GET', '/aws/cost-explorer/x/y')?.handler).toBe('costExplorer');
  });

  it('decodes path parameters', () => {
    expect(matchRoute('GET', '/uploads/a%20b')?.pathParameters).toEqual({ jobId: 'a b' });
  });

  it('treats malformed percent-encoding as no route instead of throwing', () => {
    expect(matchRoute('GET', '/statements/%E0%A4%A')).toBeUndefined();
  });

  it('ignores a trailing slash', () => {
    expect(matchRoute('GET', '/dashboard/')?.handler).toBe('dashboard');
  });
});
