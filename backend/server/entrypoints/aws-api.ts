import { handler as awsInvoiceSummaries } from '../../functions/aws-invoice-summary-api/handler';
import { handler as awsInvoices } from '../../functions/aws-invoices-api/handler';
import { handler as costExplorer } from '../../functions/cost-explorer-api/handler';
import { logger } from '../../shared/observability';
import { startApiService } from '../start-api';

startApiService('cashight-aws-api', {
  costExplorer,
  awsInvoices,
  awsInvoiceSummaries,
}).catch((error: unknown) => {
  logger.error('startup failed', { reason: error instanceof Error ? error.message : 'unknown' });
  process.exit(1);
});
