'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, KanbanBoard, KanbanCardSummary, Team, Workflow, WorkspaceMember } from '../../../../lib/api-client';
import { formatDateDisplay, formatStatusName } from '../../../../lib/i18n-labels';
import { taskRoute } from '../../../../lib/task-route';

const filters = ['workflow_id', 'team_id', 'assignee_id', 'priority', 'due_from', 'due_to'] as const;
const priorityLabels: Record<string, string> = { LOW: 'Rendah', MEDIUM: 'Sedang', HIGH: 'Tinggi', URGENT: 'Mendesak' };
type Transition = { to_status_id: string; code: string; name: string };

export default function KanbanPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const workflow_id = searchParams.get('workflow_id') || '';
  const team_id = searchParams.get('team_id') || '';
  const assignee_id = searchParams.get('assignee_id') || '';
  const priority = searchParams.get('priority') || '';
  const due_from = searchParams.get('due_from') || '';
  const due_to = searchParams.get('due_to') || '';
  const activeFilters = filters.filter((key) => searchParams.get(key));
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [dragged, setDragged] = useState<KanbanCardSummary | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [transitions, setTransitions] = useState<Record<string, Transition[]>>({});
  const transitionRequests = useRef<Record<string, Promise<Transition[]>>>({});
  const moving = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError('');
      const [result, workflowResult, teamResult, memberResult] = await Promise.all([
        api.tasks.kanban(workspaceId, { workflow_id, team_id, assignee_id, priority, due_from, due_to }),
        api.workspaces.workflows(workspaceId), api.workspaces.teams(workspaceId), api.workspaces.members(workspaceId)
      ]);
      setBoard(result.data);
      setWorkflows(workflowResult.data);
      setTeams(teamResult.data);
      setMembers(memberResult.data);
      setTransitions({});
      transitionRequests.current = {};
    } catch { setError('Papan Kanban gagal dimuat. Coba lagi.'); }
    finally { setLoading(false); }
  }, [workspaceId, workflow_id, team_id, assignee_id, priority, due_from, due_to]);

  useEffect(() => { void load(); }, [load]);

  const update = (values: Record<string, string>) => {
    const params = new URLSearchParams(query);
    Object.entries(values).forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
    router.push(`/workspaces/${workspaceId}/kanban${params.size ? `?${params}` : ''}`);
  };

  const getTransitions = (card: KanbanCardSummary) => {
    if (transitions[card.id]) return Promise.resolve(transitions[card.id]);
    if (!transitionRequests.current[card.id]) {
      transitionRequests.current[card.id] = api.tasks.availableTransitions(workspaceId, card.id)
        .then((result) => { setTransitions((old) => ({ ...old, [card.id]: result.data })); return result.data; })
        .finally(() => { delete transitionRequests.current[card.id]; });
    }
    return transitionRequests.current[card.id];
  };

  const move = async (card: KanbanCardSummary, statusId: string) => {
    if (card.status.id === statusId || moving.current) return;
    const previous = board;
    if (!previous || !previous.columns.some((column) => column.status.id === statusId && column.status.is_active !== false)) return;
    moving.current = true;
    try {
      const allowed = await getTransitions(card);
      if (!allowed.some((transition) => transition.to_status_id === statusId)) {
        setError('Perubahan status ini tidak diizinkan.');
        return;
      }
      setError('');
      setBoard({ ...previous, columns: previous.columns.map((column) => ({
        ...column,
        task_count: column.status.id === card.status.id ? column.task_count - 1 : column.status.id === statusId ? column.task_count + 1 : column.task_count,
        cards: column.status.id === card.status.id ? column.cards.filter((item) => item.id !== card.id) : column.status.id === statusId ? [...column.cards, { ...card, status: column.status }] : column.cards
      })) });
      await api.tasks.transition(workspaceId, card.id, { version: card.version, to_status_id: statusId });
      await load();
    } catch (err) {
      setBoard(previous);
      await load();
      setError(err instanceof ApiError && (err.status === 409 || err.code === 'VERSION_CONFLICT')
        ? 'Tugas telah berubah. Papan diperbarui; pilih status lagi.'
        : 'Status gagal diubah. Papan diperbarui; coba lagi.');
    } finally { moving.current = false; setDragged(null); setHovered(null); }
  };

  const returnUrl = `/workspaces/${workspaceId}/kanban${query ? `?${query}` : ''}`;
  const openTask = (card: KanbanCardSummary) => router.push(`${taskRoute(workspaceId, card.id)}&return_to=${encodeURIComponent(returnUrl)}`);

  return (
    <div className="min-w-0 space-y-5 text-foreground">
      <header>
        <h2 className="text-2xl font-bold tracking-tight">Kanban</h2>
        <p className="text-xs text-muted-foreground">{board?.workflow.name || 'Papan tugas'}</p>
      </header>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-subtle"
          >
            Filter
          </button>
          {activeFilters.length > 0 && (
            <>
              <span className="text-xs text-muted-foreground">Filter aktif: {activeFilters.length}</span>
              <button
                type="button"
                onClick={() => update(Object.fromEntries(filters.map((key) => [key, ''])))}
                className="text-xs text-primary underline underline-offset-2"
              >
                Hapus filter
              </button>
            </>
          )}
        </div>
        {(expanded || activeFilters.length > 0) && (
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Alur kerja
              <select
                aria-label="Alur kerja"
                value={workflow_id}
                onChange={(e) => update({ workflow_id: e.target.value })}
                className="min-h-9 rounded-md border border-border bg-surface px-2.5 text-xs text-foreground"
              >
                <option value="">Alur kerja utama</option>
                {workflows.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Tim
              <select
                aria-label="Tim"
                value={team_id}
                onChange={(e) => update({ team_id: e.target.value })}
                className="min-h-9 rounded-md border border-border bg-surface px-2.5 text-xs text-foreground"
              >
                <option value="">Semua tim</option>
                {teams.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Penanggung jawab
              <select
                aria-label="Penanggung jawab"
                value={assignee_id}
                onChange={(e) => update({ assignee_id: e.target.value })}
                className="min-h-9 rounded-md border border-border bg-surface px-2.5 text-xs text-foreground"
              >
                <option value="">Semua penanggung jawab</option>
                {members.map((item) => (
                  <option key={item.user_id} value={item.user_id}>{item.full_name || item.user_id}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Prioritas
              <select
                aria-label="Prioritas"
                value={priority}
                onChange={(e) => update({ priority: e.target.value })}
                className="min-h-9 rounded-md border border-border bg-surface px-2.5 text-xs text-foreground"
              >
                <option value="">Semua prioritas</option>
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Tenggat dari
              <input
                aria-label="Tenggat dari"
                type="date"
                value={due_from}
                onChange={(e) => update({ due_from: e.target.value })}
                className="min-h-9 rounded-md border border-border bg-surface px-2.5 text-xs text-foreground"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Tenggat sampai
              <input
                aria-label="Tenggat sampai"
                type="date"
                value={due_to}
                onChange={(e) => update({ due_to: e.target.value })}
                className="min-h-9 rounded-md border border-border bg-surface px-2.5 text-xs text-foreground"
              />
            </label>
          </div>
        )}
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
          {error}
          <button type="button" onClick={() => void load()} className="ml-3 underline">Muat ulang</button>
        </div>
      )}
      {loading ? (
        <p role="status" className="py-10 text-xs text-muted-foreground">Memuat papan Kanban...</p>
      ) : !board ? null : (
        <>
          {board.columns.every((column) => column.cards.length === 0) && (
            <p className="rounded-xl border border-dashed border-border/80 px-4 py-8 text-center text-xs text-muted-foreground">
              Belum ada tugas
            </p>
          )}
          <div aria-label="Papan Kanban" className="flex min-w-0 snap-x gap-3 overflow-x-auto pb-4">
            {board.columns.map((column) => {
              const archived = column.status.is_active === false;
              // ponytail: valid is transition-cache-aware for UI feedback; dragOver accepts drop for non-archived targets so browser enables drop cursor; drop handler validates transitions before committing
              const canReceive = !!dragged && !archived && dragged.status.id !== column.status.id;
              const valid = canReceive && !!transitions[dragged?.id ?? '']?.some((item) => item.to_status_id === column.status.id);
              return (
                <section
                  key={column.status.id}
                  aria-label={archived ? `${formatStatusName(column.status.name)} (diarsipkan, tidak dapat menerima tugas)` : formatStatusName(column.status.name)}
                  onDragOver={(e) => { if (canReceive) { e.preventDefault(); } setHovered(column.status.id); }}
                  onDragLeave={() => setHovered(null)}
                  onDrop={(e) => { if (valid && dragged) { e.preventDefault(); void move(dragged, column.status.id); } setHovered(null); }}
                  className={`w-[min(18rem,85vw)] shrink-0 snap-start rounded-xl border bg-surface-subtle/50 p-3 ${
                    archived ? 'border-dashed border-border/60 opacity-75' : 'border-border/80'
                  } ${hovered === column.status.id ? (valid ? 'ring-2 ring-primary' : 'ring-2 ring-danger') : ''}`}
                >
                  <h3 className="flex items-center justify-between gap-2 border-b border-border/60 pb-2.5 text-xs font-semibold text-foreground">
                    <span>{formatStatusName(column.status.name)}</span>
                    <span className="rounded-md border border-border/50 bg-surface px-2 py-0.5 tabular-nums text-muted-foreground">
                      {column.task_count}
                    </span>
                  </h3>
                  {archived && <p className="mt-2 text-xs text-muted-foreground">Tidak dapat menerima tugas</p>}
                  {hovered === column.status.id && dragged && (
                    <p role="status" className={`mt-2 text-xs ${valid ? 'text-primary' : 'text-danger'}`}>
                      {valid ? 'Lepaskan untuk memindahkan' : 'Tidak dapat dipindahkan ke sini'}
                    </p>
                  )}
                  <div className="mt-3 space-y-2">
                    {column.cards.map((card) => (
                      <article
                        key={card.id}
                        draggable
                        onDragStart={() => { setDragged(card); void getTransitions(card).catch(() => setError('Pilihan status gagal dimuat.')); }}
                        onDragEnd={() => { setDragged(null); setHovered(null); }}
                        style={{ backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}
                        className="rounded-lg border border-border/50 bg-surface p-3 transition-colors hover:border-border"
                      >
                        <button
                          type="button"
                          onClick={() => openTask(card)}
                          className="block w-full text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                        >
                          <span className="text-[11px] font-semibold text-primary">{card.task_key}</span>
                          <strong className="mt-1 block text-xs font-semibold leading-snug text-foreground">{card.title}</strong>
                        </button>
                        <p className="mt-2.5 text-[11px] text-muted-foreground">
                          {priorityLabels[card.priority]} · {card.assignees.find((item) => item.is_primary)?.full_name || 'Belum ditugaskan'}
                        </p>
                        <p className={`mt-1 text-[11px] ${card.is_overdue ? 'font-medium text-danger' : 'text-muted-foreground'}`}>
                          {card.is_overdue ? 'Terlambat · ' : ''}{card.due_at ? formatDateDisplay(card.due_at) : 'Tanpa tenggat'}
                        </p>
                        <select
                          aria-label={`Ubah status ${card.title}`}
                          className="mt-2.5 w-full rounded-md border border-border/80 bg-surface px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                          value={card.status.id}
                          onFocus={() => void getTransitions(card).catch(() => setError('Pilihan status gagal dimuat.'))}
                          onChange={(e) => void move(card, e.target.value)}
                        >
                          <option value={card.status.id}>{formatStatusName(card.status.name)}</option>
                          {(transitions[card.id] || []).filter((target) => target.to_status_id !== card.status.id && board.columns.some((col) => col.status.id === target.to_status_id && col.status.is_active !== false)).map((target) => (
                            <option key={target.to_status_id} value={target.to_status_id}>{formatStatusName(target.name)}</option>
                          ))}
                        </select>
                      </article>
                    ))}
                    {column.cards.length === 0 && (
                      <p className="py-5 text-center text-xs text-muted-foreground">Tidak ada tugas di status ini</p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
