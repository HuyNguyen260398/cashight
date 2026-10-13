/**
 * The API route table, shared by the container HTTP server and the local dev
 * server. It mirrors terraform/api-openapi.yaml.tftpl: API Gateway used to do
 * this dispatch. The cost-explorer and invoices handlers own their own
 * method/subpath validation, so their entries are deliberately broad.
 */
export type HandlerName =
  | 'uploads'
  | 'uploadStatus'
  | 'statements'
  | 'dashboard'
  | 'sessionCapabilities'
  | 'summaries'
  | 'costExplorer'
  | 'awsInvoices'
  | 'awsInvoiceSummaries';

export interface RouteMatch {
  handler: HandlerName;
  pathParameters: Record<string, string>;
  readsBody: boolean;
}

function decodeSegments(pathname: string): string[] | undefined {
  const segments: string[] = [];
  for (const part of pathname.split('/')) {
    if (!part) continue;
    try {
      segments.push(decodeURIComponent(part));
    } catch {
      return undefined;
    }
  }
  return segments;
}

function match(
  handler: HandlerName,
  pathParameters: Record<string, string> = {},
  readsBody = false,
): RouteMatch {
  return { handler, pathParameters, readsBody };
}

export function matchRoute(method: string, pathname: string): RouteMatch | undefined {
  const segments = decodeSegments(pathname);
  if (!segments) return undefined;
  const [first, second, third, fourth] = segments;
  const count = segments.length;

  if (first === 'uploads') {
    if (method === 'POST' && count === 1) return match('uploads', {}, true);
    if (method === 'GET' && count === 2) return match('uploadStatus', { jobId: second });
    return undefined;
  }

  if (first === 'statements') {
    if (method === 'GET' && count === 1) return match('statements');
    if ((method === 'GET' || method === 'DELETE') && count === 2) {
      return match('statements', { statementId: second });
    }
    return undefined;
  }

  if (first === 'dashboard') {
    return method === 'GET' && count === 1 ? match('dashboard') : undefined;
  }

  if (first === 'session') {
    return method === 'GET' && second === 'capabilities' && count === 2
      ? match('sessionCapabilities')
      : undefined;
  }

  if (first === 'summaries') {
    return method === 'POST' && count === 1 ? match('summaries', {}, true) : undefined;
  }

  // Deepest real route has four segments; deeper paths are no route.
  if (first === 'aws' && second === 'cost-explorer' && count >= 3 && count <= 4) {
    const pathParameters: Record<string, string> =
      third === 'reports' && fourth ? { reportId: fourth } : {};
    return match('costExplorer', pathParameters, method === 'POST');
  }

  if (first === 'aws' && second === 'invoices' && count <= 4) {
    if (method === 'POST' && third === 'summary' && count === 3) {
      return match('awsInvoiceSummaries', {}, true);
    }
    const pathParameters: Record<string, string> = {};
    if (third === 'uploads' && fourth) pathParameters.jobId = fourth;
    else if (third && third !== 'uploads' && third !== 'dashboard') {
      pathParameters.yearMonth = third;
    }
    return match('awsInvoices', pathParameters, method === 'POST');
  }

  return undefined;
}
