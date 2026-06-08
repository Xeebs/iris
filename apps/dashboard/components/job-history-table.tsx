'use client';

import React, { useEffect, useState } from 'react';

interface ImportExportJob {
  id: string;
  type: 'import' | 'export';
  status: 'pending' | 'running' | 'completed' | 'failed';
  format: string | null;
  record_count: number | null;
  file_name: string | null;
  error_message: string | null;
  result_url: string | null;
  created_by: string;
  created_at: string;
  completed_at: string | null;
}

interface JobHistoryTableProps {
  workspaceId: string;
}

const STATUS_CLASSES: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  running: 'bg-blue-100 text-blue-800',
  pending: 'bg-gray-100 text-gray-700',
};

export function JobHistoryTable({ workspaceId }: JobHistoryTableProps) {
  const [jobs, setJobs] = useState<ImportExportJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/data/jobs?workspaceId=${encodeURIComponent(workspaceId)}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error?.message ?? 'Failed to load jobs'); return; }
      setJobs(json.data ?? []);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchJobs(); }, [workspaceId]);

  if (isLoading) return <p className="text-sm text-gray-500">Loading job history…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (jobs.length === 0) return <p className="text-sm text-gray-500">No import/export jobs yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="text-sm w-full border-collapse">
        <thead>
          <tr className="bg-gray-50 text-left">
            <th className="border px-3 py-2">Type</th>
            <th className="border px-3 py-2">Status</th>
            <th className="border px-3 py-2">Format</th>
            <th className="border px-3 py-2">Records</th>
            <th className="border px-3 py-2">Created</th>
            <th className="border px-3 py-2">Duration</th>
            <th className="border px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const duration = job.completed_at
              ? Math.round((new Date(job.completed_at).getTime() - new Date(job.created_at).getTime()) / 1000)
              : null;
            return (
              <tr key={job.id} className="hover:bg-gray-50">
                <td className="border px-3 py-2 capitalize">{job.type}</td>
                <td className="border px-3 py-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_CLASSES[job.status] ?? ''}`}>
                    {job.status}
                  </span>
                </td>
                <td className="border px-3 py-2 uppercase">{job.format ?? '—'}</td>
                <td className="border px-3 py-2">{job.record_count?.toLocaleString() ?? '—'}</td>
                <td className="border px-3 py-2 text-gray-600 text-xs">{new Date(job.created_at).toLocaleString()}</td>
                <td className="border px-3 py-2 text-gray-600">{duration !== null ? `${duration}s` : '—'}</td>
                <td className="border px-3 py-2">
                  {job.result_url && (
                    <a href={job.result_url} className="text-blue-600 hover:underline text-xs">Download</a>
                  )}
                  {job.error_message && (
                    <span className="text-red-600 text-xs" title={job.error_message}>Error</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button onClick={fetchJobs} className="mt-2 text-xs text-blue-600 hover:underline">Refresh</button>
    </div>
  );
}
