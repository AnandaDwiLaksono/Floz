'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError, MyWorkTask } from '../../../../lib/api-client';
import { getCalendarRange, getTodayInTimezone, shiftCalendarDate } from '../../../../lib/calendar-time';
import { useAuth } from '../../../../lib/auth-context';
import { taskRoute } from '../../../../lib/task-route';

type TaskSectionProps = {
  title: string;
  tasks: MyWorkTask[];
  empty: string;
  href: string;
  onOpen: (id: string) => void;
  onQuickStatus: (task: MyWorkTask) => void;
  activeQuickTaskId: string | null;
  loadingQuickStatus: boolean;
  quickTransitions: { to_status_id: string; code: string; name: string }[];
  quickError: string | null;
  onTransition: (toStatusId: string) => void;
  onCloseQuickStatus: () => void;
};

function TaskSection({
  title,
  tasks,
  empty,
  href,
  onOpen,
  onQuickStatus,
  activeQuickTaskId,
  loadingQuickStatus,
  quickTransitions,
  quickError,
  onTransition,
  onCloseQuickStatus,
}: TaskSectionProps) {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm dark:bg-gray-900">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-semibold">
          {title} <span className="text-sm text-gray-500">({tasks.length})</span>
        </h3>
        <Link className="text-sm text-blue-600 hover:underline" href={href}>
          View all {title.toLowerCase()}
        </Link>
      </div>
      {tasks.length ? (
        <ul className="space-y-3">
          {tasks.map((task) => {
            const isActive = activeQuickTaskId === task.id;
            return (
              <li key={task.id} className="rounded border p-3 dark:border-gray-800">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <button
                    type="button"
                    aria-label={task.title}
                    onClick={() => onOpen(task.id)}
                    className="w-full text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded p-1"
                  >
                    <strong>{task.title}</strong>
                    <span className="block text-xs text-gray-500">
                      {task.taskKey} · {task.status.name}{task.status.is_active === false && <span className="ml-1 rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">Archived</span>} · {task.priority} · {new Date(task.dueAt).toLocaleString()}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Quick status for ${task.taskKey}`}
                    onClick={() => onQuickStatus(task)}
                    className="shrink-0 px-2 py-1 border border-gray-300 dark:border-gray-700 text-xs font-semibold rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    Quick status
                  </button>
                </div>
                {isActive && (
                  <div className="mt-3 border-t pt-2 space-y-2">
                    {loadingQuickStatus && (
                      <p role="status" aria-busy="true" className="text-xs text-gray-500">
                        Loading transitions…
                      </p>
                    )}
                    {quickError && (
                      <div role="alert" className="p-2 border border-orange-500 bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 text-xs rounded flex items-center justify-between">
                        <span>{quickError}</span>
                        <button type="button" onClick={onCloseQuickStatus} className="text-xs font-bold underline">
                          Close
                        </button>
                      </div>
                    )}
                    {!loadingQuickStatus && !quickError && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                          Select new status:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {quickTransitions.map((t) => (
                            <button
                              key={t.to_status_id}
                              type="button"
                              onClick={() => onTransition(t.to_status_id)}
                              className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded shadow-sm"
                            >
                              To {t.name}
                            </button>
                          ))}
                          {quickTransitions.length === 0 && (
                            <span className="text-xs text-gray-500">No status transitions available.</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={onCloseQuickStatus}
                          className="text-xs text-gray-500 hover:underline pt-1 block"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">{empty}</p>
      )}
    </section>
  );
}

export default function MyWorkPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const router = useRouter();
  const { user } = useAuth();
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.workspaces.myWork>> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [timezone, setTimezone] = useState<string | null>(null);

  // Quick Status state
  const [quickTask, setQuickTask] = useState<{ id: string; version: number } | null>(null);
  const [activeQuickTaskId, setActiveQuickTaskId] = useState<string | null>(null);
  const [loadingQuickStatus, setLoadingQuickStatus] = useState(false);
  const [quickTransitions, setQuickTransitions] = useState<{ to_status_id: string; code: string; name: string }[]>([]);
  const [quickError, setQuickError] = useState<string | null>(null);

  const date = timezone ? getTodayInTimezone(timezone) : null;
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const workspace = await api.workspaces.get(workspaceId);
      setTimezone(workspace.data.timezone);
      setResult(await api.workspaces.myWork(workspaceId, getTodayInTimezone(workspace.data.timezone)));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'You do not have permission to view My Work.'
          : err instanceof Error
          ? err.message
          : 'My Work unavailable'
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const links = useMemo(() => {
    if (!date || !timezone || !user?.id) return null;
    const today = getCalendarRange('day', date, timezone);
    const upcomingEnd = getCalendarRange(
      'day',
      shiftCalendarDate('day', shiftCalendarDate('week', date, 1, timezone), 1, timezone),
      timezone
    ).to;
    const base = `/workspaces/${workspaceId}/tasks?assignee_id=${encodeURIComponent(user.id)}`;
    return {
      today: `${base}&bucket=active&due_from=${encodeURIComponent(today.from)}&due_to=${encodeURIComponent(today.to)}&sort=due_at`,
      upcoming: `${base}&bucket=active&due_from=${encodeURIComponent(today.to)}&due_to=${encodeURIComponent(upcomingEnd)}&sort=due_at`,
      overdue: `${base}&bucket=active&due_to=${encodeURIComponent(today.from)}&sort=due_at`,
    };
  }, [date, timezone, user?.id, workspaceId]);

  const handleQuickStatus = async (task: MyWorkTask) => {
    setActiveQuickTaskId(task.id);
    setLoadingQuickStatus(true);
    setQuickError(null);
    setQuickTransitions([]);
    try {
      const [detailRes, transRes] = await Promise.all([
        api.tasks.get(workspaceId, task.id),
        api.tasks.availableTransitions(workspaceId, task.id),
      ]);
      setQuickTask({ id: task.id, version: detailRes.data.version });
      setQuickTransitions(transRes.data);
    } catch (err) {
      setQuickError(
        err instanceof ApiError && err.status === 409
          ? 'VERSION_CONFLICT'
          : err instanceof Error
          ? err.message
          : 'Failed to load transitions'
      );
    } finally {
      setLoadingQuickStatus(false);
    }
  };

  const handleTransition = async (toStatusId: string) => {
    if (!quickTask) return;
    setLoadingQuickStatus(true);
    setQuickError(null);
    try {
      await api.tasks.transition(workspaceId, quickTask.id, {
        version: quickTask.version,
        to_status_id: toStatusId,
      });
      setActiveQuickTaskId(null);
      setQuickTask(null);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setQuickError('VERSION_CONFLICT');
      } else {
        setQuickError(err instanceof Error ? err.message : 'Transition failed');
      }
    } finally {
      setLoadingQuickStatus(false);
    }
  };

  const handleCloseQuickStatus = () => {
    setActiveQuickTaskId(null);
    setQuickTask(null);
    setQuickError(null);
  };

  if (loading) return <p role="status">Loading My Work…</p>;
  if (error)
    return (
      <div className="space-y-3">
        <h2 className="text-2xl font-bold">My Work</h2>
        <p role="alert" className="text-red-600">
          {error}
        </p>
        <button type="button" onClick={() => void load()} className="rounded border px-3 py-2">
          Try again
        </button>
      </div>
    );
  if (!result || !links) return null;
  const { data, meta } = result;

  const sectionProps = {
    onOpen: (id: string) => router.push(taskRoute(workspaceId, id)),
    onQuickStatus: handleQuickStatus,
    activeQuickTaskId,
    loadingQuickStatus,
    quickTransitions,
    quickError,
    onTransition: handleTransition,
    onCloseQuickStatus: handleCloseQuickStatus,
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">My Work</h2>
        <p className="text-sm text-gray-500">
          {meta.date} · {meta.timezone}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <TaskSection
          title="Due today"
          tasks={data.today}
          empty="No tasks due today."
          href={links.today}
          {...sectionProps}
        />
        <TaskSection
          title="Upcoming"
          tasks={data.upcoming}
          empty="No upcoming tasks."
          href={links.upcoming}
          {...sectionProps}
        />
        <TaskSection
          title="Overdue"
          tasks={data.overdue}
          empty="No overdue tasks."
          href={links.overdue}
          {...sectionProps}
        />
      </div>
    </div>
  );
}
