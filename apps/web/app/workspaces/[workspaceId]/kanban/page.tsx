'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, KanbanBoard, KanbanCardSummary, Team, Workflow, WorkspaceMember } from '../../../../lib/api-client';
import { taskRoute } from '../../../../lib/task-route';

export default function KanbanPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const router = useRouter();
  const searchParams = useSearchParams();
  const workflow_id = searchParams.get('workflow_id') || '';
  const team_id = searchParams.get('team_id') || '';
  const assignee_id = searchParams.get('assignee_id') || '';
  const priority = searchParams.get('priority') || '';
  const due_from = searchParams.get('due_from') || '';
  const due_to = searchParams.get('due_to') || '';
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [error, setError] = useState('');
  const [dragged, setDragged] = useState<KanbanCardSummary | null>(null);

  const load = useCallback(async () => {
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
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load kanban'); }
  }, [workspaceId, workflow_id, team_id, assignee_id, priority, due_from, due_to]);

  useEffect(() => { void load(); }, [load]);

  const update = (values: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(values).forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
    router.push(`/workspaces/${workspaceId}/kanban?${params}`);
  };

  const move = async (card: KanbanCardSummary, statusId: string) => {
    if (card.status.id === statusId) return;
    const previous = board;
    if (!previous) return;
    setBoard({ ...previous, columns: previous.columns.map((column) => ({ ...column, task_count: column.status.id === card.status.id ? column.task_count - 1 : column.status.id === statusId ? column.task_count + 1 : column.task_count, cards: column.status.id === card.status.id ? column.cards.filter((item) => item.id !== card.id) : column.status.id === statusId ? [...column.cards, { ...card, status: column.status }] : column.cards })) });
    try {
      const transitions = await api.tasks.availableTransitions(workspaceId, card.id);
      if (!transitions.data.some((transition) => transition.to_status_id === statusId)) throw new ApiError(422, 'INVALID_TRANSITION', 'The requested status change is not allowed.');
      await api.tasks.transition(workspaceId, card.id, { version: card.version, to_status_id: statusId });
      await load();
    } catch (err) {
      setBoard(previous);
      const message = err instanceof ApiError ? err.code : 'Transition failed';
      await load();
      setError(message);
    }
  };

  const due = (card: KanbanCardSummary) => card.due_at ? new Date(card.due_at).toLocaleDateString() : 'No due date';
  return <div className="space-y-4">
    <div><h2 className="text-2xl font-bold">Kanban</h2><p className="text-sm text-gray-500">{board?.workflow.name || 'Loading workflow'}</p></div>
    <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
      <select aria-label="Workflow" value={workflow_id} onChange={(e) => update({ workflow_id: e.target.value })}><option value="">Default workflow</option>{workflows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select aria-label="Team" value={team_id} onChange={(e) => update({ team_id: e.target.value })}><option value="">All teams</option>{teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select aria-label="Assignee" value={assignee_id} onChange={(e) => update({ assignee_id: e.target.value })}><option value="">All assignees</option>{members.map((item) => <option key={item.user_id} value={item.user_id}>{item.full_name || item.user_id}</option>)}</select>
      <select aria-label="Priority" value={priority} onChange={(e) => update({ priority: e.target.value })}><option value="">All priorities</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select>
      <input aria-label="Due from" type="date" value={due_from} onChange={(e) => update({ due_from: e.target.value })} />
      <input aria-label="Due to" type="date" value={due_to} onChange={(e) => update({ due_to: e.target.value })} />
    </div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <div className="flex gap-4 overflow-x-auto pb-4">{board?.columns.map((column) => <section key={column.status.id} onDragOver={(e) => e.preventDefault()} onDrop={() => dragged && void move(dragged, column.status.id)} className="w-72 shrink-0 rounded border bg-gray-50 p-3 dark:bg-gray-900"><h3 className="flex justify-between font-semibold"><span>{column.status.name}</span><span>{column.task_count}</span></h3><div className="mt-3 space-y-3">{column.cards.map((card) => <article key={card.id} draggable onDragStart={() => setDragged(card)} className="rounded border bg-white p-3 shadow-sm dark:bg-gray-800"><button onClick={() => router.push(taskRoute(workspaceId, card.id))} className="block w-full text-left"><span className="text-xs font-bold text-blue-600">{card.task_key}</span><strong className="block">{card.title}</strong></button><p className="mt-2 text-xs">{card.priority} · {card.assignees.find((item) => item.is_primary)?.full_name || 'Unassigned'}</p><p className={card.is_overdue ? 'text-xs text-red-600' : 'text-xs text-gray-500'}>{card.is_overdue ? 'Overdue · ' : ''}{due(card)}</p><select aria-label={`Change status for ${card.title}`} className="mt-2 w-full text-xs" value={card.status.id} onChange={(e) => void move(card, e.target.value)}><option value={card.status.id}>{column.status.name}</option>{board.columns.filter((target) => target.status.id !== card.status.id).map((target) => <option key={target.status.id} value={target.status.id}>{target.status.name}</option>)}</select></article>)}</div></section>)}</div>
  </div>;
}
