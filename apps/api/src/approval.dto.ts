import { IsOptional, IsString } from 'class-validator';

export class CreateApprovalRequestDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() task_id?: string;
  @IsOptional() @IsString() approver_user_id?: string;
}

export class ApprovalQueryDto {
  @IsOptional() @IsString() view?: 'inbox' | 'sent' | 'managed' | 'all';
  @IsOptional() @IsString() status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  @IsOptional() @IsString() team_id?: string;
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() cursor?: string;
}

export class ApproveStepDto {
  @IsOptional() @IsString() reason?: string;
}

export class RejectStepDto {
  @IsOptional() @IsString() reason?: string;
}

export class CancelApprovalDto {
  @IsOptional() @IsString() reason?: string;
}
