'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api, TaskComment, WorkspaceMember } from '../lib/api-client';
import { formatDateTimeDisplay } from '../lib/i18n-labels';
import { MessageSquare, AtSign, Trash2, Send, Loader2, X } from 'lucide-react';

interface TaskCommentsSectionProps {
  workspaceId: string;
  taskId: string;
  currentUserId: string;
  userRole?: string;
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
        const msg = err instanceof Error ? err.message : 'Gagal memuat komentar';
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
      setSubmitError('Isi komentar wajib diisi.');
      return;
    }

    if (trimmed.length > 2000) {
      setSubmitError('Komentar tidak boleh lebih dari 2000 karakter.');
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
      setAriaLiveMessage('Komentar berhasil dikirim.');
      composerRef.current?.focus();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'CROSS_WORKSPACE_REFERENCE') {
        setSubmitError('Pengguna yang disebut berasal dari ruang kerja lain.');
      } else if (code === 'INVALID_MENTION_TARGET') {
        setSubmitError('Pengguna yang dipilih tidak aktif atau tidak memiliki akses ke tugas ini.');
      } else {
        const msg = err instanceof Error ? err.message : 'Komentar belum dapat dikirim.';
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
      setAriaLiveMessage('Komentar dihapus.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Komentar belum dapat dihapus.';
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
    <div className="space-y-4 border-t border-border pt-6">
      {/* Screen reader aria-live announcements */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {ariaLiveMessage}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <span>Komentar ({comments.length})</span>
        </h3>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded-md text-xs text-danger" role="alert">
          {error}
        </div>
      )}

      {deleteError && (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded-md text-xs text-danger" role="alert">
          {deleteError}
        </div>
      )}

      {/* Chronological Feed */}
      {loading ? (
        <div className="space-y-3 py-2" aria-live="polite">
          <div className="h-14 w-full animate-pulse rounded-lg bg-surface-subtle" />
          <div className="h-14 w-full animate-pulse rounded-lg bg-surface-subtle" />
        </div>
      ) : comments.length === 0 ? (
        <div className="text-center py-6 text-xs text-muted-foreground bg-surface-subtle rounded-lg">
          Belum ada komentar. Mulai percakapan di bawah.
        </div>
      ) : (
        <div className="space-y-3" role="feed" aria-label="Urutan komentar tugas">
          {comments.map((comment) => {
            const isAuthor = comment.author.id === currentUserId;
            const isAdmin = userRole === 'ADMIN';
            const canDelete = isAuthor || isAdmin;

            return (
              <article
                key={comment.id}
                className="p-3.5 bg-surface border border-border rounded-lg shadow-xs space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-foreground">
                      {comment.author.full_name}
                    </span>
                    <time dateTime={comment.created_at} className="text-[11px] text-muted-foreground">
                      {formatDateTimeDisplay(comment.created_at)}
                    </time>
                  </div>

                  {canDelete && (
                    <button
                      onClick={() => handleDelete(comment.id)}
                      disabled={deletingId === comment.id}
                      className="p-1 text-muted-foreground hover:text-danger rounded transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger"
                      aria-label={`Hapus komentar oleh ${comment.author.full_name}`}
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
                <div className="text-xs text-foreground whitespace-pre-wrap break-words">
                  {comment.content}
                </div>

                {/* Structured Mentions Tags */}
                {comment.mentions && comment.mentions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border">
                    <span className="text-[11px] text-muted-foreground font-medium">Disebut:</span>
                    {comment.mentions.map((m) => (
                      <span
                        key={m.user_id}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-primary/10 text-primary border border-primary/20"
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
                className="px-3 py-1.5 text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 rounded-md transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {loadingMore && <Loader2 className="w-3 h-3 animate-spin" />}
                Muat komentar sebelumnya
              </button>
            </div>
          )}
        </div>
      )}

      {/* Comment Composer */}
      <form onSubmit={handleSubmit} className="space-y-3 pt-2">
        {submitError && (
          <div className="p-2.5 bg-danger/10 border border-danger/30 rounded-md text-xs text-danger" role="alert">
            {submitError}
          </div>
        )}

        <div>
          <label htmlFor={`comment-composer-${taskId}`} className="block text-xs font-semibold text-foreground mb-1">
            Tulis komentar <span className="text-muted-foreground font-normal">(maks. 2000 karakter)</span>
          </label>
          <textarea
            id={`comment-composer-${taskId}`}
            ref={composerRef}
            rows={3}
            maxLength={2000}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Tulis komentar... (gunakan tombol @ untuk menyebut anggota tim)"
            className="w-full px-3 py-2 text-xs bg-surface border border-border rounded-md text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          />
        </div>

        {/* Selected Mentions Chips */}
        {selectedMentionIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground font-medium">Yang disebut:</span>
            {selectedMentionIds.map((userId) => {
              const member = workspaceMembers.find(
                (m) => (m.user_id || (m as unknown as { id?: string }).id) === userId
              );
              const name = member?.full_name || (member as unknown as { name?: string })?.name || userId;
              return (
                <span
                  key={userId}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 text-primary border border-primary/20 gap-1"
                >
                  @{name}
                  <button
                    type="button"
                    onClick={() => removeMentionUser(userId)}
                    aria-label={`Hapus sebutan ${name}`}
                    className="hover:opacity-80"
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
              className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-foreground bg-surface-subtle hover:bg-surface border border-border rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              aria-expanded={showMentionPicker}
              aria-label="Sebut anggota tim"
            >
              <AtSign className="w-3.5 h-3.5 mr-1 text-primary" />
              Sebut anggota
            </button>

            {/* Mention Candidate Dropdown */}
            {showMentionPicker && (
              <div
                className="absolute left-0 bottom-full mb-2 w-64 max-h-48 overflow-y-auto bg-surface border border-border rounded-lg shadow-lg z-20 p-2 space-y-1"
                role="listbox"
                aria-label="Anggota yang dapat disebut"
              >
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
                  Pilih anggota untuk disebut
                </div>
                {eligibleMembers.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-2">Tidak ada anggota ruang kerja aktif.</p>
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
                            ? 'bg-primary/10 text-primary font-semibold'
                            : 'hover:bg-surface-subtle text-foreground'
                        }`}
                      >
                        <span>{name}</span>
                        {isSelected && <span className="text-[10px] text-primary font-bold">✓</span>}
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
            className="inline-flex min-h-9 items-center px-4 py-1.5 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md transition disabled:opacity-50 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Mengirim...
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5 mr-1.5" />
                Kirim komentar
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
