import { BadRequestException } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';

export class ListNotificationsQueryDto {
  read?: string;
  limit?: number;
  cursor?: string;
}

export class PatchNotificationDto {
  @IsOptional()
  @IsBoolean()
  is_read?: boolean;

  @IsOptional()
  @IsBoolean()
  isRead?: boolean;
}

export function validateListNotificationsQuery(query: ListNotificationsQueryDto): { read?: boolean; limit: number; cursor?: string } {
  let read: boolean | undefined = undefined;
  if (query.read !== undefined) {
    if (query.read === 'true') {
      read = true;
    } else if (query.read === 'false') {
      read = false;
    } else {
      throw new BadRequestException('VALIDATION_ERROR');
    }
  }

  let limit = 50;
  if (query.limit !== undefined) {
    const parsedLimit = Number(query.limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new BadRequestException('VALIDATION_ERROR');
    }
    limit = parsedLimit;
  }

  return {
    read,
    limit,
    cursor: query.cursor ? String(query.cursor) : undefined,
  };
}

export function validatePatchNotification(body: PatchNotificationDto): { isRead: true } {
  const isRead = body?.is_read ?? body?.isRead;
  if (isRead !== true) {
    throw new BadRequestException('VALIDATION_ERROR');
  }
  return { isRead: true };
}
