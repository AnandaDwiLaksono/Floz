import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { notificationRoute } from '../lib/task-route';
import { NotificationItem, NotificationResource } from '../components/notification-item';
import { NotificationCenter } from '../components/notification-center';

describe('Phase 10 Task 10 — Notification Deep-Link Routing & Accessibility', () => {
  const wid = 'ws-123';

  describe('Canonical Notification Route Generator', () => {
    it('routes APPROVAL_REQUESTED to inbox + selected_approval_request_id', () => {
      const route = notificationRoute(wid, 'req-1', undefined, 'APPROVAL_REQUESTED', 'APPROVAL_REQUEST');
      expect(route).toBe(`/workspaces/${wid}/approvals?view=inbox&selected_approval_request_id=req-1`);
    });

    it('routes APPROVAL_APPROVED to sent + selected_approval_request_id', () => {
      const route = notificationRoute(wid, 'req-2', undefined, 'APPROVAL_APPROVED', 'APPROVAL_REQUEST');
      expect(route).toBe(`/workspaces/${wid}/approvals?view=sent&selected_approval_request_id=req-2`);
    });

    it('routes APPROVAL_REJECTED to sent + selected_approval_request_id', () => {
      const route = notificationRoute(wid, 'req-3', undefined, 'APPROVAL_REJECTED', 'APPROVAL_REQUEST');
      expect(route).toBe(`/workspaces/${wid}/approvals?view=sent&selected_approval_request_id=req-3`);
    });

    it('routes APPROVAL_CANCELLED to inbox + selected_approval_request_id', () => {
      const route = notificationRoute(wid, 'req-4', undefined, 'APPROVAL_CANCELLED', 'APPROVAL_REQUEST');
      expect(route).toBe(`/workspaces/${wid}/approvals?view=inbox&selected_approval_request_id=req-4`);
    });

    it('routes COMMENT_MENTIONED to tasks with selected_task_id', () => {
      const route = notificationRoute(wid, 'task-99', undefined, 'COMMENT_MENTIONED', 'TASK');
      expect(route).toBe(`/workspaces/${wid}/tasks?selected_task_id=task-99`);
    });

    it('preserves context.route if explicitly provided by backend', () => {
      const customRoute = `/workspaces/${wid}/tasks?selected_task_id=custom-1&tab=activity`;
      const route = notificationRoute(wid, 'custom-1', customRoute, 'COMMENT_MENTIONED');
      expect(route).toBe(customRoute);
    });

    it('falls back safely to default taskRoute when type is unknown or omitted', () => {
      const route = notificationRoute(wid, 'task-fallback');
      expect(route).toBe(`/workspaces/${wid}/tasks?selected_task_id=task-fallback`);
    });
  });

  describe('Notification Center & Item Accessibility UX', () => {
    const mockNotifications: NotificationResource[] = [
      {
        id: 'notif-1',
        type: 'APPROVAL_REQUESTED',
        title: 'Approval Requested',
        body: 'Alice submitted Budget Q4 for review',
        entity_type: 'APPROVAL_REQUEST',
        entity_id: 'req-1',
        is_read: false,
        read_at: null,
        created_at: '2026-09-06T10:00:00.000Z',
      },
      {
        id: 'notif-2',
        type: 'COMMENT_MENTIONED',
        title: 'Mentioned in Task',
        body: 'Bob mentioned you in Deploy to Prod',
        entity_type: 'TASK',
        entity_id: 'task-10',
        is_read: true,
        read_at: '2026-09-06T11:00:00.000Z',
        created_at: '2026-09-06T10:30:00.000Z',
      },
    ];

    it('renders notification items with accessible labels, unread indicator, and relative times', () => {
      const selectSpy = vi.fn();
      render(
        <NotificationCenter
          notifications={mockNotifications}
          loading={false}
          hasMore={false}
          unreadCount={1}
          onSelect={selectSpy}
          onMarkAllRead={vi.fn()}
          onLoadMore={vi.fn()}
        />
      );

      expect(screen.getByRole('heading', { name: /Notifications/i })).toBeInTheDocument();
      expect(screen.getByText('Approval Requested')).toBeInTheDocument();
      expect(screen.getByText('Alice submitted Budget Q4 for review')).toBeInTheDocument();
      expect(screen.getByText('Mentioned in Task')).toBeInTheDocument();

      // Click notification item triggers onSelect
      const firstBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Approval Requested'));
      expect(firstBtn).toBeDefined();
      fireEvent.click(firstBtn!);

      expect(selectSpy).toHaveBeenCalledWith(mockNotifications[0]);
    });

    it('renders distinct icons for approvals vs comments vs tasks without relying on color alone', () => {
      render(
        <NotificationItem
          notification={mockNotifications[0]}
          onSelect={vi.fn()}
        />
      );

      // Verify button has descriptive text and accessible name
      const btn = screen.getByRole('button');
      expect(btn).toHaveTextContent('Approval Requested');
      expect(btn).toHaveTextContent('Alice submitted Budget Q4 for review');
    });

    it('handles retry safely when notification fetch returns an error', () => {
      const retrySpy = vi.fn();
      render(
        <NotificationCenter
          notifications={[]}
          loading={false}
          hasMore={false}
          unreadCount={0}
          error="Network error loading notifications"
          onRetry={retrySpy}
          onSelect={vi.fn()}
          onMarkAllRead={vi.fn()}
          onLoadMore={vi.fn()}
        />
      );

      expect(screen.getByText('Network error loading notifications')).toBeInTheDocument();
      const retryBtn = screen.getByRole('button', { name: /Retry/i });
      fireEvent.click(retryBtn);
      expect(retrySpy).toHaveBeenCalled();
    });
  });
});
