'use client';

import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api, Task, Team, WorkspaceMember, Workflow, ApiError } from '../../../../lib/api-client';
import { useAuth } from '../../../../lib/auth-context';
import { getWorkspaceDateTime } from '../../../../lib/calendar-time';
import {
  Plus,
  Search,
  AlertCircle,
  Clock,
  CheckCircle2,
  Trash2,
  Users,
  Calendar,
} from 'lucide-react';

export default function TasksPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL State (filters)
  const q = searchParams.get('q') || '';
  const status_id = searchParams.get('status_id') || '';
  const priority = searchParams.get('priority') || '';
  const assignee_id = searchParams.get('assignee_id') || '';
  const team_id = searchParams.get('team_id') || '';
  const sort = searchParams.get('sort') || '-created_at';
  const create = searchParams.get('create');
  const prefillStart = searchParams.get('prefill_start_at') || '';
  const prefillDue = searchParams.get('prefill_due_at') || '';
  const workspaceTimezone = user?.workspaces.find((workspace) => workspace.id === workspaceId)?.timezone || '';
  const selectedTaskId = searchParams.get('selected_task_id');

  // Server State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ephemeral UI State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const createDialogRef = useRef<HTMLDivElement>(null);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const wasCreateOpen = useRef(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [availableTransitions, setAvailableTransitions] = useState<{ to_status_id: string; code: string; name: string }[]>([]);
  const [conflictError, setConflictError] = useState<string | null>(null);

  // Form State - Create
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createPriority, setCreatePriority] = useState('MEDIUM');
  const [createTeamId, setCreateTeamId] = useState('');
  const [createAssigneeId, setCreateAssigneeId] = useState('');
  const [createStartAt, setCreateStartAt] = useState('');
  const [createDueAt, setCreateDueAt] = useState('');
  const [createStatusId, setCreateStatusId] = useState('');
  const [createRecurring, setCreateRecurring] = useState(false);
  const [createFrequency, setCreateFrequency] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('DAILY');
  const [createInterval, setCreateInterval] = useState('1');
  const [createTimezone, setCreateTimezone] = useState('');
  const [createEndDate, setCreateEndDate] = useState('');
  const [createOccurrenceLimit, setCreateOccurrenceLimit] = useState('');
  const [createValidationError, setCreateValidationError] = useState<string | null>(null);

  // Form State - Edit
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('MEDIUM');
  const [editStartAt, setEditStartAt] = useState('');
  const [editDueAt, setEditDueAt] = useState('');

  // Form State - Assign
  const [assigneeList, setAssigneeList] = useState<{ user_id: string; is_primary: boolean }[]>([]);

  const currentRole = useMemo(() => {
    return user?.workspaces.find((w) => w.id === workspaceId)?.role || 'MEMBER';
  }, [user, workspaceId]);

  // Load static metadata (workflows, teams, members)
  useEffect(() => {
    const loadMetadata = async () => {
      try {
        const [wfRes, teamRes, memRes] = await Promise.all([
          api.workspaces.workflows(workspaceId),
          api.workspaces.teams(workspaceId),
          api.workspaces.members(workspaceId),
        ]);
        setWorkflows(wfRes.data);
        setTeams(teamRes.data);
        setMembers(memRes.data);
      } catch (err) {
        console.error('Failed to load metadata', err);
      }
    };
    loadMetadata();
  }, [workspaceId]);

  // Load Task list on filter change
  const fetchTasks = useCallback(async (cursor?: string) => {
    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await api.tasks.list(workspaceId, {
        q,
        status_id,
        priority,
        assignee_id,
        team_id,
        sort,
        limit: 10,
        cursor,
      });
      if (cursor) {
        setTasks((prev) => [...prev, ...res.data]);
      } else {
        setTasks(res.data);
      }
      setHasMore(res.meta.pagination.has_more);
      setNextCursor(res.meta.pagination.next_cursor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load tasks';
      setError(msg);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [workspaceId, q, status_id, priority, assignee_id, team_id, sort]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const updateFilters = (newParams: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(newParams).forEach(([k, v]) => {
      if (v) params.set(k, v);
      else params.delete(k);
    });
    router.push(`/workspaces/${workspaceId}/tasks?${params.toString()}`);
  };

  // Open Detail & load transitions/history
  const handleOpenDetail = useCallback(async (task: Task) => {
    setSelectedTask(task);
    setIsEditMode(false);
    setConflictError(null);
    setAssigneeList(task.assignees.map((a) => ({ user_id: a.user_id, is_primary: a.is_primary })));
    setEditTitle(task.title);
    setEditDescription(task.description || '');
    setEditPriority(task.priority);
    setEditStartAt(task.start_at ? task.start_at.substring(0, 16) : '');
    setEditDueAt(task.due_at ? task.due_at.substring(0, 16) : '');
    try {
      const transRes = await api.tasks.availableTransitions(workspaceId, task.id);
      setAvailableTransitions(transRes.data);
    } catch (err) {
      console.error('Failed to load transitions', err);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!createTimezone && workspaceTimezone) {
      setCreateTimezone(workspaceTimezone);
    }
  }, [createTimezone, workspaceTimezone]);

  useEffect(() => {
    if (create === '1') {
      setCreateValidationError(null);
      setIsCreateOpen(true);
      setCreateStartAt(prefillStart);
      setCreateDueAt(prefillDue);
      setCreateTimezone(workspaceTimezone);
    }
  }, [create, prefillStart, prefillDue, workspaceTimezone]);

  useEffect(() => {
    if (!selectedTaskId) return;
    void api.tasks.get(workspaceId, selectedTaskId).then((res) => handleOpenDetail(res.data));
  }, [workspaceId, selectedTaskId, handleOpenDetail]);

  useEffect(() => {
    if (!isCreateOpen) {
      if (wasCreateOpen.current) createTriggerRef.current?.focus();
      wasCreateOpen.current = false;
      return;
    }
    wasCreateOpen.current = true;
    const dialog = createDialogRef.current;
    const focusable = dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    focusable?.[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsCreateOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !focusable?.length) return;
      const items = Array.from(focusable);
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog?.addEventListener('keydown', onKeyDown);
    return () => dialog?.removeEventListener('keydown', onKeyDown);
  }, [isCreateOpen]);

  const handleRefreshDetail = async (id: string) => {
    try {
      const res = await api.tasks.get(workspaceId, id);
      setSelectedTask(res.data);
      setAssigneeList(res.data.assignees.map((a) => ({ user_id: a.user_id, is_primary: a.is_primary })));
      const transRes = await api.tasks.availableTransitions(workspaceId, id);
      setAvailableTransitions(transRes.data);
      // Update item in list
      setTasks((prev) => prev.map((t) => (t.id === id ? res.data : t)));
    } catch (err) {
      console.error('Failed to refresh detail', err);
    }
  };

  // Mutations - Create
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateValidationError(null);
    try {
      const assignees = createAssigneeId ? [{ user_id: createAssigneeId, is_primary: true }] : [];
      if (createRecurring) {
        const interval = Number(createInterval);
        const occurrenceLimit = createOccurrenceLimit ? Number(createOccurrenceLimit) : undefined;
        if (!createStartAt || !createTimezone || !Number.isInteger(interval) || interval < 1) {
          throw new Error('Recurring tasks require a start, timezone, and positive integer interval.');
        }
        if (occurrenceLimit !== undefined && (!Number.isInteger(occurrenceLimit) || occurrenceLimit < 1)) {
          throw new Error('Occurrence count must be a positive integer.');
        }
        if (createEndDate && occurrenceLimit !== undefined) {
          throw new Error('Choose an end date or occurrence count, not both.');
        }
        await api.tasks.createRecurring(workspaceId, {
          name: createTitle,
          title: createTitle,
          description: createDescription || null,
          priority: createPriority,
          status_id: createStatusId || undefined,
          team_id: createTeamId || null,
          assignee_ids: createAssigneeId ? [createAssigneeId] : [],
          primary_assignee_id: createAssigneeId || null,
          frequency: createFrequency,
          interval_value: interval,
          timezone: createTimezone,
          start_at: getWorkspaceDateTime(createStartAt, createTimezone),
          ...(createEndDate ? { end_at: getWorkspaceDateTime(`${createEndDate}T23:59`, createTimezone) } : {}),
          ...(occurrenceLimit !== undefined ? { occurrence_limit: occurrenceLimit } : {}),
        }, crypto.randomUUID());
      } else {
        await api.tasks.create(workspaceId, {
          title: createTitle,
          description: createDescription || null,
          priority: createPriority,
          team_id: createTeamId || null,
          assignees,
          start_at: createStartAt ? workspaceTimezone ? getWorkspaceDateTime(createStartAt, workspaceTimezone) : new Date(createStartAt).toISOString() : null,
          due_at: createDueAt ? workspaceTimezone ? getWorkspaceDateTime(createDueAt, workspaceTimezone) : new Date(createDueAt).toISOString() : null,
          status_id: createStatusId || undefined,
        });
      }
      setIsCreateOpen(false);
      // Reset
      setCreateTitle('');
      setCreateDescription('');
      setCreatePriority('MEDIUM');
      setCreateTeamId('');
      setCreateAssigneeId('');
      setCreateStartAt('');
       setCreateDueAt('');
       setCreateStatusId('');
       setCreateRecurring(false);
       setCreateFrequency('DAILY');
       setCreateInterval('1');
       setCreateTimezone(workspaceTimezone);
       setCreateEndDate('');
       setCreateOccurrenceLimit('');
       fetchTasks();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create task';
      setCreateValidationError(msg);
    }
  };

  // Mutations - Edit (Patch)
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;
    setConflictError(null);
    try {
      const res = await api.tasks.update(workspaceId, selectedTask.id, {
        version: selectedTask.version,
        title: editTitle,
        description: editDescription || null,
        priority: editPriority,
        start_at: editStartAt ? new Date(editStartAt).toISOString() : null,
        due_at: editDueAt ? new Date(editDueAt).toISOString() : null,
      });
      setSelectedTask(res.data);
      setIsEditMode(false);
      setTasks((prev) => prev.map((t) => (t.id === selectedTask.id ? res.data : t)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictError('VERSION_CONFLICT');
      } else {
        const msg = err instanceof Error ? err.message : 'Update failed';
        alert(msg);
      }
    }
  };

  // Mutations - Status Change
  const handleTransition = async (statusId: string) => {
    if (!selectedTask) return;
    try {
      await api.tasks.transition(workspaceId, selectedTask.id, {
        version: selectedTask.version,
        to_status_id: statusId,
      });
      await handleRefreshDetail(selectedTask.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictError('VERSION_CONFLICT');
      } else {
        const msg = err instanceof Error ? err.message : 'Transition failed';
        alert(msg);
      }
    }
  };

  // Mutations - Assign Replacement
  const handleAssignReplace = async () => {
    if (!selectedTask) return;
    try {
      const res = await api.tasks.assign(workspaceId, selectedTask.id, {
        version: selectedTask.version,
        assignees: assigneeList,
      });
      setSelectedTask(res.data);
      setTasks((prev) => prev.map((t) => (t.id === selectedTask.id ? res.data : t)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictError('VERSION_CONFLICT');
      } else {
        const msg = err instanceof Error ? err.message : 'Assignment failed';
        alert(msg);
      }
    }
  };

  // Mutations - Soft Delete
  const handleDelete = async () => {
    if (!selectedTask) return;
    if (!confirm('Are you sure you want to delete/archive this task?')) return;
    try {
      await api.tasks.delete(workspaceId, selectedTask.id, selectedTask.version);
      setSelectedTask(null);
      fetchTasks();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictError('VERSION_CONFLICT');
      } else {
        const msg = err instanceof Error ? err.message : 'Delete failed';
        alert(msg);
      }
    }
  };

  const activeWorkflow = workflows[0];
  const allStatuses = activeWorkflow?.statuses || [];

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-3 sm:space-y-0">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Tasks</h2>
          <p className="text-sm text-gray-500">Manage, organize, and execute workspace items.</p>
        </div>
        <button
          ref={createTriggerRef}
          onClick={() => {
            setCreateValidationError(null);
            setIsCreateOpen(true);
          }}
          className="inline-flex items-center justify-center px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition"
        >
          <Plus className="h-4 w-4 mr-2" />
          <span>New Task</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 space-y-4 shadow-sm">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by title or key..."
              value={q}
              onChange={(e) => updateFilters({ q: e.target.value })}
              className="pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md w-full dark:bg-gray-800 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Status Filter */}
          <div className="w-full md:w-48">
            <select
              value={status_id}
              onChange={(e) => updateFilters({ status_id: e.target.value })}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md w-full dark:bg-gray-800 focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Statuses</option>
              {allStatuses.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>

          {/* Priority Filter */}
          <div className="w-full md:w-40">
            <select
              value={priority}
              onChange={(e) => updateFilters({ priority: e.target.value })}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md w-full dark:bg-gray-800 focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Priorities</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>

          {/* Team Filter */}
          <div className="w-full md:w-48">
            <select
              value={team_id}
              onChange={(e) => updateFilters({ team_id: e.target.value })}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md w-full dark:bg-gray-800 focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Sort */}
          <div className="w-full md:w-48">
            <select
              value={sort}
              onChange={(e) => updateFilters({ sort: e.target.value })}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md w-full dark:bg-gray-800 focus:ring-1 focus:ring-blue-500"
            >
              <option value="-created_at">Newest Created</option>
              <option value="created_at">Oldest Created</option>
              <option value="due_at">Due Date (Asc)</option>
              <option value="-due_at">Due Date (Desc)</option>
              <option value="task_key">Task Key (Asc)</option>
              <option value="-task_key">Task Key (Desc)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Task Rows & States */}
      {loading && tasks.length === 0 ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-16 w-full animate-pulse bg-gray-150 dark:bg-gray-800 rounded-lg"
            />
          ))}
        </div>
      ) : error ? (
        <div className="bg-red-50 dark:bg-red-950/50 border-l-4 border-red-500 p-4 rounded text-red-700 dark:text-red-300">
          <p className="font-bold flex items-center">
            <AlertCircle className="h-5 w-5 mr-2" />
            <span>Error</span>
          </p>
          <p>{error}</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-gray-200 dark:border-gray-850 rounded-lg bg-white dark:bg-gray-900">
          <CheckCircle2 className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-sm font-semibold text-gray-950 dark:text-gray-100">
            No tasks found
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Get started by creating a new work item.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden shadow-sm">
            <ul className="divide-y divide-gray-200 dark:divide-gray-850">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  onClick={() => handleOpenDetail(task)}
                  className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition cursor-pointer flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                        {task.task_key}
                      </span>
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {task.title}
                      </h4>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-medium">
                        {task.status.name}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-medium">
                        {task.priority}
                      </span>
                      {task.due_at && (
                        <span className="flex items-center space-x-1">
                          <Clock className="h-3 w-3" />
                          <span>Due {new Date(task.due_at).toLocaleDateString()}</span>
                        </span>
                      )}
                      {task.is_overdue && (
                        <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 font-bold">
                          Overdue
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 self-start sm:self-auto">
                    {task.assignees.map((a) => (
                      <div
                        key={a.user_id}
                        title={`${a.full_name} ${a.is_primary ? '(Primary)' : ''}`}
                        className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                          a.is_primary
                            ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-600'
                        }`}
                      >
                        {a.full_name.charAt(0).toUpperCase()}
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Load More Keyset Pagination */}
          {hasMore && (
            <div className="flex justify-center pt-4">
              <button
                onClick={() => fetchTasks(nextCursor || undefined)}
                disabled={loadingMore}
                className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition"
              >
                {loadingMore ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* CREATE TASK MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setIsCreateOpen(false)} />
          <div ref={createDialogRef} role="dialog" aria-modal="true" aria-labelledby="create-task-title" className="relative w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 rounded-lg shadow-xl overflow-y-auto max-h-[90vh]">
            <h3 id="create-task-title" className="text-lg font-bold mb-4">Create Task</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              {createValidationError && (
                <div className="bg-red-50 dark:bg-red-950/50 border-l-4 border-red-500 p-3 rounded text-sm text-red-700 dark:text-red-300">
                  {createValidationError}
                </div>
              )}
              <div>
                <label htmlFor="title" className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">
                  Title
                </label>
                <input
                  id="title"
                  type="text"
                  required
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="description" className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">
                  Description
                </label>
                <textarea
                  id="description"
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800 focus:ring-1 focus:ring-blue-500 h-20"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="priority" className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">
                    Priority
                  </label>
                  <select
                    id="priority"
                    value={createPriority}
                    onChange={(e) => setCreatePriority(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="team_id" className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">
                    Team
                  </label>
                  <select
                    id="team_id"
                    value={createTeamId}
                    onChange={(e) => setCreateTeamId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">None</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="start_at" className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">
                    Start Date
                  </label>
                  <input
                    id="start_at"
                    type="datetime-local"
                    value={createStartAt}
                    onChange={(e) => setCreateStartAt(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="due_at" className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">
                    Due Date
                  </label>
                  <input
                    id="due_at"
                    type="datetime-local"
                    value={createDueAt}
                    onChange={(e) => setCreateDueAt(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="enable_recurring"
                  type="checkbox"
                  checked={createRecurring}
                  onChange={(e) => setCreateRecurring(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="enable_recurring" className="text-sm font-semibold text-gray-700 dark:text-gray-300">Enable recurring</label>
              </div>
              {createRecurring && (
                <div className="space-y-4 border rounded-md p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="recurrence_frequency" className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">Frequency</label>
                      <select id="recurrence_frequency" value={createFrequency} onChange={(e) => setCreateFrequency(e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY')} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800">
                        <option value="DAILY">Daily</option>
                        <option value="WEEKLY">Weekly</option>
                        <option value="MONTHLY">Monthly</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="recurrence_interval" className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">Interval</label>
                      <input id="recurrence_interval" type="number" min="1" step="1" required value={createInterval} onChange={(e) => setCreateInterval(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800" />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="recurrence_timezone" className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">Recurrence timezone</label>
                    <input id="recurrence_timezone" type="text" required value={createTimezone} onChange={(e) => setCreateTimezone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800" />
                  </div>
                  <p className="text-sm text-gray-500">Start uses the task start date. CUSTOM recurrence is not supported.</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="recurrence_end_date" className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">End date</label>
                      <input id="recurrence_end_date" type="date" disabled={Boolean(createOccurrenceLimit)} value={createEndDate} onChange={(e) => setCreateEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800 disabled:opacity-50" />
                    </div>
                    <div>
                      <label htmlFor="recurrence_occurrence_limit" className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">Occurrence count</label>
                      <input id="recurrence_occurrence_limit" type="number" min="1" step="1" disabled={Boolean(createEndDate)} value={createOccurrenceLimit} onChange={(e) => setCreateOccurrenceLimit(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800 disabled:opacity-50" />
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="primary_assignee" className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">
                    Primary Assignee
                  </label>
                  <select
                    id="primary_assignee"
                    value={createAssigneeId}
                    onChange={(e) => setCreateAssigneeId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">None</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.user?.full_name || m.user_id}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="initial_status" className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">
                    Initial Status
                  </label>
                  <select
                    id="initial_status"
                    value={createStatusId}
                    onChange={(e) => setCreateStatusId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Default (Initial)</option>
                    {allStatuses.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end space-x-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-bold"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TASK DETAIL / EDIT MODAL */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSelectedTask(null)} />
          <div role="dialog" aria-modal="true" aria-label="Task details" className="relative w-full max-w-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 rounded-lg shadow-xl overflow-y-auto max-h-[90vh]">
            {conflictError && (
              <div className="bg-orange-50 dark:bg-orange-950/50 border-l-4 border-orange-500 p-4 rounded mb-4 text-orange-700 dark:text-orange-300 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <p className="font-bold">Version Conflict</p>
                  <p className="text-sm">This task has been modified by another user. Reload state to continue.</p>
                </div>
                <button
                  onClick={() => {
                    setConflictError(null);
                    setIsEditMode(false);
                    handleRefreshDetail(selectedTask.id);
                  }}
                  className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded"
                >
                  Reload State
                </button>
              </div>
            )}

            {!isEditMode ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b pb-3">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                      {selectedTask.task_key}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 font-medium">
                      Version: {selectedTask.version}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setIsEditMode(true)}
                      className="px-3 py-1 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 text-xs rounded"
                    >
                      Edit Fields
                    </button>
                    {currentRole === 'ADMIN' && (
                      <button
                        onClick={handleDelete}
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-gray-100 rounded"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                    {selectedTask.title}
                  </h3>
                  {selectedTask.is_overdue && (
                    <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800">
                      Overdue
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg text-sm">
                  <div>
                    <span className="block text-gray-500 text-xs uppercase font-semibold">Status</span>
                    <span className="font-medium">{selectedTask.status.name}</span>
                  </div>
                  <div>
                    <span className="block text-gray-500 text-xs uppercase font-semibold">Priority</span>
                    <span className="font-medium">{selectedTask.priority}</span>
                  </div>
                  <div>
                    <span className="block text-gray-500 text-xs uppercase font-semibold">Team</span>
                    <span className="font-medium">
                      {teams.find((t) => t.id === selectedTask.team_id)?.name || 'None'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-gray-500 text-xs uppercase font-semibold">Creator</span>
                    <span className="font-medium">
                      {members.find((m) => m.user_id === selectedTask.creator_id)?.user?.full_name || 'System'}
                    </span>
                  </div>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center space-x-2">
                    <Calendar className="h-4 w-4 text-gray-400" />
                    <span>
                      Start: {selectedTask.start_at ? new Date(selectedTask.start_at).toLocaleString() : 'N/A'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Calendar className="h-4 w-4 text-gray-400" />
                    <span>
                      Due: {selectedTask.due_at ? new Date(selectedTask.due_at).toLocaleString() : 'N/A'}
                    </span>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs uppercase font-semibold text-gray-500 mb-1">Description</h4>
                  <div className="text-sm border border-gray-150 dark:border-gray-800 rounded p-3 bg-white dark:bg-gray-900 min-h-[60px] whitespace-pre-wrap">
                    {selectedTask.description || 'No description provided.'}
                  </div>
                </div>

                {/* Transitions */}
                <div className="space-y-2 border-t pt-4">
                  <h4 className="text-xs uppercase font-semibold text-gray-500">Change Status</h4>
                  <div className="flex flex-wrap gap-2">
                    {availableTransitions.map((t) => (
                      <button
                        key={t.to_status_id}
                        onClick={() => handleTransition(t.to_status_id)}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-xs font-semibold rounded transition"
                      >
                        To {t.name}
                      </button>
                    ))}
                    {availableTransitions.length === 0 && (
                      <span className="text-xs text-gray-500">No status transitions available.</span>
                    )}
                  </div>
                </div>

                {/* Assignees */}
                <div className="space-y-3 border-t pt-4">
                  <h4 className="text-xs uppercase font-semibold text-gray-500 flex items-center">
                    <Users className="h-4 w-4 mr-2" />
                    <span>Manage Assignment</span>
                  </h4>
                  <div className="space-y-2">
                    {members.map((m) => {
                      const cur = assigneeList.find((a) => a.user_id === m.user_id);
                      return (
                        <div key={m.user_id} className="flex items-center justify-between text-sm">
                          <span>{m.user?.full_name || m.user_id}</span>
                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={!!cur}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setAssigneeList((prev) => [...prev, { user_id: m.user_id, is_primary: false }]);
                                } else {
                                  setAssigneeList((prev) => prev.filter((a) => a.user_id !== m.user_id));
                                }
                              }}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            {cur && (
                              <button
                                type="button"
                                onClick={() => {
                                  setAssigneeList((prev) =>
                                    prev.map((a) => ({ ...a, is_primary: a.user_id === m.user_id }))
                                  );
                                }}
                                className={`text-xs px-2 py-0.5 rounded font-bold ${
                                  cur.is_primary ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
                                }`}
                              >
                                {cur.is_primary ? 'Primary' : 'Make Primary'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={handleAssignReplace}
                    className="w-full py-2 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded"
                  >
                    Save Assignment Changes
                  </button>
                </div>
              </div>
            ) : (
              // EDIT MODE Form
              <form onSubmit={handleUpdate} className="space-y-4">
                <h3 className="text-lg font-bold mb-4">Edit Task Fields</h3>
                <div>
                  <label className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">
                    Title
                  </label>
                  <input
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">
                    Description
                  </label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800 h-24"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">
                    Priority
                  </label>
                  <select
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT')}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">
                      Start Date
                    </label>
                    <input
                      type="datetime-local"
                      value={editStartAt}
                      onChange={(e) => setEditStartAt(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1 text-gray-700 dark:text-gray-300">
                      Due Date
                    </label>
                    <input
                      type="datetime-local"
                      value={editDueAt}
                      onChange={(e) => setEditDueAt(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm dark:bg-gray-800"
                    />
                  </div>
                </div>
                <div className="flex justify-end space-x-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsEditMode(false)}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-bold"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            )}

            <div className="flex justify-end pt-4 border-t mt-6">
              <button
                onClick={() => setSelectedTask(null)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
