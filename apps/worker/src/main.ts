import { parseWorkerEnv } from '@floz/config';
import { createLogger } from '@floz/observability';

const env = parseWorkerEnv(process.env);
const logger = createLogger('worker', env.LOG_LEVEL);
logger.info('worker started');
setInterval(() => logger.debug('worker heartbeat'), 60_000);
