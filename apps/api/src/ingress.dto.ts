import { Body, ValidationPipe, type Type } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export const ValidatedBody = (dtoClass: Type<object>) =>
  Body(
    new ValidationPipe({
      expectedType: dtoClass,
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false }
    })
  );

export class LoginDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  password?: string;
}

export class ProvisionAccountDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  full_name?: string;
}

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  full_name?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string | null;
}

export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  current_password?: string;

  @IsOptional()
  @IsString()
  new_password?: string;
}

export class PatchWorkspaceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}

export class AddMemberDto {
  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class PatchMemberDto {
  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateTeamDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  manager_user_id?: string | null;
}

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  manager_user_id?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class AddTeamMemberDto {
  @IsOptional()
  @IsString()
  user_id?: string;
}
