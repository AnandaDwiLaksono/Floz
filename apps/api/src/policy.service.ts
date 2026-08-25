import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  timezone: string;
  locale: string;
  isActive: boolean;
};

@Injectable()
export class PolicyService {
  requireActive(user?: SessionUser | null) {
    if (!user) throw new UnauthorizedException();
    if (!user.isActive) throw new ForbiddenException('ACCOUNT_INACTIVE');
    return user;
  }
}
