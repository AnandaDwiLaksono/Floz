import { Injectable } from '@nestjs/common';

@Injectable()
export class ReportingClock {
  now() {
    const fixed = process.env.NODE_ENV === 'test' ? process.env.FLOZ_TEST_REPORTING_NOW : undefined;
    const date = fixed ? new Date(fixed) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
}
