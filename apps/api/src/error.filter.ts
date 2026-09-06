import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

const messages: Record<string, string> = {
  UNAUTHENTICATED: 'Authentication is required.',
  INVALID_CREDENTIALS: 'Invalid email or password.',
  ACCOUNT_INACTIVE: 'Account is inactive.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'Resource not found.',
  VALIDATION_ERROR: 'One or more fields are invalid.',
  CROSS_WORKSPACE_REFERENCE: 'Referenced resource does not belong to the current workspace.',
  INVALID_TRANSITION: 'The requested status change is not allowed.',
  VERSION_CONFLICT: 'Task modified by another user.',
  DUPLICATE_EMAIL: 'An account with this email already exists.',
  LAST_ACTIVE_ADMIN: 'At least one active admin is required.',
  ACTIVE_TEAM_MANAGER: 'Active team managers must remain active managers.',
  INVALID_MANAGER: 'Team manager must be an active manager or admin.',
  TEAM_ARCHIVED: 'Archived teams cannot accept members.',
  INACTIVE_APPROVER: 'Selected approver is inactive.',
  INVALID_APPROVER_TARGET: 'Selected approver is not authorized for the linked task.',
  INVALID_MENTION_TARGET: 'Mentioned user is not authorized for the linked task.',
  SELF_APPROVAL_NOT_ALLOWED: 'Self-approval is not allowed.',
  APPROVAL_NOT_PENDING: 'Approval request is no longer pending.'
};

const unprocessableCodes = new Set([
  'CROSS_WORKSPACE_REFERENCE',
  'INACTIVE_APPROVER',
  'INVALID_APPROVER_TARGET',
  'INVALID_MENTION_TARGET',
  'SELF_APPROVAL_NOT_ALLOWED'
]);

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = error instanceof HttpException ? error.message : 'INTERNAL_ERROR';
    const code = messages[raw] ? raw : status === 400 ? 'VALIDATION_ERROR' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR';
    res.status(unprocessableCodes.has(code) ? 422 : status).json({ error: { code, message: messages[code] ?? 'Internal server error.', details: [] } });
  }
}
