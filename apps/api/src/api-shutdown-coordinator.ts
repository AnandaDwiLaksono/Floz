import type { INestApplication } from '@nestjs/common';
import type { ReadinessService } from './readiness.service.js';

export type ShutdownServer = {
  close(callback: (error?: Error) => void): unknown;
  closeIdleConnections(): void;
  closeAllConnections(): void;
};

type Dependencies = {
  sleep?: (milliseconds: number) => Promise<void>;
  exit?: (code: number) => void;
};

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

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
    const wait = this.dependencies.sleep ?? sleep;
    const exit = this.dependencies.exit ?? process.exit;
    const closed = new Promise<void>((resolve) => {
      this.server.close(() => resolve());
      this.server.closeIdleConnections();
    });
    const outer = wait(35000).then(() => 'outer' as const);
    const result = await Promise.race([
      closed.then(() => 'drained' as const),
      wait(30000).then(() => 'drain-timeout' as const),
      outer
    ]);
    const forced = result !== 'drained';
    if (forced) this.server.closeAllConnections();
    const cleanup = this.app.close();
    const cleaned = await Promise.race([
      cleanup.then(() => true, () => false),
      outer.then(() => false)
    ]);
    exit(forced || !cleaned ? 1 : 0);
  }
}
