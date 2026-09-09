'use client';

import React, { useEffect, useState } from 'react';
import { Team, WorkflowDetail } from '../lib/api-client';

export default function WorkflowMetadataCard({ workflow, teams, pending, onUpdate, onSetDefault, onArchive, onRestore, onReload }: {
  workflow: WorkflowDetail;
  teams: Team[];
  pending?: boolean;
  onUpdate: (body: { name?: string; description?: string | null; version: number }) => Promise<string | void>;
  onSetDefault: () => Promise<string | void>;
  onArchive: () => Promise<string | void>;
  onRestore: () => Promise<string | void>;
  onReload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description || '');
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    setName(workflow.name);
    setDescription(workflow.description || '');
    setConflict(false);
  }, [workflow.id, workflow.version, workflow.name, workflow.description]);

  const startEdit = () => { setName(workflow.name); setDescription(workflow.description || ''); setEditing(true); };
  const cancelEdit = () => { setEditing(false); };

  const handleSave = async () => {
    setSaving(true);
    const result = await onUpdate({ name: name.trim(), description: description.trim() || null, version: workflow.version });
    setSaving(false);
    if (result === 'VERSION_CONFLICT') { setConflict(true); return; }
    if (result !== 'ERROR') setEditing(false);
  };

  const handleSetDefault = async () => {
    const result = await onSetDefault();
    if (result === 'VERSION_CONFLICT') setConflict(true);
  };

  const handleArchive = async () => {
    const result = await onArchive();
    if (result === 'VERSION_CONFLICT') setConflict(true);
    setConfirmArchive(false);
  };

  const handleRestore = async () => {
    const result = await onRestore();
    if (result === 'VERSION_CONFLICT') setConflict(true);
  };

  const handleReload = async () => {
    await onReload();
    setConflict(false);
  };

  const isWorkspaceDefault = workflow.is_default && workflow.team_id === null;
  const teamName = workflow.team_id ? teams.find((t) => t.id === workflow.team_id)?.name || 'Unknown' : null;

  return (
    <section aria-label="Workflow Details" className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">Workflow Details</h3>
        <span className="text-xs text-gray-500">v{workflow.version}</span>
      </div>

      {conflict && (
        <div role="alert" className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          Version conflict detected. The workflow was modified elsewhere.
          <button onClick={handleReload} className="ml-2 font-bold text-blue-600 hover:underline">Reload Workflow</button>
        </div>
      )}

      {editing ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="edit_name" className="mb-1 block text-sm font-medium">Name</label>
            <input id="edit_name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
          </div>
          <div>
            <label htmlFor="edit_desc" className="mb-1 block text-sm font-medium">Description</label>
            <textarea id="edit_desc" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800 h-20" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={pending || saving} className="px-4 py-2 text-sm font-bold bg-blue-600 text-white rounded disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
            <button onClick={cancelEdit} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-lg">{workflow.name}</span>
            <span className="text-xs text-gray-500">({workflow.code})</span>
            {workflow.is_default && <span className="text-xs px-2 py-0.5 rounded font-medium bg-yellow-100 text-yellow-800">Default</span>}
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${workflow.team_id ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{teamName ? `Team: ${teamName}` : 'Workspace'}</span>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${workflow.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>{workflow.is_active ? 'Active' : 'Archived'}</span>
          </div>
          {workflow.description && <p className="text-sm text-gray-500">{workflow.description}</p>}

          <div className="flex gap-2 flex-wrap">
            <button onClick={startEdit} className="px-3 py-1 text-xs font-bold border rounded hover:bg-gray-50 dark:hover:bg-gray-800">Edit</button>
            {workflow.is_active && !workflow.is_default && (
              <button onClick={handleSetDefault} className="px-3 py-1 text-xs font-bold border rounded hover:bg-gray-50 dark:hover:bg-gray-800">Set Default</button>
            )}
            {workflow.is_active && (
              isWorkspaceDefault ? (
                <button disabled className="px-3 py-1 text-xs font-bold border rounded opacity-50 cursor-not-allowed" title="Cannot archive the workspace default workflow. Set another workflow as default first.">Archive</button>
              ) : (
                <button onClick={() => setConfirmArchive(true)} className="px-3 py-1 text-xs font-bold bg-gray-200 text-gray-700 rounded hover:bg-gray-300">Archive</button>
              )
            )}
            {!workflow.is_active && (
              <button onClick={handleRestore} className="px-3 py-1 text-xs font-bold bg-blue-600 text-white rounded hover:bg-blue-700">Restore</button>
            )}
          </div>
        </div>
      )}

      {confirmArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setConfirmArchive(false)} />
          <div role="dialog" aria-modal="true" aria-label="Confirm Archive" className="relative w-full max-w-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 rounded-lg shadow-xl">
            <h4 className="font-bold mb-2">Archive Workflow</h4>
            <p className="text-sm text-gray-600 mb-4">Existing tasks will remain attached to this workflow. New tasks cannot use an archived workflow.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmArchive(false)} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">Cancel</button>
              <button onClick={handleArchive} className="px-4 py-2 text-sm font-bold bg-red-600 text-white rounded hover:bg-red-700">Archive</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
