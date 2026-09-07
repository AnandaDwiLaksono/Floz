import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateCommentDto {
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) mentioned_user_ids?: string[];
}

export class CommentQueryDto {
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() cursor?: string;
}
