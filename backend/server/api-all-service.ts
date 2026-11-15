import { handler as awsInvoiceSummaries } from '../functions/aws-invoice-summary-api/handler';
import { handler as awsInvoices } from '../functions/aws-invoices-api/handler';
import { handler as costExplorer } from '../functions/cost-explorer-api/handler';
import { handler as dashboard } from '../functions/dashboard-api/handler';
import { handler as sessionCapabilities } from '../functions/session-capabilities-api/handler';
import { handler as statements } from '../functions/statements-api/handler';
import { handler as summaries } from '../functions/summary-api/handler';
import { handler as uploadStatus } from '../functions/upload-status-api/handler';
import { handler as uploads } from '../functions/uploads-api/handler';
import { aiSummaryEnabled } from '../shared/config';
import type { ApiHandler } from './http-server';
import type { HandlerName } from './routes';

type Environment = Record<string, string | undefined>;

/**
 * The merged API used by v2 minimal: the `api` and `aws-api` route sets in one
 * process. With AI summaries off, the two summary routes are not registered
 * (so they answer 404) and the Gemini key is no longer required.
 */
export function apiAllService(env: Environment = process.env): {
  handlers: Partial<Record<HandlerName, ApiHandler>>;
  requiredEnv: readonly string[];
} {
  const handlers: Partial<Record<HandlerName, ApiHandler>> = {
    uploads,
    uploadStatus,
    statements,
    dashboard,
    sessionCapabilities,
    costExplorer,
    awsInvoices,
  };
  const requiredEnv = ['TABLE_NAME', 'STATEMENTS_BUCKET', 'UPLOAD_BUCKET', 'EXPORT_BUCKET'];
  if (aiSummaryEnabled(env)) {
    handlers.summaries = summaries;
    handlers.awsInvoiceSummaries = awsInvoiceSummaries;
    requiredEnv.push('GEMINI_PARAM');
  }
  return { handlers, requiredEnv };
}
