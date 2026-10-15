import { handler } from '../../functions/invoice-parser-worker/handler';
import { logger } from '../../shared/observability';
import { startWorkerService } from '../start-worker';

startWorkerService('cashight-invoice-parser-worker', handler, [
  'TABLE_NAME',
  'UPLOAD_BUCKET',
  'STATEMENTS_BUCKET',
]).catch((error: unknown) => {
  logger.error('startup failed', { reason: error instanceof Error ? error.message : 'unknown' });
  process.exit(1);
});
