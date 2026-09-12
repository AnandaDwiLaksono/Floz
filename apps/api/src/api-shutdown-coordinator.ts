import type { INestApplication } from '@nestjs/common';
import type { ReadinessService } from './readiness.service.js';

export type ShutdownServer = {
  close(callback: (error?: Error) => void): unknown;
  closeIdleConnections(): void;
  closeAllConnections(): void;
};

type Dependencies = {
  exit?: (code: number) => void;
  hardTerminate?: () => void;
  forceTimeoutMs?: number;
  hardDeadlineMs?: number;
};

export const SHUTDOWN_FORCE_TIMEOUT_MS = 30000;
export const SHUTDOWN_HARD_DEADLINE_MS = 35000;

export class ApiShutdownCoordinator {
  private operation?: Promise<void>;

  constructor(
    private readonly app: Pick<INestApplication, 'close'>,
    private readonly server: ShutdownServer,
    private readonly readiness: Pick<ReadinessService, 'stop'>,
    private readonly dependencies: Dependencies = {}
  ) {}

  install(signals: Pick<NodeJS.Process, 'once'> = process) {
    signals.once('SIGINT', () => void this.shutdown());
    signals.once('SIGTERM', () => void this.shutdown());
  }

  admissionGate(_request: unknown, response: { status(code: number): { end(): void } }, next: () => void) {
    if (this.operation) {
      response.status(503).end();
      return;
    }
    next();
  }

  shutdown(): Promise<void> {
    return this.operation ??= this.stop();
  }

  private async stop() {
    this.readiness.stop();
    const exit = this.dependencies.exit ?? process.exit;
    const hardTerminate = this.dependencies.hardTerminate ?? (() => process.exit(1));
    const forceTimeoutMs = this.dependencies.forceTimeoutMs ?? SHUTDOWN_FORCE_TIMEOUT_MS;
    const hardDeadlineMs = this.dependencies.hardDeadlineMs ?? SHUTDOWN_HARD_DEADLINE_MS;
    let forced = false;
    const forceTimer = setTimeout(() => {
      forced = true;
      this.server.closeAllConnections();
    }, forceTimeoutMs);
    const hardTimer = setTimeout(hardTerminate, hardDeadlineMs);
    try {
      const closed = new Promise<void>((resolve) => this.server.close(() => resolve()));
      this.server.closeIdleConnections();
      await closed;
      clearTimeout(forceTimer);
      let cleanupFailed = false;
      try {
        await this.app.close();
      } catch {
        cleanupFailed = true;
      }
      clearTimeout(hardTimer);
      exit(forced || cleanupFailed ? 1 : 0);
    } finally {
      clearTimeout(forceTimer);
      clearTimeout(hardTimer);
    }
  }
}
