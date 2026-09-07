import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskCommentsSection } from '../components/task-comments-section';
import { api, TaskComment, WorkspaceMember } from '../lib/api-client';

const mockMembers: WorkspaceMember[] = [
  {
    user_id: 'user-1',
    full_name: 'Current User',
    email: 'user1@example.com',
    role: 'MEMBER',
    status: 'ACTIVE',
  },
  {
    user_id: 'user-2',
    full_name: 'Alice Colleague',
    email: 'alice@example.com',
    role: 'MEMBER',
    status: 'ACTIVE',
  },
  {
    user_id: 'user-3',
    full_name: 'Bob Manager',
    email: 'bob@example.com',
    role: 'MANAGER',
    status: 'ACTIVE',
  },
  {
    user_id: 'user-inactive',
    full_name: 'Inactive User',
    email: 'inactive@example.com',
    role: 'MEMBER',
    status: 'SUSPENDED',
  },
];

const mockComments: TaskComment[] = [
  {
    id: 'comm-1',
    workspace_id: 'ws-1',
    task_id: 'task-1',
    author: { id: 'user-2', full_name: 'Alice Colleague' },
    content: 'First comment in thread with\nnewline and   spaces',
    created_at: '2026-09-06T10:00:00.000Z',
    updated_at: '2026-09-06T10:00:00.000Z',
    mentions: [],
  },
  {
    id: 'comm-2',
    workspace_id: 'ws-1',
    task_id: 'task-1',
    author: { id: 'user-1', full_name: 'Current User' },
    content: 'Second comment tagging Alice',
    created_at: '2026-09-06T11:00:00.000Z',
    updated_at: '2026-09-06T11:00:00.000Z',
    mentions: [{ user_id: 'user-2', full_name: 'Alice Colleague' }],
  },
];

