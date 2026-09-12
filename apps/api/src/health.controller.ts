import { Controller, Get, Header, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ReadinessService } from './readiness.service';

@Controller('health')
export class HealthController {
  constructor(@Inject(ReadinessService) private readonly readiness: ReadinessService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  health() {
    return { data: { status: 'ok', service: 'api' } } as const;
  }

  @Get('live')
  @Header('Cache-Control', 'no-store')
  live() {
    return this.health();
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready() {
    if (await this.readiness.check()) return { data: { status: 'ok', service: 'api' } } as const;
    throw new ServiceUnavailableException('SERVICE_UNAVAILABLE');
  }
}
