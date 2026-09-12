import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';

export class StatusInput {
  @IsString()
  name!: string;

  @IsString()
  code!: string;

  @IsIn(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'])
  category!: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

  @IsBoolean()
  is_initial!: boolean;
}

export class TransitionInput {
  @IsString()
  from_status_code!: string;

  @IsString()
  to_status_code!: string;
}

export class CreateWorkflowDto {
  @IsString()
  name!: string;

  @IsString()
  code!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  team_id?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatusInput)
  statuses!: StatusInput[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransitionInput)
  transitions!: TransitionInput[];
}

export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsInt()
  version!: number;
}

export class SetWorkflowDefaultDto {
  @IsInt()
  version!: number;
}

export class ArchiveWorkflowDto {
  @IsInt()
  version!: number;
}

export class RestoreWorkflowDto {
  @IsInt()
  version!: number;
}

export class CreateStatusDto {
  @IsString()
  name!: string;

  @IsString()
  code!: string;

  @IsIn(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'])
  category!: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

  @IsInt()
  version!: number;
}

export class UpdateStatusDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'])
  category?: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

  @IsInt()
  version!: number;
}

export class SetStatusInitialDto {
  @IsInt()
  version!: number;
}

export class ArchiveStatusDto {
  @IsInt()
  version!: number;
}

export class RestoreStatusDto {
  @IsInt()
  version!: number;
}

export class ReorderStatusesDto {
  @IsArray()
  @IsString({ each: true })
  status_ids!: string[];

  @IsInt()
  version!: number;
}

export class BulkTransitionInput {
  @IsString()
  from_status_id!: string;

  @IsString()
  to_status_id!: string;

  @IsOptional()
  @IsBoolean()
  requires_permission?: boolean;
}

export class ReplaceTransitionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkTransitionInput)
  transitions!: BulkTransitionInput[];

  @IsInt()
  version!: number;
}
