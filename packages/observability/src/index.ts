import pino from 'pino';

export const createLogger = (service: string, level = 'info') => pino({ level, base: { service } });