describe('Phase 10 Task 9 — Task Comments & Structured Mentions UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api.comments, 'list').mockResolvedValue({
      data: mockComments,
      meta: { pagination: { limit: 50, next_cursor: null, has_more: false } },
    });
  });

  it('renders comments chronologically and safely preserves newlines and whitespace', async () => {
    render(
      <TaskCommentsSection
        workspaceId="ws-1"
        taskId="task-1"
        currentUserId="user-1"
        userRole="MEMBER"
        workspaceMembers={mockMembers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/First comment in thread/i)).toBeInTheDocument();
    });

    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(2);
    expect(within(articles[0]).getByText(/First comment in thread/i)).toBeInTheDocument();
    expect(within(articles[1]).getByText(/Second comment tagging Alice/i)).toBeInTheDocument();

    // Check whitespace preservation
    expect(articles[0].textContent).toContain('with\nnewline and   spaces');
  });

  it('blocks empty comments or whitespace-only comments from submission', async () => {
    const createSpy = vi.spyOn(api.comments, 'create');
    render(
      <TaskCommentsSection
        workspaceId="ws-1"
        taskId="task-1"
        currentUserId="user-1"
        userRole="MEMBER"
        workspaceMembers={mockMembers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/First comment in thread/i)).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: /Post Comment/i });
    expect(submitBtn).toBeDisabled();

    const textarea = screen.getByLabelText(/Add a Comment/i);
    fireEvent.change(textarea, { target: { value: '    ' } });
    expect(submitBtn).toBeDisabled();

    fireEvent.click(submitBtn);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('submits trimmed comment with structured mentions and deduplicates mention payload', async () => {
    const newComment: TaskComment = {
      id: 'comm-3',
      workspace_id: 'ws-1',
      task_id: 'task-1',
      author: { id: 'user-1', full_name: 'Current User' },
      content: 'Here is the progress report.',
      created_at: '2026-09-06T12:00:00.000Z',
      updated_at: '2026-09-06T12:00:00.000Z',
      mentions: [
        { user_id: 'user-2', full_name: 'Alice Colleague' },
        { user_id: 'user-3', full_name: 'Bob Manager' },
      ],
    };

    const createSpy = vi.spyOn(api.comments, 'create').mockResolvedValue({
      data: newComment,
    });

    render(
      <TaskCommentsSection
        workspaceId="ws-1"
        taskId="task-1"
        currentUserId="user-1"
        userRole="MEMBER"
        workspaceMembers={mockMembers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/First comment in thread/i)).toBeInTheDocument();
    });

    // Enter comment content
    const textarea = screen.getByLabelText(/Add a Comment/i);
    fireEvent.change(textarea, { target: { value: '  Here is the progress report.  ' } });

    // Open mention picker
    const mentionBtn = screen.getByRole('button', { name: /Mention team member/i });
    fireEvent.click(mentionBtn);

    // Select Alice Colleague
    const aliceOption = screen.getByRole('option', { name: /Alice Colleague/i });
    fireEvent.click(aliceOption);

    // Select Bob Manager
    const bobOption = screen.getByRole('option', { name: /Bob Manager/i });
    fireEvent.click(bobOption);

    // Submit comment
    const submitBtn = screen.getByRole('button', { name: /Post Comment/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith('ws-1', 'task-1', {
        content: 'Here is the progress report.',
        mentioned_user_ids: ['user-2', 'user-3'],
      });
    });

    // Verify comment is appended to list
    expect(screen.getByText('Here is the progress report.')).toBeInTheDocument();
    expect(screen.getAllByText('@Alice Colleague').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('@Bob Manager')).toBeInTheDocument();
  });

  it('allows self-mention without generating self-notification expectation', async () => {
    const createSpy = vi.spyOn(api.comments, 'create').mockResolvedValue({
      data: {
        id: 'comm-self',
        workspace_id: 'ws-1',
        task_id: 'task-1',
        author: { id: 'user-1', full_name: 'Current User' },
        content: 'Taking this sub-task.',
        created_at: '2026-09-06T13:00:00.000Z',
        updated_at: '2026-09-06T13:00:00.000Z',
        mentions: [{ user_id: 'user-1', full_name: 'Current User' }],
      },
    });

    render(
      <TaskCommentsSection
        workspaceId="ws-1"
        taskId="task-1"
        currentUserId="user-1"
        userRole="MEMBER"
        workspaceMembers={mockMembers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/First comment in thread/i)).toBeInTheDocument();
    });

    const textarea = screen.getByLabelText(/Add a Comment/i);
    fireEvent.change(textarea, { target: { value: 'Taking this sub-task.' } });

    // Open mention picker and select self
    const mentionBtn = screen.getByRole('button', { name: /Mention team member/i });
    fireEvent.click(mentionBtn);

    const selfOption = screen.getByRole('option', { name: /Current User/i });
    fireEvent.click(selfOption);

    const submitBtn = screen.getByRole('button', { name: /Post Comment/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith('ws-1', 'task-1', {
        content: 'Taking this sub-task.',
        mentioned_user_ids: ['user-1'],
      });
    });
  });

  it('renders backend validation errors when mention target is invalid or cross-workspace', async () => {
    const error422 = new Error('INVALID_MENTION_TARGET');
    (error422 as unknown as { code: string }).code = 'INVALID_MENTION_TARGET';
    vi.spyOn(api.comments, 'create').mockRejectedValueOnce(error422);

    render(
      <TaskCommentsSection
        workspaceId="ws-1"
        taskId="task-1"
        currentUserId="user-1"
        userRole="MEMBER"
        workspaceMembers={mockMembers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/First comment in thread/i)).toBeInTheDocument();
    });

    const textarea = screen.getByLabelText(/Add a Comment/i);
    fireEvent.change(textarea, { target: { value: 'Tagging invalid user' } });

    const submitBtn = screen.getByRole('button', { name: /Post Comment/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Selected mentioned user is inactive or does not have access to this task/i)
      ).toBeInTheDocument();
    });
  });

  it('allows author to delete own comment and removes it from feed', async () => {
    const deleteSpy = vi.spyOn(api.comments, 'delete').mockResolvedValue();

    render(
      <TaskCommentsSection
        workspaceId="ws-1"
        taskId="task-1"
        currentUserId="user-1" // Author of comm-2
        userRole="MEMBER"
        workspaceMembers={mockMembers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Second comment tagging Alice')).toBeInTheDocument();
    });

    // Delete button for own comment (comm-2)
    const deleteBtn = screen.getByRole('button', { name: /Delete comment by Current User/i });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('ws-1', 'task-1', 'comm-2');
    });

    // Comment is removed from feed
    expect(screen.queryByText('Second comment tagging Alice')).not.toBeInTheDocument();
  });

  it('allows ADMIN to delete any comment', async () => {
    const deleteSpy = vi.spyOn(api.comments, 'delete').mockResolvedValue();

    render(
      <TaskCommentsSection
        workspaceId="ws-1"
        taskId="task-1"
        currentUserId="admin-user"
        userRole="ADMIN"
        workspaceMembers={mockMembers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/First comment in thread/i)).toBeInTheDocument();
    });

    // Admin can delete Alice's comment
    const deleteAliceBtn = screen.getByRole('button', { name: /Delete comment by Alice Colleague/i });
    expect(deleteAliceBtn).toBeInTheDocument();
    fireEvent.click(deleteAliceBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('ws-1', 'task-1', 'comm-1');
    });

    expect(screen.queryByText(/First comment in thread/i)).not.toBeInTheDocument();
  });

  it('hides delete button for unrelated non-author non-ADMIN member', async () => {
    render(
      <TaskCommentsSection
        workspaceId="ws-1"
        taskId="task-1"
        currentUserId="user-3" // Neither author of comm-1 nor admin
        userRole="MEMBER"
        workspaceMembers={mockMembers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/First comment in thread/i)).toBeInTheDocument();
    });

    // Delete button for Alice's comment should NOT exist for user-3
    expect(screen.queryByRole('button', { name: /Delete comment by Alice Colleague/i })).not.toBeInTheDocument();
  });

  it('supports pagination / loading earlier comments without duplicating items', async () => {
    const listSpy = vi.spyOn(api.comments, 'list').mockResolvedValueOnce({
      data: [mockComments[1]], // Initial page returns comm-2
      meta: { pagination: { limit: 50, next_cursor: 'cursor-123', has_more: true } },
    });

    render(
      <TaskCommentsSection
        workspaceId="ws-1"
        taskId="task-1"
        currentUserId="user-1"
        userRole="MEMBER"
        workspaceMembers={mockMembers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Second comment tagging Alice')).toBeInTheDocument();
    });

    const loadMoreBtn = screen.getByRole('button', { name: /Load Earlier Comments/i });
    expect(loadMoreBtn).toBeInTheDocument();

    // Mock next page response
    listSpy.mockResolvedValueOnce({
      data: [mockComments[0]], // Earlier page returns comm-1
      meta: { pagination: { limit: 50, next_cursor: null, has_more: false } },
    });

    fireEvent.click(loadMoreBtn);

    await waitFor(() => {
      expect(screen.getByText(/First comment in thread/i)).toBeInTheDocument();
    });

    // Both comments visible
    expect(screen.getByText('Second comment tagging Alice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Load Earlier Comments/i })).not.toBeInTheDocument();
  });
});
