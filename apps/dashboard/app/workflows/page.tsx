'use client';

import { useState, useEffect, useCallback } from 'react';
import { WorkflowCatalogGrid, type CuratedTemplate } from '../../components/workflow-catalog-grid.js';
import { WorkflowDetailPanel } from '../../components/workflow-detail-panel.js';
import { ExecuteWorkflowForm, type ExecuteParams } from '../../components/execute-workflow-form.js';
import { RecentWorkflowsList, type WorkflowSession } from '../../components/recent-workflows-list.js';

const API_BASE = '/api/v1/workflows';
const WORKSPACE_ID = 'default';
const USER_ID = 'current-user';

export default function WorkflowsPage() {
  const [templates, setTemplates] = useState<CuratedTemplate[]>([]);
  const [sessions, setSessions] = useState<WorkflowSession[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<CuratedTemplate | null>(null);
  const [executing, setExecuting] = useState(false);
  const [showExecuteForm, setShowExecuteForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(API_BASE);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: CuratedTemplate[] };
      setTemplates(body.data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load workflows');
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${USER_ID}?workspaceId=${WORKSPACE_ID}`);
      if (!res.ok) return;
      const body = await res.json() as { data: WorkflowSession[] };
      setSessions(body.data);
    } catch {
      // non-critical — session history is best-effort
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
    void loadSessions();
  }, [loadTemplates, loadSessions]);

  async function handleExecute(params: ExecuteParams) {
    if (!selectedTemplate) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/${selectedTemplate.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          parameters: params,
          contextBudget: params.contextBudget,
        }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      setSuccessMsg(`Workflow "${selectedTemplate.name}" started successfully.`);
      setShowExecuteForm(false);
      setSelectedTemplate(null);
      await loadSessions();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Workflow Catalog</h1>
        <p className="text-sm text-gray-500 mt-1">
          Pre-configured MCP query sequences. Select a workflow to preview and execute.
        </p>
      </div>

      {loadError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{loadError}</div>
      )}
      {successMsg && (
        <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded text-sm flex justify-between">
          {successMsg}
          <button type="button" onClick={() => setSuccessMsg(null)} className="text-green-500 hover:text-green-700">×</button>
        </div>
      )}

      {templates.length === 0 && !loadError ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading workflows…</div>
      ) : (
        <WorkflowCatalogGrid
          templates={templates}
          onSelect={(t) => {
            setSelectedTemplate(t);
            setShowExecuteForm(false);
            setExecuting(false);
          }}
        />
      )}

      {selectedTemplate && !showExecuteForm && (
        <WorkflowDetailPanel
          template={selectedTemplate}
          onExecute={() => { setShowExecuteForm(true); setExecuting(true); }}
          onClose={() => { setSelectedTemplate(null); setExecuting(false); }}
        />
      )}

      {selectedTemplate && showExecuteForm && executing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 m-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">
                Execute: {selectedTemplate.name}
              </h2>
              <button
                type="button"
                onClick={() => { setShowExecuteForm(false); setExecuting(false); }}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            <ExecuteWorkflowForm
              template={selectedTemplate}
              onSubmit={handleExecute}
              onCancel={() => { setShowExecuteForm(false); setExecuting(false); }}
              isSubmitting={isSubmitting}
            />
          </div>
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Recent Executions</h2>
        <RecentWorkflowsList
          sessions={sessions}
          onViewResult={(id) => {
            window.open(`${API_BASE}/sessions/${id}/result`, '_blank');
          }}
        />
      </section>
    </main>
  );
}
