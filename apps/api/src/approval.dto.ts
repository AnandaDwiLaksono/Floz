export class CreateApprovalRequestDto {
  title?: string;
  description?: string;
  task_id?: string;
  approver_user_id?: string;
}

export class ApprovalQueryDto {
  view?: 'inbox' | 'sent' | 'managed' | 'all';
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  team_id?: string;
  limit?: string;
  cursor?: string;
}

export class ApproveStepDto {
  reason?: string;
}

export class RejectStepDto {
  reason?: string;
}

export class CancelApprovalDto {
  reason?: string;
}
