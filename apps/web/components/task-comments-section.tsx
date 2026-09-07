'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api, TaskComment, WorkspaceMember } from '../lib/api-client';
import { MessageSquare, AtSign, Trash2, Send, Loader2, X } from 'lucide-react';

interface TaskCommentsSectionProps {
  workspaceId: string;
  taskId: string;
  currentUserId: string;
  userRole: string;
  workspaceMembers: WorkspaceMember[];
}

export function TaskCommentsSection({
  workspaceId,
  taskId,
  currentUserId,
  userRole,
  workspaceMembers,
}: TaskCommentsSectionProps) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Composer State
  const [content, setContent] = useState('');
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([]);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ariaLiveMessage, setAriaLiveMessage] = useState<string>('');

  // Delete State
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionPickerRef = useRef<HTMLDivElement | null>(null);

  // Fetch comments
  const fetchComments = useCallback(
    async (cursor?: string) => {
      if (cursor) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const res = await api.comments.list(workspaceId, taskId, {
          limit: 50,
          cursor: cursor || undefined,
        });

        if (cursor) {
          setComments((prev) => {
            // Ensure no duplicate IDs when appending
            const existingIds = new Set(prev.map((c) => c.id));
            const newComments = res.data.filter((c) => !existingIds.has(c.id));
            return [...prev, ...newComments];
          });
        } else {
          setComments(res.data);
        }

        setHasMore(res.meta.pagination.has_more);
        setNextCursor(res.meta.pagination.next_cursor);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to load comments';
        setError(msg);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [workspaceId, taskId]
  );

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Handle mention selection toggle
  const toggleMentionUser = (userId: string) => {
    setSelectedMentionIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const removeMentionUser = (userId: string) => {
    setSelectedMentionIds((prev) => prev.filter((id) => id !== userId));
  };

  // Keyboard navigation for mention picker
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showMentionPicker) {
        setShowMentionPicker(false);
        composerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showMentionPicker]);

  // Submit comment
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();

    if (!trimmed) {
      setSubmitError('Comment content cannot be empty.');
      return;
    }

    if (trimmed.length > 2000) {
      setSubmitError('Comment content cannot exceed 2000 characters.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      // Deduplicate selection IDs client-side
      const deduplicatedMentions = Array.from(new Set(selectedMentionIds));
      const res = await api.comments.create(workspaceId, taskId, {
        content: trimmed,
        mentioned_user_ids: deduplicatedMentions.length ? deduplicatedMentions : undefined,
      });

      // Append new comment preserving chronological ASC order
      setComments((prev) => {
        if (prev.some((c) => c.id === res.data.id)) return prev;
        return [...prev, res.data];
      });

      setContent('');
      setSelectedMentionIds([]);
      setShowMentionPicker(false);
      setAriaLiveMessage('Comment posted successfully.');
      composerRef.current?.focus();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'CROSS_WORKSPACE_REFERENCE') {
        setSubmitError('Referenced user belongs to another workspace.');
      } else if (code === 'INVALID_MENTION_TARGET') {
        setSubmitError('Selected mentioned user is inactive or does not have access to this task.');
      } else {
        const msg = err instanceof Error ? err.message : 'Failed to post comment.';
        setSubmitError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Delete comment
  const handleDelete = async (commentId: string) => {
    setDeletingId(commentId);
    setDeleteError(null);

    try {
      await api.comments.delete(workspaceId, taskId, commentId);
      // Soft-deleted comment is removed from normal feed
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setAriaLiveMessage('Comment deleted.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete comment.';
      setDeleteError(msg);
    } finally {
      setDeletingId(null);
    }
  };

  const eligibleMembers = workspaceMembers.filter((m) => {
    const isActive = (m as unknown as { is_active?: boolean }).is_active ?? true;
    const status = m.status || (m as unknown as { membership_status?: string }).membership_status;
    return (status === 'ACTIVE' || status === undefined) && isActive !== false;
  });

  return (
    <div className="space-y-4 border-t border-gray-200 dark:border-gray-800 pt-6">
      {/* Screen reader aria-live announcements */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {ariaLiveMessage}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-blue-600" />
          <span>Comments ({comments.length})</span>
        </h3>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-md text-xs text-red-700 dark:text-red-300" role="alert">
          {error}
        </div>
      )}

      {deleteError && (
        <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-md text-xs text-red-700 dark:text-red-300" role="alert">
          {deleteError}
        </div>
      )}

      {/* Chronological Feed */}
      {loading ? (
        <div className="flex justify-center py-6" aria-live="polite">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
        </div>
      ) : comments.length === 0 ? (
        <div className="text-center py-6 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/40 rounded-lg">
          No comments yet. Start the conversation below.
        </div>
      ) : (
        <div className="space-y-3" role="feed" aria-label="Task comments chronological feed">
          {comments.map((comment) => {
            const isAuthor = comment.author.id === currentUserId;
            const isAdmin = userRole === 'ADMIN';
            const canDelete = isAuthor || isAdmin;

            return (
              <article
                key={comment.id}
                className="p-3.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-sm space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-gray-900 dark:text-white">
                      {comment.author.full_name}
                    </span>
                    <time dateTime={comment.created_at} className="text-[11px] text-gray-400">
                      {new Date(comment.created_at).toLocaleString()}
                    </time>
                  </div>

                  {canDelete && (
                    <button
                      onClick={() => handleDelete(comment.id)}
                      disabled={deletingId === comment.id}
                      className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded transition focus:outline-none focus:ring-1 focus:ring-red-500"
                      aria-label={`Delete comment by ${comment.author.full_name}`}
                    >
                      {deletingId === comment.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>

                {/* Content - plain text with whitespace/newlines preserved and safe React escaping */}
                <div className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                  {comment.content}
                </div>

                {/* Structured Mentions Tags */}
                {comment.mentions && comment.mentions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-gray-100 dark:border-gray-800/60">
                    <span className="text-[11px] text-gray-400 font-medium">Mentioned:</span>
                    {comment.mentions.map((m) => (
                      <span
                        key={m.user_id}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                      >
                        @{m.full_name}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            );
          })}

          {/* Load More Pagination Button */}
          {hasMore && nextCursor && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => fetchComments(nextCursor)}
                disabled={loadingMore}
                className="px-3 py-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 rounded-md transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {loadingMore && <Loader2 className="w-3 h-3 animate-spin" />}
                Load Earlier Comments
              </button>
            </div>
          )}
        </div>
      )}

      {/* Comment Composer */}
      <form onSubmit={handleSubmit} className="space-y-3 pt-2">
        {submitError && (
          <div className="p-2.5 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-md text-xs text-red-700 dark:text-red-300" role="alert">
            {submitError}
          </div>
        )}

        <div>
          <label htmlFor={`comment-composer-${taskId}`} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Add a Comment <span className="text-gray-400 font-normal">(Max 2000 chars)</span>
          </label>
          <textarea
            id={`comment-composer-${taskId}`}
            ref={composerRef}
            rows={3}
            maxLength={2000}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write a comment... (use @ button to mention team members)"
            className="w-full px-3 py-2 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Selected Mentions Chips */}
        {selectedMentionIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-gray-500 font-medium">Selected Mentions:</span>
            {selectedMentionIds.map((userId) => {
              const member = workspaceMembers.find(
                (m) => (m.user_id || (m as unknown as { id?: string }).id) === userId
              );
              const name = member?.full_name || (member as unknown as { name?: string })?.name || userId;
              return (
                <span
                  key={userId}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 gap-1"
                >
                  @{name}
                  <button
                    type="button"
                    onClick={() => removeMentionUser(userId)}
                    aria-label={`Remove mention for ${name}`}
                    className="hover:text-blue-900 dark:hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Mention Selector Toggle & Submit Bar */}
        <div className="flex items-center justify-between pt-1">
          <div className="relative" ref={mentionPickerRef}>
            <button
              type="button"
              onClick={() => setShowMentionPicker((prev) => !prev)}
              className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-expanded={showMentionPicker}
              aria-label="Mention team member"
            >
              <AtSign className="w-3.5 h-3.5 mr-1 text-blue-600" />
              Mention Member
            </button>

            {/* Mention Candidate Dropdown */}
            {showMentionPicker && (
              <div
                className="absolute left-0 bottom-full mb-2 w-64 max-h-48 overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-xl z-20 p-2 space-y-1"
                role="listbox"
                aria-label="Eligible mention candidates"
              >
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 py-1">
                  Select Members to Mention
                </div>
                {eligibleMembers.length === 0 ? (
                  <p className="text-xs text-gray-500 p-2">No active workspace members.</p>
                ) : (
                  eligibleMembers.map((m) => {
                    const id = m.user_id || (m as unknown as { id?: string }).id || '';
                    const name = m.full_name || (m as unknown as { name?: string }).name || id;
                    const isSelected = selectedMentionIds.includes(id);

                    return (
                      <button
                        key={id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => toggleMentionUser(id)}
                        className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between transition ${
                          isSelected
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 font-semibold'
                            : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200'
                        }`}
                      >
                        <span>{name}</span>
                        {isSelected && <span className="text-[10px] text-blue-600 font-bold">✓</span>}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting || !content.trim()}
            className="inline-flex items-center px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Posting...
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5 mr-1.5" />
                Post Comment
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
