import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min, Validate, ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

export const recurrenceFrequencies = ['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'] as const;

type RecurrenceTemplate = { title?: string; description?: string | null; workflow_id?: string; priority?: string; team_id?: string | null; assignee_ids?: string[]; primary_assignee_id?: string | null; due_time?: string | null };

@ValidatorConstraint({ name: 'exclusiveEnd', async: false })
class ExclusiveEnd implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) { const value = args.object as CreateRecurringTaskDto; return !(value.end_at && value.occurrence_limit !== undefined); }
}

@ValidatorConstraint({ name: 'noCustomFrequency', async: false })
class NoCustomFrequency implements ValidatorConstraintInterface {
  validate(value: unknown) { return value !== 'CUSTOM'; }
}

export class CreateRecurringTaskDto implements RecurrenceTemplate {
  @IsString() name!: string;
  @IsIn(recurrenceFrequencies) @Validate(NoCustomFrequency) frequency!: typeof recurrenceFrequencies[number];
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timezonePattern = /^[A-Za-z_]+(?:[\/-][A-Za-z0-9_+\-]+)+$/;

export function validateCreateRecurringTask(input: CreateRecurringTaskDto) {
  if (input.frequency === 'CUSTOM' || !input.interval_value || input.interval_value < 1 || (input.occurrence_limit !== undefined && input.occurrence_limit < 1) || (input.end_at && input.occurrence_limit !== undefined) || !input.timezone || !timezonePattern.test(input.timezone) || (input.workflow_id !== undefined && !uuidPattern.test(input.workflow_id)) || (input.team_id !== undefined && input.team_id !== null && !uuidPattern.test(input.team_id)) || (input.primary_assignee_id !== undefined && input.primary_assignee_id !== null && !uuidPattern.test(input.primary_assignee_id)) || (input.assignee_ids && input.assignee_ids.some((id) => !uuidPattern.test(id)))) throw new Error('VALIDATION_ERROR');
}

export function validateUpdateRecurrenceRule(input: UpdateRecurrenceRuleDto) {
  if (input.frequency === 'CUSTOM' || (input.interval_value !== undefined && input.interval_value < 1) || (input.occurrence_limit !== undefined && input.occurrence_limit !== null && input.occurrence_limit < 1) || (input.end_at && input.occurrence_limit !== undefined) || (input.timezone !== undefined && !timezonePattern.test(input.timezone)) || (input.workflow_id !== undefined && !uuidPattern.test(input.workflow_id)) || (input.team_id !== undefined && input.team_id !== null && !uuidPattern.test(input.team_id)) || (input.primary_assignee_id !== undefined && input.primary_assignee_id !== null && !uuidPattern.test(input.primary_assignee_id)) || (input.assignee_ids && input.assignee_ids.some((id) => !uuidPattern.test(id)))) throw new Error('VALIDATION_ERROR');
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
  @IsOptional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean() active?: boolean;
  @IsOptional() @IsUUID() team_id?: string;
  @IsOptional() @IsUUID() assignee_id?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

export function validateRecurrenceRuleQuery(input: RecurrenceRuleQueryDto) {
  const active = input.active as unknown;
  const limit = input.limit === undefined ? undefined : Number(input.limit);
  if ((active !== undefined && active !== true && active !== false && active !== 'true' && active !== 'false') || (input.team_id !== undefined && !uuidPattern.test(input.team_id)) || (input.assignee_id !== undefined && !uuidPattern.test(input.assignee_id)) || (limit !== undefined && (!Number.isInteger(limit) || limit < 1))) throw new Error('VALIDATION_ERROR');
}
