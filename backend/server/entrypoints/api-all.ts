import { logger } from '../../shared/observability';
import { apiAllService } from '../api-all-service';
import { startApiService } from '../start-api';

const { handlers, requiredEnv } = apiAllService();

startApiService('cashight-api', handlers, requiredEnv).catch((error: unknown) => {
  logger.error('startup failed', { reason: error instanceof Error ? error.message : 'unknown' });
  process.exit(1);
});
