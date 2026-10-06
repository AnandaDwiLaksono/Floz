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
  const teamName = workflow.team_id ? teams.find((t) => t.id === workflow.team_id)?.name || 'Tidak diketahui' : null;

  return (
    <section aria-label="Workflow Details" className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">Detail Alur Kerja</h3>
        <span className="text-xs text-gray-500">v{workflow.version}</span>
      </div>

      {conflict && (
        <div role="alert" className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          Konflik versi terdeteksi. Alur kerja telah dimodifikasi di tempat lain.
          <button onClick={handleReload} className="ml-2 font-bold text-blue-600 hover:underline">Muat Ulang Konfigurasi</button>
        </div>
      )}

      {editing ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="edit_name" className="mb-1 block text-sm font-medium">Nama</label>
            <input id="edit_name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
          </div>
          <div>
            <label htmlFor="edit_desc" className="mb-1 block text-sm font-medium">Deskripsi</label>
            <textarea id="edit_desc" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800 h-20" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={pending || saving} className="px-4 py-2 text-sm font-bold bg-blue-600 text-white rounded disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan'}</button>
            <button onClick={cancelEdit} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">Batal</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-lg">{workflow.name}</span>
            <span className="text-xs text-gray-500">({workflow.code})</span>
            {workflow.is_default && <span className="text-xs px-2 py-0.5 rounded font-medium bg-yellow-100 text-yellow-800">Bawaan</span>}
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${workflow.team_id ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{teamName ? `Tim: ${teamName}` : 'Ruang Kerja'}</span>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${workflow.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>{workflow.is_active ? 'Aktif' : 'Diarsipkan'}</span>
          </div>
          {workflow.description && <p className="text-sm text-gray-500">{workflow.description}</p>}

          <div className="flex gap-2 flex-wrap">
            <button onClick={startEdit} className="px-3 py-1 text-xs font-bold border rounded hover:bg-gray-50 dark:hover:bg-gray-800">Ubah</button>
            {workflow.is_active && !workflow.is_default && (
              <button onClick={handleSetDefault} aria-label="Set Default" className="px-3 py-1 text-xs font-bold border rounded hover:bg-gray-50 dark:hover:bg-gray-800">Jadikan Bawaan</button>
            )}
            {workflow.is_active && (
              isWorkspaceDefault ? (
                <button disabled className="px-3 py-1 text-xs font-bold border rounded opacity-50 cursor-not-allowed" title="Tidak dapat mengarsipkan alur kerja bawaan ruang kerja. Jadikan alur kerja lain sebagai bawaan terlebih dahulu.">Arsipkan</button>
              ) : (
                <button onClick={() => setConfirmArchive(true)} className="px-3 py-1 text-xs font-bold bg-gray-200 text-gray-700 rounded hover:bg-gray-300">Arsipkan</button>
              )
            )}
            {!workflow.is_active && (
              <button onClick={handleRestore} className="px-3 py-1 text-xs font-bold bg-blue-600 text-white rounded hover:bg-blue-700">Pulihkan</button>
            )}
          </div>
        </div>
      )}

      {confirmArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setConfirmArchive(false)} />
          <div role="dialog" aria-modal="true" aria-label="Konfirmasi Arsip" className="relative w-full max-w-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 rounded-lg shadow-xl">
            <h4 className="font-bold mb-2">Arsipkan Alur Kerja</h4>
            <p className="text-sm text-gray-600 mb-4">Tugas yang ada akan tetap terhubung ke alur kerja ini. Tugas baru tidak dapat menggunakan alur kerja yang diarsipkan.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmArchive(false)} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">Batal</button>
              <button onClick={handleArchive} className="px-4 py-2 text-sm font-bold bg-red-600 text-white rounded hover:bg-red-700">Arsipkan</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
