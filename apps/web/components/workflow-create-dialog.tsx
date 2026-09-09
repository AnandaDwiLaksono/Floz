'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ApiError, Team, WorkflowDetail } from '../lib/api-client';

interface StatusInput {
  name: string;
  code: string;
  category: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  is_initial: boolean;
}

interface TransitionInput {
  from_status_code: string;
  to_status_code: string;
}

const defaultStatuses: StatusInput[] = [
  { name: 'Backlog', code: 'BACKLOG', category: 'TODO', is_initial: true },
  { name: 'In Progress', code: 'IN_PROGRESS', category: 'IN_PROGRESS', is_initial: false },
  { name: 'Done', code: 'DONE', category: 'DONE', is_initial: false },
];

const defaultTransitions: TransitionInput[] = [
  { from_status_code: 'BACKLOG', to_status_code: 'IN_PROGRESS' },
  { from_status_code: 'IN_PROGRESS', to_status_code: 'DONE' },
  { from_status_code: 'IN_PROGRESS', to_status_code: 'BACKLOG' },
];

export default function WorkflowCreateDialog({ teams, onClose, onCreate }: {
  teams: Team[];
  onClose: () => void;
  onCreate: (body: { name: string; code: string; description?: string | null; team_id?: string | null; statuses: StatusInput[]; transitions: TransitionInput[] }) => Promise<WorkflowDetail>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') || []);
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); trigger?.focus(); };
  }, []);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [teamId, setTeamId] = useState('');
  const [statuses, setStatuses] = useState<StatusInput[]>(defaultStatuses);
  const [transitions, setTransitions] = useState<TransitionInput[]>(defaultTransitions);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [newStatusName, setNewStatusName] = useState('');
  const [newStatusCode, setNewStatusCode] = useState('');
  const [newStatusCategory, setNewStatusCategory] = useState<'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'>('TODO');

  const addStatus = () => {
    if (!newStatusName.trim() || !newStatusCode.trim()) { setError('Status name and code are required.'); return; }
    const normalizedCode = newStatusCode.trim().toUpperCase();
    if (statuses.some((status) => status.name.toLowerCase() === newStatusName.trim().toLowerCase() || status.code === normalizedCode)) { setError('Status names and codes must be unique.'); return; }
    setError(null);
    setStatuses([...statuses, { name: newStatusName.trim(), code: normalizedCode, category: newStatusCategory, is_initial: false }]);
    setNewStatusName('');
    setNewStatusCode('');
  };

  const removeStatus = (idx: number) => {
    const s = statuses[idx];
    setStatuses(statuses.filter((_, i) => i !== idx));
    setTransitions(transitions.filter((t) => t.from_status_code !== s.code && t.to_status_code !== s.code));
  };

  const setInitial = (idx: number) => {
    setStatuses(statuses.map((s, i) => ({ ...s, is_initial: i === idx })));
  };

  const toggleTransition = (from: string, to: string) => {
    const exists = transitions.some((t) => t.from_status_code === from && t.to_status_code === to);
    if (exists) {
      setTransitions(transitions.filter((t) => !(t.from_status_code === from && t.to_status_code === to)));
    } else {
      setTransitions([...transitions, { from_status_code: from, to_status_code: to }]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !code.trim()) { setError('Name and code are required.'); return; }
    if (statuses.length === 0) { setError('At least one status is required.'); return; }
    if (!statuses.some((s) => s.is_initial)) { setError('Exactly one initial status is required.'); return; }
    if (!statuses.some((s) => s.category === 'DONE' || s.category === 'CANCELLED')) { setError('At least one terminal status (DONE or CANCELLED) is required.'); return; }
    setSaving(true);
    try {
      await onCreate({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        description: description.trim() || undefined,
        team_id: teamId || null,
        statuses,
        transitions,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed.');
    } finally { setSaving(false); }
  };

  const activeTeams = teams.filter((t) => t.isActive);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Create Workflow" className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 rounded-lg shadow-xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h3 className="text-lg font-bold">New Workflow</h3>
          {error && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="wf_name" className="mb-1 block text-sm font-medium">Name</label>
              <input id="wf_name" type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
            </div>
            <div>
              <label htmlFor="wf_code" className="mb-1 block text-sm font-medium">Code</label>
              <input id="wf_code" type="text" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="w-full rounded border px-3 py-2 dark:bg-gray-800 uppercase" />
            </div>
          </div>

          <div>
            <label htmlFor="wf_desc" className="mb-1 block text-sm font-medium">Description</label>
            <textarea id="wf_desc" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800 h-16" />
          </div>

          <div>
            <label htmlFor="wf_team" className="mb-1 block text-sm font-medium">Team scope</label>
            <select id="wf_team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800">
              <option value="">Workspace-wide</option>
              {activeTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-2">Statuses</h4>
            <div className="space-y-1">
              {statuses.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-sm bg-gray-50 dark:bg-gray-800 p-2 rounded">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-gray-500">{s.code}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700">{s.category}</span>
                  {s.is_initial && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Initial</span>}
                  {!s.is_initial && (s.category === 'TODO' || s.category === 'IN_PROGRESS') && <button type="button" onClick={() => setInitial(i)} className="text-xs text-blue-600 hover:underline">Set Initial</button>}
                  <button type="button" onClick={() => removeStatus(i)} className="text-xs text-red-600 hover:underline ml-auto">Remove</button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <input placeholder="Name" value={newStatusName} onChange={(e) => setNewStatusName(e.target.value)} className="flex-1 rounded border px-2 py-1 text-sm dark:bg-gray-800" />
              <input placeholder="CODE" value={newStatusCode} onChange={(e) => setNewStatusCode(e.target.value.toUpperCase())} className="w-24 rounded border px-2 py-1 text-sm dark:bg-gray-800 uppercase" />
              <select value={newStatusCategory} onChange={(e) => setNewStatusCategory(e.target.value as StatusInput['category'])} className="rounded border px-2 py-1 text-sm dark:bg-gray-800">
                <option value="TODO">TODO</option>
                <option value="IN_PROGRESS">IN_PROGRESS</option>
                <option value="DONE">DONE</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
              <button type="button" onClick={addStatus} className="px-3 py-1 text-sm font-bold bg-gray-200 rounded hover:bg-gray-300 dark:bg-gray-700">Add</button>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-2">Transitions</h4>
            <div className="overflow-x-auto">
              <table className="text-xs w-full border-collapse">
                <thead>
                  <tr>
                    <th className="p-1 border text-left">From \ To</th>
                    {statuses.map((s) => <th key={s.code} className="p-1 border">{s.code}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {statuses.map((from) => (
                    <tr key={from.code}>
                      <td className="p-1 border font-medium">{from.code}</td>
                      {statuses.map((to) => (
                        <td key={to.code} className="p-1 border text-center">
                          {from.code === to.code ? (
                            <span className="text-gray-300">—</span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={transitions.some((t) => t.from_status_code === from.code && t.to_status_code === to.code)}
                              onChange={() => toggleTransition(from.code, to.code)}
                              aria-label={`Transition from ${from.name} to ${to.name}`}
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-bold bg-blue-600 text-white rounded disabled:opacity-50">{saving ? 'Creating...' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
