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
  DUPLICATE_EMAIL: 'An account with this email already exists.'
};

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = error instanceof HttpException ? error.message : 'INTERNAL_ERROR';
    const code = messages[raw] ? raw : status === 400 ? 'VALIDATION_ERROR' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR';
    res.status(code === 'CROSS_WORKSPACE_REFERENCE' ? 422 : status).json({ error: { code, message: messages[code] ?? 'Internal server error.', details: [] } });
  }
}
