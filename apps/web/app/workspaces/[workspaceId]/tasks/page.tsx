'use client';

import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api, Task, Team, WorkspaceMember, Workflow, ApiError } from '../../../../lib/api-client';
import { useAuth } from '../../../../lib/auth-context';
import { getWorkspaceDateTime, getWorkspaceDateTimeInput } from '../../../../lib/calendar-time';
import { TaskCommentsSection } from '../../../../components/task-comments-section';
import {
  Plus,
  Search,
  AlertCircle,
  Clock,
  CheckCircle2,
  Trash2,
  Users,
  Calendar,
  X,
} from 'lucide-react';
import { formatStatusName, formatTransitionLabel, formatDateDisplay, formatDateTimeDisplay } from '../../../../lib/i18n-labels';

export default function TasksPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { user, activeWorkspace, workspaceResolving } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL State (filters)
  const q = searchParams.get('q') || '';
  const status_id = searchParams.get('status_id') || '';
  const priority = searchParams.get('priority') || '';
  const assignee_id = searchParams.get('assignee_id') || '';
  const team_id = searchParams.get('team_id') || '';
  const bucket = searchParams.get('bucket') || '';
  const due_from = searchParams.get('due_from') || '';
  const due_to = searchParams.get('due_to') || '';
  const overdue = searchParams.get('overdue') || '';
  const sort = searchParams.get('sort') || '-created_at';
  const create = searchParams.get('create');
  const prefillStart = searchParams.get('prefill_start_at') || '';
  const prefillDue = searchParams.get('prefill_due_at') || '';
  const workspaceTimezone = user?.workspaces.find((workspace) => workspace.id === workspaceId)?.timezone || '';
  const selectedTaskId = searchParams.get('selected_task_id');
  const editSchedule = searchParams.get('edit_schedule');
  const calView = searchParams.get('cal_view');
  const calDate = searchParams.get('cal_date');
  const calTeamId = searchParams.get('cal_team_id');
  const calAssigneeId = searchParams.get('cal_assignee_id');
  const returnTo = searchParams.get('return_to');

  const contextReturnUrl = useMemo(() => {
    const allowed = [`/workspaces/${workspaceId}/calendar`, `/workspaces/${workspaceId}/kanban`];
    if (returnTo && allowed.some((path) => returnTo === path || returnTo.startsWith(`${path}?`)) && !returnTo.includes('//')) {
      return returnTo;
    }
    if (!calView && !calDate && !calTeamId && !calAssigneeId) return null;
    const p = new URLSearchParams();
    if (calView) p.set('view', calView);
    if (calDate) p.set('date', calDate);
    if (calTeamId) p.set('team_id', calTeamId);
    if (calAssigneeId) p.set('assignee_id', calAssigneeId);
    return `/workspaces/${workspaceId}/calendar${p.toString() ? `?${p.toString()}` : ''}`;
  }, [workspaceId, returnTo, calView, calDate, calTeamId, calAssigneeId]);

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
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(Boolean(priority || team_id || assignee_id || due_from || due_to || overdue || sort !== '-created_at'));
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const createDialogRef = useRef<HTMLDivElement>(null);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const wasCreateOpen = useRef(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const detailDialogRef = useRef<HTMLDivElement>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const wasDetailOpen = useRef(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [availableTransitions, setAvailableTransitions] = useState<{ to_status_id: string; code: string; name: string }[]>([]);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [editValidationError, setEditValidationError] = useState<string | null>(null);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);

  useEffect(() => {
    const request = detailRequest;
    return () => { request.current++; };
  }, [workspaceId]);

  // Form State - Create
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createPriority, setCreatePriority] = useState('MEDIUM');
  const [createTeamId, setCreateTeamId] = useState('');
  const [createAssignees, setCreateAssignees] = useState<{ user_id: string; is_primary: boolean }[]>([]);
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
    return !workspaceResolving && activeWorkspace?.id === workspaceId ? activeWorkspace.role : undefined;
  }, [activeWorkspace, workspaceId, workspaceResolving]);

  // Load static metadata (workflows, teams, members)
  useEffect(() => {
    if (workspaceResolving || activeWorkspace?.id !== workspaceId) return;
    let active = true;
    const loadMetadata = async () => {
      try {
        const [wfRes, teamRes, memRes] = await Promise.all([
          api.workspaces.workflows(workspaceId),
          api.workspaces.teams(workspaceId),
          api.workspaces.members(workspaceId),
        ]);
        if (!active) return;
        setWorkflows(wfRes.data);
        setTeams(teamRes.data);
        setMembers(memRes.data);
      } catch (err) {
        console.error('Failed to load metadata', err);
      }
    };
    loadMetadata();
    return () => { active = false; };
  }, [activeWorkspace?.id, workspaceId, workspaceResolving]);

  // Load Task list on filter change
  const fetchTasks = useCallback(async (cursor?: string) => {
    if (workspaceResolving || activeWorkspace?.id !== workspaceId) return;
    const id = ++listRequest.current;
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
        due_from: due_from || undefined,
        due_to: due_to || undefined,
        bucket: bucket || 'active',
        overdue: overdue === 'true' ? 'true' : undefined,
        sort,
        limit: 10,
        cursor,
      });
      if (id !== listRequest.current) return;
      if (cursor) {
        setTasks((prev) => [...prev, ...res.data]);
      } else {
        setTasks(res.data);
      }
      setHasMore(res.meta.pagination.has_more);
      setNextCursor(res.meta.pagination.next_cursor);
    } catch (err) {
      if (id !== listRequest.current) return;
      const msg = err instanceof Error ? err.message : 'Tugas belum dapat dimuat';
      setError(msg);
    } finally {
      if (id === listRequest.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [activeWorkspace?.id, workspaceId, workspaceResolving, q, status_id, priority, assignee_id, team_id, due_from, due_to, bucket, overdue, sort]);

  useEffect(() => {
    const request = listRequest;
    void fetchTasks();
    return () => { request.current++; };
  }, [fetchTasks]);

  const updateFilters = (newParams: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('cursor');
    Object.entries(newParams).forEach(([k, v]) => {
      if (v) params.set(k, v);
      else params.delete(k);
    });
    router.push(`/workspaces/${workspaceId}/tasks?${params.toString()}`);
  };

  const handleCloseDetail = useCallback(() => {
    detailRequest.current++;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('selected_task_id');
    params.delete('edit_schedule');
    setSelectedTask(null);
    router.push(contextReturnUrl || `/workspaces/${workspaceId}/tasks${params.size ? `?${params}` : ''}`);
  }, [router, searchParams, workspaceId, contextReturnUrl]);

  // Open Detail & load transitions/history
  const handleOpenDetail = useCallback(async (task: Task, id = ++detailRequest.current) => {
    if (id !== detailRequest.current) return;
    detailTriggerRef.current = document.activeElement as HTMLElement;
    setSelectedTask(task);
    setIsEditMode(editSchedule === '1');
    setConflictError(null);
    setEditValidationError(null);
    setAssigneeList(task.assignees.map((a) => ({ user_id: a.user_id, is_primary: a.is_primary })));
    setEditTitle(task.title);
    setEditDescription(task.description || '');
    setEditPriority(task.priority);
    setEditStartAt(getWorkspaceDateTimeInput(task.start_at, workspaceTimezone));
    setEditDueAt(getWorkspaceDateTimeInput(task.due_at, workspaceTimezone));
    setAvailableTransitions([]);
    try {
      const transRes = await api.tasks.availableTransitions(workspaceId, task.id);
      if (id === detailRequest.current) setAvailableTransitions(transRes.data);
    } catch (err) {
      console.error('Failed to load transitions', err);
    }
  }, [workspaceId, editSchedule, workspaceTimezone]);

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
    const request = detailRequest;
    const id = ++detailRequest.current;
    void api.tasks.get(workspaceId, selectedTaskId).then((res) => handleOpenDetail(res.data, id)).catch(console.error);
    return () => { request.current++; };
  }, [workspaceId, selectedTaskId, handleOpenDetail]);

  useEffect(() => {
    if (!selectedTask) {
      if (wasDetailOpen.current) detailTriggerRef.current?.focus();
      wasDetailOpen.current = false;
      return;
    }
    wasDetailOpen.current = true;
    const dialog = detailDialogRef.current;
    const focusable = dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    focusable?.[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCloseDetail();
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
  }, [handleCloseDetail, selectedTask]);

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
    const request = ++detailRequest.current;
    try {
      const res = await api.tasks.get(workspaceId, id);
      if (request !== detailRequest.current) return;
      setSelectedTask(res.data);
      setAssigneeList(res.data.assignees.map((a) => ({ user_id: a.user_id, is_primary: a.is_primary })));
      const transRes = await api.tasks.availableTransitions(workspaceId, id);
      if (request !== detailRequest.current) return;
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
      const assignees = createAssignees;
      if (createRecurring) {
        const interval = Number(createInterval);
        const occurrenceLimit = createOccurrenceLimit ? Number(createOccurrenceLimit) : undefined;
        if (!createStartAt || !createTimezone || !Number.isInteger(interval) || interval < 1) {
          throw new Error('Tugas berulang memerlukan waktu mulai, zona waktu, dan interval bilangan bulat positif.');
        }
        if (occurrenceLimit !== undefined && (!Number.isInteger(occurrenceLimit) || occurrenceLimit < 1)) {
          throw new Error('Jumlah kemunculan harus berupa bilangan bulat positif.');
        }
        if (createEndDate && occurrenceLimit !== undefined) {
          throw new Error('Pilih tanggal akhir atau jumlah kemunculan, bukan keduanya.');
        }
        const primaryAssignee = assignees.find((a) => a.is_primary);
        await api.tasks.createRecurring(workspaceId, {
          name: createTitle,
          title: createTitle,
          description: createDescription || null,
          priority: createPriority,
          status_id: createStatusId || undefined,
          team_id: createTeamId || null,
          assignee_ids: assignees.map((a) => a.user_id),
          primary_assignee_id: primaryAssignee?.user_id || null,
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
      setCreateAssignees([]);
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
      const msg = err instanceof Error ? err.message : 'Tugas belum dapat dibuat';
      setCreateValidationError(msg);
    }
  };

  // Mutations - Edit (Patch)
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;
    setConflictError(null);
    setEditValidationError(null);

    if (editStartAt && editDueAt && editStartAt > editDueAt) {
      setEditValidationError('Waktu mulai harus sebelum atau sama dengan tenggat.');
      return;
    }

    try {
      const res = await api.tasks.update(workspaceId, selectedTask.id, {
        version: selectedTask.version,
        title: editTitle,
        description: editDescription || null,
        priority: editPriority,
        start_at: editStartAt === getWorkspaceDateTimeInput(selectedTask.start_at, workspaceTimezone) ? selectedTask.start_at : editStartAt ? (workspaceTimezone ? getWorkspaceDateTime(editStartAt, workspaceTimezone) : new Date(editStartAt).toISOString()) : null,
        due_at: editDueAt === getWorkspaceDateTimeInput(selectedTask.due_at, workspaceTimezone) ? selectedTask.due_at : editDueAt ? (workspaceTimezone ? getWorkspaceDateTime(editDueAt, workspaceTimezone) : new Date(editDueAt).toISOString()) : null,
      });
      setSelectedTask(res.data);
      setIsEditMode(false);
      setTasks((prev) => prev.map((t) => (t.id === selectedTask.id ? res.data : t)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictError('VERSION_CONFLICT');
      } else {
        const msg = err instanceof Error ? err.message : 'Tugas belum dapat diperbarui';
        setEditValidationError(msg);
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
        const msg = err instanceof Error ? err.message : 'Status belum dapat diubah';
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
        const msg = err instanceof Error ? err.message : 'Penanggung jawab belum dapat diperbarui';
        alert(msg);
      }
    }
  };

  // Mutations - Soft Delete
  const handleDelete = async () => {
    if (!selectedTask) return;
    if (!confirm('Hapus atau arsipkan tugas ini?')) return;
    try {
      await api.tasks.delete(workspaceId, selectedTask.id, selectedTask.version);
      setSelectedTask(null);
      fetchTasks();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictError('VERSION_CONFLICT');
      } else {
        const msg = err instanceof Error ? err.message : 'Tugas belum dapat dihapus';
        alert(msg);
      }
    }
  };

  const activeWorkflow = workflows[0];
  const allStatuses = activeWorkflow?.statuses || [];

  const hasActiveFilters = Boolean(q || status_id || priority || team_id || assignee_id || due_from || due_to || overdue || sort !== '-created_at' || bucket === 'completed');

  return (
    <div className="min-w-0 space-y-6 text-foreground">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Ruang kerja</p>
          <h2 className="text-2xl font-semibold tracking-tight">Tugas</h2>
          <p className="mt-1 text-sm text-muted-foreground">Atur pekerjaan tim, tenggat, dan penanggung jawab dalam satu tempat.</p>
        </div>
        <button
          ref={createTriggerRef}
          type="button"
          onClick={() => { setCreateValidationError(null); setIsCreateOpen(true); }}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Buat tugas</span>
        </button>
      </header>

      <nav aria-label="Kelompok tugas" className="flex gap-1 border-b border-border">
        <button type="button" aria-pressed={!bucket || bucket === 'active'} onClick={() => updateFilters({ bucket: 'active' })} className={`min-h-11 border-b-2 px-3 text-sm font-medium ${!bucket || bucket === 'active' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>Aktif</button>
        <button type="button" aria-pressed={bucket === 'completed'} onClick={() => updateFilters({ bucket: 'completed' })} className={`min-h-11 border-b-2 px-3 text-sm font-medium ${bucket === 'completed' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>Selesai</button>
      </nav>

      <section aria-label="Filter tugas" className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="task-search" className="mb-1 block text-xs font-medium text-muted-foreground">Cari tugas</label>
            <Search className="pointer-events-none absolute left-3 top-9 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input id="task-search" type="text" placeholder="Cari judul atau kode" value={q} onChange={(e) => updateFilters({ q: e.target.value })} className="min-h-11 w-full rounded-md border border-border bg-surface px-3 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary" />
          </div>
          <div className="sm:w-52">
            <label htmlFor="task-status-filter" className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
            <select id="task-status-filter" aria-label="Status filter" value={status_id} onChange={(e) => updateFilters({ status_id: e.target.value })} className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <option value="">Semua status</option>
              {allStatuses.map((st) => (<option key={st.id} value={st.id}>{formatStatusName(st.name)}</option>))}
            </select>
          </div>
          <button type="button" aria-expanded={showAdvancedFilters} onClick={() => setShowAdvancedFilters((open) => !open)} className="min-h-11 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Filter lainnya</button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select aria-label="Priority filter" value={priority} onChange={(e) => updateFilters({ priority: e.target.value })} className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <option value="">Semua prioritas</option><option value="LOW">Rendah</option><option value="MEDIUM">Sedang</option><option value="HIGH">Tinggi</option><option value="URGENT">Mendesak</option>
          </select>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-danger"><input type="checkbox" aria-label="Overdue only" checked={overdue === 'true'} onChange={(e) => updateFilters({ overdue: e.target.checked ? 'true' : '' })} className="h-4 w-4 rounded border-border text-danger focus:ring-danger" /> Terlambat saja</label>
          {hasActiveFilters && <button type="button" onClick={() => router.push(`/workspaces/${workspaceId}/tasks`)} className="min-h-11 px-2 text-sm font-medium text-primary hover:underline">Hapus semua filter</button>}
        </div>
        {showAdvancedFilters && (
          <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><label htmlFor="filter_due_from" className="mb-1 block text-xs font-medium text-muted-foreground">Tenggat mulai</label><input id="filter_due_from" aria-label="Tenggat mulai" type="date" value={due_from ? due_from.substring(0, 10) : ''} onChange={(e) => updateFilters({ due_from: e.target.value ? `${e.target.value}T00:00:00.000Z` : '' })} className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm" /></div>
            <div><label htmlFor="filter_due_to" className="mb-1 block text-xs font-medium text-muted-foreground">Tenggat sampai</label><input id="filter_due_to" aria-label="Tenggat sampai" type="date" value={due_to ? due_to.substring(0, 10) : ''} onChange={(e) => updateFilters({ due_to: e.target.value ? `${e.target.value}T23:59:59.999Z` : '' })} className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm" /></div>
            <div><label htmlFor="task-team-filter" className="mb-1 block text-xs font-medium text-muted-foreground">Tim</label><select id="task-team-filter" aria-label="Team filter" value={team_id} onChange={(e) => updateFilters({ team_id: e.target.value })} className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"><option value="">Semua tim</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            <div><label htmlFor="task-assignee-filter" className="mb-1 block text-xs font-medium text-muted-foreground">Penanggung jawab</label><select id="task-assignee-filter" aria-label="Assignee filter" value={assignee_id} onChange={(e) => updateFilters({ assignee_id: e.target.value })} className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"><option value="">Semua orang</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.user_id}</option>)}</select></div>
            <div className="sm:col-span-2 lg:col-span-1"><label htmlFor="task-sort-filter" className="mb-1 block text-xs font-medium text-muted-foreground">Urutkan</label><select id="task-sort-filter" aria-label="Sort order" value={sort} onChange={(e) => updateFilters({ sort: e.target.value })} className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"><option value="-created_at">Terbaru dibuat</option><option value="created_at">Terlama dibuat</option><option value="due_at">Tenggat terdekat</option><option value="-due_at">Tenggat terjauh</option><option value="task_key">Kode A-Z</option><option value="-task_key">Kode Z-A</option></select></div>
          </div>
        )}
      </section>

      {loading && tasks.length === 0 ? (
        <div aria-label="Memuat tugas" className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-subtle" />)}</div>
      ) : error ? (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-4"><p className="flex items-center gap-2 font-semibold text-danger"><AlertCircle className="h-5 w-5" aria-hidden="true" />Tugas belum dapat dimuat</p><p className="mt-1 text-sm text-muted-foreground">{error}</p><button type="button" onClick={() => fetchTasks()} className="mt-3 min-h-11 rounded-md border border-border px-3 text-sm font-medium hover:bg-surface">Coba lagi</button></div>
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" /><h3 className="mt-3 font-semibold">{hasActiveFilters ? 'Tidak ada tugas yang cocok' : 'Belum ada tugas'}</h3><p className="mt-1 text-sm text-muted-foreground">{hasActiveFilters ? 'Coba ubah atau hapus filter.' : 'Buat tugas pertama untuk mulai bekerja.'}</p>{hasActiveFilters && <button type="button" onClick={() => router.push(`/workspaces/${workspaceId}/tasks`)} className="mt-4 min-h-11 rounded-md border border-border px-3 text-sm font-medium hover:bg-surface-subtle">Hapus semua filter</button>}</div>
      ) : (
        <div className="space-y-3">
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-col gap-3 p-4 transition hover:bg-surface-subtle sm:flex-row sm:items-center sm:justify-between">
                <button type="button" aria-label={`Buka tugas ${task.title}`} onClick={() => { const id = ++detailRequest.current; void api.tasks.get(workspaceId, task.id).then((res) => handleOpenDetail(res.data, id)).catch(console.error); }} className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <span className="text-xs font-semibold text-primary">{task.task_key}</span>
                  <span className="mt-1 block truncate text-base font-semibold">{task.title}</span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span>{formatStatusName(task.status.name)}</span><span>{task.priority === 'LOW' ? 'Rendah' : task.priority === 'MEDIUM' ? 'Sedang' : task.priority === 'HIGH' ? 'Tinggi' : 'Mendesak'}</span>
                    {task.due_at && <span className={`inline-flex items-center gap-1 font-medium ${task.is_overdue ? 'text-danger' : 'text-foreground'}`}><Clock className="h-4 w-4" aria-hidden="true" />{task.is_overdue ? 'Terlambat' : 'Tenggat'} {formatDateDisplay(task.due_at)}</span>}
                  </span>
                </button>
                <div className="flex items-center gap-2 self-start sm:self-auto" aria-label="Penanggung jawab">
                  {task.assignees.map((a) => <span key={a.user_id} title={`${a.full_name} ${a.is_primary ? '(Utama)' : ''}`} className={`grid h-9 w-9 place-items-center rounded-full text-xs font-semibold ${a.is_primary ? 'bg-primary text-primary-foreground' : 'bg-surface-subtle text-muted-foreground'}`}>{a.full_name.charAt(0).toUpperCase()}</span>)}
                </div>
              </li>
            ))}
          </ul>
          {hasMore && <div className="flex justify-center"><button type="button" onClick={() => fetchTasks(nextCursor || undefined)} disabled={loadingMore} className="min-h-11 rounded-md border border-border px-4 text-sm font-semibold hover:bg-surface-subtle disabled:opacity-50">{loadingMore ? 'Memuat...' : 'Muat lebih banyak'}</button></div>}
        </div>
      )}

      {/* CREATE TASK MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setIsCreateOpen(false)} />
          <div ref={createDialogRef} role="dialog" aria-modal="true" aria-labelledby="create-task-title" className="relative w-full max-w-lg bg-surface border border-border p-6 rounded-lg shadow-xl overflow-y-auto max-h-[90vh]">
            <h3 id="create-task-title" className="text-lg font-bold mb-4">Buat tugas</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              {createValidationError && (
                <div className="border border-danger/30 bg-danger/10 p-3 rounded text-sm text-danger">
                  {createValidationError}
                </div>
              )}
              <div>
                <label htmlFor="title" className="block text-sm font-semibold mb-1 text-foreground">
                  Judul
                </label>
                <input
                  id="title"
                  type="text"
                  required
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label htmlFor="description" className="block text-sm font-semibold mb-1 text-foreground">
                  Deskripsi
                </label>
                <textarea
                  id="description"
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface focus:ring-2 focus:ring-primary h-20"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="priority" className="block text-sm font-semibold mb-1 text-foreground">
                    Prioritas
                  </label>
                  <select
                    id="priority"
                    value={createPriority}
                    onChange={(e) => setCreatePriority(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface focus:ring-2 focus:ring-primary"
                  >
                    <option value="LOW">Rendah</option>
                    <option value="MEDIUM">Sedang</option>
                    <option value="HIGH">Tinggi</option>
                    <option value="URGENT">Mendesak</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="team_id" className="block text-sm font-semibold mb-1 text-foreground">
                    Tim
                  </label>
                  <select
                    id="team_id"
                    value={createTeamId}
                    onChange={(e) => setCreateTeamId(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Tanpa tim</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="start_at" className="block text-sm font-semibold mb-1 text-foreground">
                    Mulai
                  </label>
                  <input
                    id="start_at"
                    type="datetime-local"
                    value={createStartAt}
                    onChange={(e) => setCreateStartAt(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label htmlFor="due_at" className="block text-sm font-semibold mb-1 text-foreground">
                    Tenggat
                  </label>
                  <input
                    id="due_at"
                    type="datetime-local"
                    value={createDueAt}
                    onChange={(e) => setCreateDueAt(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="enable_recurring"
                  type="checkbox"
                  checked={createRecurring}
                  onChange={(e) => setCreateRecurring(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                <label htmlFor="enable_recurring" className="text-sm font-semibold text-foreground">Tugas berulang</label>
              </div>
              {createRecurring && (
                <div className="space-y-4 border rounded-md p-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="recurrence_frequency" className="block text-sm font-semibold mb-1 text-foreground">Frekuensi</label>
                      <select id="recurrence_frequency" value={createFrequency} onChange={(e) => setCreateFrequency(e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY')} className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface">
                        <option value="DAILY">Harian</option>
                        <option value="WEEKLY">Mingguan</option>
                        <option value="MONTHLY">Bulanan</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="recurrence_interval" className="block text-sm font-semibold mb-1 text-foreground">Interval</label>
                      <input id="recurrence_interval" type="number" min="1" step="1" required value={createInterval} onChange={(e) => setCreateInterval(e.target.value)} className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface" />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="recurrence_timezone" className="block text-sm font-semibold mb-1 text-foreground">Zona waktu pengulangan</label>
                    <input id="recurrence_timezone" type="text" required value={createTimezone} onChange={(e) => setCreateTimezone(e.target.value)} className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface" />
                  </div>
                  <p className="text-sm text-muted-foreground">Pengulangan dimulai dari tanggal mulai tugas. Pola kustom belum didukung.</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="recurrence_end_date" className="block text-sm font-semibold mb-1 text-foreground">Tanggal akhir</label>
                      <input id="recurrence_end_date" type="date" disabled={Boolean(createOccurrenceLimit)} value={createEndDate} onChange={(e) => setCreateEndDate(e.target.value)} className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface disabled:opacity-50" />
                    </div>
                    <div>
                      <label htmlFor="recurrence_occurrence_limit" className="block text-sm font-semibold mb-1 text-foreground">Jumlah kemunculan</label>
                      <input id="recurrence_occurrence_limit" type="number" min="1" step="1" disabled={Boolean(createEndDate)} value={createOccurrenceLimit} onChange={(e) => setCreateOccurrenceLimit(e.target.value)} className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface disabled:opacity-50" />
                    </div>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold mb-1 text-foreground">
                  Penanggung jawab
                </label>
                <div className="space-y-2 border rounded-md p-3 max-h-40 overflow-y-auto border-border">
                  {members.map((m) => {
                    const cur = createAssignees.find((a) => a.user_id === m.user_id);
                    return (
                      <div key={m.user_id} className="flex items-center justify-between text-sm">
                        <label htmlFor={`create_assignee_${m.user_id}`} className="flex items-center gap-2 cursor-pointer">
                          <input
                            id={`create_assignee_${m.user_id}`}
                            type="checkbox"
                            checked={!!cur}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setCreateAssignees((prev) => [...prev, { user_id: m.user_id, is_primary: prev.length === 0 }]);
                              } else {
                                setCreateAssignees((prev) => {
                                  const next = prev.filter((a) => a.user_id !== m.user_id);
                                  if (cur?.is_primary && next.length > 0) {
                                    next[0].is_primary = true;
                                  }
                                  return [...next];
                                });
                              }
                            }}
                            className="rounded border-border text-primary focus:ring-primary"
                          />
                          <span>{m.full_name || m.user?.full_name || m.user_id}</span>
                        </label>
                        {cur && (
                          <button
                            type="button"
                            onClick={() => {
                              setCreateAssignees((prev) =>
                                prev.map((a) => ({ ...a, is_primary: a.user_id === m.user_id }))
                              );
                            }}
                            className={`text-xs px-2 py-0.5 rounded font-bold ${
                              cur.is_primary ? 'bg-primary text-primary-foreground' : 'bg-surface-subtle text-muted-foreground'
                            }`}
                          >
                            {cur.is_primary ? 'Utama' : 'Jadikan utama'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {members.length === 0 && <p className="text-xs text-muted-foreground">Tidak ada anggota.</p>}
                </div>
              </div>
              <div>
                <label htmlFor="initial_status" className="block text-sm font-semibold mb-1 text-foreground">
                  Status awal
                </label>
                <select
                  id="initial_status"
                  value={createStatusId}
                  onChange={(e) => setCreateStatusId(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface focus:ring-2 focus:ring-primary"
                >
                  <option value="">Default (Awal)</option>
                  {allStatuses.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end space-x-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 border border-border rounded-md text-sm hover:bg-surface-subtle hover:bg-surface-subtle"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                >
                  Buat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TASK DETAIL / EDIT MODAL */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={handleCloseDetail} />
          <div ref={detailDialogRef} role="dialog" aria-modal="true" aria-label="Detail tugas" className="relative max-h-[min(90dvh,48rem)] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-xl sm:p-6">
            {conflictError && (
              <div role="alert" className="mb-4 flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/10 p-4 text-danger sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-semibold">Versi tugas berubah</p><p className="text-sm">Tugas ini diperbarui pengguna lain. Muat ulang sebelum melanjutkan.</p></div>
                <button onClick={() => { setConflictError(null); setIsEditMode(false); handleRefreshDetail(selectedTask.id); }} className="min-h-11 rounded-md border border-danger px-3 text-sm font-semibold">Muat ulang</button>
              </div>
            )}

            {!isEditMode ? (
              <div className="space-y-6">
                <header className="space-y-4 border-b border-border pb-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="text-xs font-semibold text-primary">{selectedTask.task_key} · Versi {selectedTask.version}</p><h3 className="mt-1 break-words text-xl font-semibold">{selectedTask.title}</h3></div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button onClick={() => setIsEditMode(true)} className="min-h-11 rounded-md border border-border px-3 text-sm font-medium hover:bg-surface-subtle">Ubah</button>
                      {(currentRole === 'ADMIN' || currentRole === 'MANAGER') && <button type="button" aria-label={`Hapus tugas ${selectedTask.title}`} onClick={handleDelete} className="grid min-h-11 min-w-11 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
                      <button type="button" aria-label="Tutup detail tugas" onClick={handleCloseDetail} className="grid min-h-11 min-w-11 place-items-center rounded-md text-muted-foreground hover:bg-surface-subtle hover:text-foreground"><X className="h-5 w-5" aria-hidden="true" /></button>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div><span className="block text-xs font-medium text-muted-foreground">Status</span><span className="mt-1 block font-semibold">{formatStatusName(selectedTask.status.name)}</span></div>
                    <div><span className="block text-xs font-medium text-muted-foreground">Prioritas</span><span className="mt-1 block font-semibold">{selectedTask.priority === 'LOW' ? 'Rendah' : selectedTask.priority === 'MEDIUM' ? 'Sedang' : selectedTask.priority === 'HIGH' ? 'Tinggi' : 'Mendesak'}</span></div>
                    <div><span className="block text-xs font-medium text-muted-foreground">Tim</span><span className="mt-1 block font-semibold">{teams.find((t) => t.id === selectedTask.team_id)?.name || 'Tanpa tim'}</span></div>
                  </div>
                  <div className={`rounded-md border p-3 ${selectedTask.is_overdue ? 'border-danger/30 bg-danger/10 text-danger' : 'border-border bg-surface-subtle'}`}>
                    <span className="block text-xs font-medium">Tenggat</span><span className="mt-1 flex items-center gap-2 font-semibold"><Calendar className="h-4 w-4" aria-hidden="true" />{selectedTask.due_at ? formatDateTimeDisplay(selectedTask.due_at) : 'Belum ditentukan'}{selectedTask.is_overdue ? ' · Terlambat' : ''}</span>
                  </div>
                </header>

                <section><h4 className="mb-2 text-sm font-semibold">Deskripsi</h4><div className="min-h-16 whitespace-pre-wrap rounded-md border border-border bg-surface-subtle p-3 text-sm">{selectedTask.description || 'Belum ada deskripsi.'}</div></section>

                {/* Transitions */}
                <section className="space-y-2 border-t border-border pt-4">
                  <h4 className="text-sm font-semibold">Ubah status</h4>
                  <div className="flex flex-wrap gap-2">
                    {availableTransitions.map((t) => <button key={t.to_status_id} type="button" onClick={() => handleTransition(t.to_status_id)} className="min-h-11 rounded-md border border-border px-3 text-sm font-medium hover:bg-surface-subtle">{formatTransitionLabel(t.name)}</button>)}
                    {availableTransitions.length === 0 && <span className="text-sm text-muted-foreground">Tidak ada perubahan status tersedia.</span>}
                  </div>
                </section>

                {/* Assignees */}
                <section className="space-y-3 border-t border-border pt-4">
                  <h4 className="flex items-center text-sm font-semibold">
                    <Users className="mr-2 h-4 w-4" aria-hidden="true" />
                    <span>Penanggung jawab</span>
                  </h4>
                  <div className="space-y-2">
                    {members.map((m) => {
                      const cur = assigneeList.find((a) => a.user_id === m.user_id);
                      return (
                        <div key={m.user_id} className="flex items-center justify-between text-sm">
                          <span>{m.full_name || m.user_id}</span>
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
                              className="rounded border-border text-primary focus:ring-primary"
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
                                  cur.is_primary ? 'bg-primary text-primary-foreground' : 'bg-surface-subtle text-muted-foreground'
                                }`}
                              >
                                {cur.is_primary ? 'Utama' : 'Jadikan utama'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button type="button" onClick={handleAssignReplace} className="min-h-11 w-full rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover">
                    Simpan penanggung jawab
                  </button>
                </section>

                {/* Task Comments & Mentions Section */}
                <TaskCommentsSection
                  workspaceId={workspaceId}
                  taskId={selectedTask.id}
                  currentUserId={user?.id || ''}
                  userRole={currentRole}
                  workspaceMembers={members}
                />
              </div>
            ) : (
              // EDIT MODE Form
              <form onSubmit={handleUpdate} className="space-y-4">
                <h3 className="text-lg font-bold mb-4">Ubah tugas</h3>
                {editValidationError && (
                  <div role="alert" className="border border-danger/30 bg-danger/10 p-3 rounded text-sm text-danger">
                    {editValidationError}
                  </div>
                )}
                <div>
                  <label htmlFor="edit_title" className="block text-sm font-semibold mb-1 text-foreground">
                    Judul
                  </label>
                  <input
                    id="edit_title"
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface"
                  />
                </div>
                <div>
                  <label htmlFor="edit_description" className="block text-sm font-semibold mb-1 text-foreground">
                    Deskripsi
                  </label>
                  <textarea
                    id="edit_description"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface h-24"
                  />
                </div>
                <div>
                  <label htmlFor="edit_priority" className="block text-sm font-semibold mb-1 text-foreground">
                    Prioritas
                  </label>
                  <select
                    id="edit_priority"
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT')}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface"
                  >
                    <option value="LOW">Rendah</option>
                    <option value="MEDIUM">Sedang</option>
                    <option value="HIGH">Tinggi</option>
                    <option value="URGENT">Mendesak</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="edit_start_at" className="block text-sm font-semibold mb-1 text-foreground">
                      Mulai
                    </label>
                    <input
                      id="edit_start_at"
                      type="datetime-local"
                      value={editStartAt}
                      onChange={(e) => setEditStartAt(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface"
                    />
                  </div>
                  <div>
                    <label htmlFor="edit_due_at" className="block text-sm font-semibold mb-1 text-foreground">
                      Tenggat
                    </label>
                    <input
                      id="edit_due_at"
                      type="datetime-local"
                      value={editDueAt}
                      onChange={(e) => setEditDueAt(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-surface"
                    />
                  </div>
                </div>
                <div className="flex justify-end space-x-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsEditMode(false)}
                    className="px-4 py-2 border border-border rounded-md text-sm hover:bg-surface-subtle"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                  >
                    Simpan perubahan
                  </button>
                </div>
              </form>
            )}

            <div className="flex justify-between items-center pt-4 border-t mt-6">
              <div>
                {contextReturnUrl && (
                  <button
                    type="button"
                    onClick={() => router.push(contextReturnUrl)}
                    className="rounded-md bg-surface-subtle px-4 py-2 text-sm font-bold text-primary transition hover:bg-surface"
                  >
                    {contextReturnUrl.includes('/kanban') ? 'Kembali ke kanban' : 'Kembali ke kalender'}
                  </button>
                )}
              </div>
              <button
                onClick={handleCloseDetail}
                className="px-4 py-2 border border-border rounded-md text-sm hover:bg-surface-subtle hover:bg-surface-subtle"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
