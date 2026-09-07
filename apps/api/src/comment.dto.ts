export class CreateCommentDto {
  content?: string;
  mentioned_user_ids?: string[];
}

export class CommentQueryDto {
  limit?: string;
  cursor?: string;
}
