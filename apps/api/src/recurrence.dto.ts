import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min, Validate, ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

export const recurrenceFrequencies = ['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'] as const;

type RecurrenceTemplate = { title?: string; description?: string | null; workflow_id?: string; priority?: string; team_id?: string | null; assignee_ids?: string[]; primary_assignee_id?: string | null; due_time?: string | null };

@ValidatorConstraint({ name: 'exclusiveEnd', async: false })
class ExclusiveEnd implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) { const value = args.object as CreateRecurringTaskDto; return !(value.end_at && value.occurrence_limit !== undefined); }
}

export class CreateRecurringTaskDto implements RecurrenceTemplate {
  @IsString() name!: string;
  @IsIn(recurrenceFrequencies) frequency!: typeof recurrenceFrequencies[number];
  @IsInt() @Min(1) interval_value!: number;
  @IsString() @Matches(/^[A-Za-z_]+(?:[\/-][A-Za-z0-9_+\-]+)+$/) timezone!: string;
  @IsDateString() start_at!: string;
  @IsOptional() @IsDateString() @Validate(ExclusiveEnd) end_at?: string;
  @IsOptional() @IsInt() @Min(1) occurrence_limit?: number;
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsUUID() workflow_id?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsUUID() team_id?: string | null;
  @IsOptional() @IsUUID('4', { each: true }) assignee_ids?: string[];
  @IsOptional() @IsUUID() primary_assignee_id?: string | null;
  @IsOptional() @IsString() due_time?: string | null;
}

export class UpdateRecurrenceRuleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn(recurrenceFrequencies) frequency?: typeof recurrenceFrequencies[number];
  @IsOptional() @IsInt() @Min(1) interval_value?: number;
  @IsOptional() @IsString() @Matches(/^[A-Za-z_]+(?:[\/-][A-Za-z0-9_+\-]+)+$/) timezone?: string;
  @IsOptional() @IsDateString() start_at?: string;
  @IsOptional() @IsDateString() end_at?: string | null;
  @IsOptional() @IsInt() @Min(1) occurrence_limit?: number | null;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsUUID() workflow_id?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsUUID() team_id?: string | null;
  @IsOptional() @IsUUID('4', { each: true }) assignee_ids?: string[];
  @IsOptional() @IsUUID() primary_assignee_id?: string | null;
  @IsOptional() @IsString() due_time?: string | null;
}

export class RecurrenceRuleQueryDto {
  @IsOptional() active?: boolean;
  @IsOptional() @IsUUID() team_id?: string;
  @IsOptional() @IsUUID() assignee_id?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @IsInt() @Min(1) limit?: number;
}
