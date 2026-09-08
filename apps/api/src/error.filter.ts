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
  VERSION_CONFLICT: 'Resource modified by another user.',
  DUPLICATE_EMAIL: 'An account with this email already exists.',
  LAST_ACTIVE_ADMIN: 'At least one active admin is required.',
  ACTIVE_TEAM_MANAGER: 'Active team managers must remain active managers.',
  INVALID_MANAGER: 'Team manager must be an active manager or admin.',
  TEAM_ARCHIVED: 'Archived teams cannot accept members.',
  INACTIVE_APPROVER: 'Selected approver is inactive.',
  INVALID_APPROVER_TARGET: 'Selected approver is not authorized for the linked task.',
  INVALID_MENTION_TARGET: 'Mentioned user is not authorized for the linked task.',
  SELF_APPROVAL_NOT_ALLOWED: 'Self-approval is not allowed.',
  APPROVAL_NOT_PENDING: 'Approval request is no longer pending.',
  CANNOT_ARCHIVE_DEFAULT_WORKFLOW: 'Default workflow cannot be archived.',
  CANNOT_ARCHIVE_INITIAL_STATUS: 'Initial status cannot be archived.',
  RECURRENCE_DEPENDENCY_CONFLICT: 'Active recurrence rules reference this workflow or status.',
  STATUS_CATEGORY_IN_USE: 'Cannot change status category while tasks or recurrence rules reference it.',
  DUPLICATE_WORKFLOW_CODE: 'A workflow with this code already exists in the workspace.',
  DUPLICATE_WORKFLOW_NAME: 'A workflow with this name already exists in the workspace.',
  DUPLICATE_STATUS_CODE: 'A status with this code already exists in the workflow.',
  DUPLICATE_STATUS_NAME: 'A status with this name already exists in the workflow.',
  SELF_LOOP_NOT_ALLOWED: 'Self-loop transitions are not allowed.',
  INACTIVE_TRANSITION_TARGET: 'Transition target status is inactive.',
  INVALID_STATUS_CATEGORY: 'Invalid status category.',
  WORKFLOW_SCOPE_MISMATCH: 'Workflow does not match team or workspace scope.',
  STATUS_SCOPE_MISMATCH: 'Status does not belong to workflow or is inactive.'
};

const unprocessableCodes = new Set([
  'CROSS_WORKSPACE_REFERENCE',
  'INACTIVE_APPROVER',
  'INVALID_APPROVER_TARGET',
  'INVALID_MENTION_TARGET',
  'SELF_APPROVAL_NOT_ALLOWED',
  'INVALID_TRANSITION',
  'SELF_LOOP_NOT_ALLOWED',
  'INACTIVE_TRANSITION_TARGET',
  'INVALID_STATUS_CATEGORY',
  'WORKFLOW_SCOPE_MISMATCH'
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
