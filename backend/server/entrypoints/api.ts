import { handler as dashboard } from '../../functions/dashboard-api/handler';
import { handler as sessionCapabilities } from '../../functions/session-capabilities-api/handler';
import { handler as statements } from '../../functions/statements-api/handler';
import { handler as summaries } from '../../functions/summary-api/handler';
import { handler as uploadStatus } from '../../functions/upload-status-api/handler';
import { handler as uploads } from '../../functions/uploads-api/handler';
import { logger } from '../../shared/observability';
import { startApiService } from '../start-api';

startApiService('cashight-api', {
  uploads,
  uploadStatus,
  statements,
  dashboard,
  sessionCapabilities,
  summaries,
}).catch((error: unknown) => {
  logger.error('startup failed', { reason: error instanceof Error ? error.message : 'unknown' });
  process.exit(1);
});
