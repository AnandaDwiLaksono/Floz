import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from './auth.js';

type Probe = Promise<unknown> & { cancel?: () => void };

@Injectable()
export class ReadinessService {
  private stopping = false;
  private pending?: Promise<boolean>;

  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  stop() {
    this.stopping = true;
  }

  check(): Promise<boolean> {
    if (this.stopping) return Promise.resolve(false);
    return this.pending ??= this.probe().finally(() => { this.pending = undefined; });
  }

  private async probe(): Promise<boolean> {
    const query = this.authService.database.sql`SELECT 1` as Probe;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      query.cancel?.();
    }, 2000);

    try {
      await query;
      return !timedOut && !this.stopping;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
