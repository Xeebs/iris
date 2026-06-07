'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  variables: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RenderPreview {
  subject: string;
  htmlBody: string;
  textBody: string;
}

interface EmailTemplateEditorProps {
  workspaceId: string;
}

const SAMPLE_VARIABLES: Record<string, string> = {
  alertName: 'High Sync Failure Rate',
  message: 'Sync failure threshold exceeded in the last hour.',
  ruleName: 'Sync Failure Alert',
  condition: 'sync_failure',
  value: '12',
  threshold: '5',
  workspaceName: 'Acme Corp',
};

function interpolatePreview(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export function EmailTemplateEditor({ workspaceId }: EmailTemplateEditorProps) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selected, setSelected] = useState<EmailTemplate | null>(null);
  const [form, setForm] = useState({ name: '', subject: '', htmlBody: '', textBody: '' });
  const [preview, setPreview] = useState<RenderPreview | null>(null);
  const [previewTab, setPreviewTab] = useState<'html' | 'text'>('html');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/email-templates', {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error('Failed to fetch templates');
      const data = (await res.json()) as { data: EmailTemplate[] };
      setTemplates(data.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const selectTemplate = (tmpl: EmailTemplate) => {
    setSelected(tmpl);
    setForm({ name: tmpl.name, subject: tmpl.subject, htmlBody: tmpl.htmlBody, textBody: tmpl.textBody });
    setPreview(null);
    setError(null);
    setSuccessMsg(null);
  };

  const newTemplate = () => {
    setSelected(null);
    setForm({ name: '', subject: '', htmlBody: '<p>{{message}}</p>', textBody: '{{message}}' });
    setPreview(null);
    setError(null);
  };

  const updatePreview = () => {
    setPreview({
      subject: interpolatePreview(form.subject, SAMPLE_VARIABLES),
      htmlBody: interpolatePreview(form.htmlBody, SAMPLE_VARIABLES),
      textBody: interpolatePreview(form.textBody, SAMPLE_VARIABLES),
    });
  };

  const saveTemplate = async () => {
    if (!form.name.trim() || !form.subject.trim()) {
      setError('Name and subject are required.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/v1/email-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({
          name: form.name,
          subject: form.subject,
          htmlBody: form.htmlBody,
          textBody: form.textBody,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error: { message: string } };
        throw new Error(body.error?.message ?? 'Save failed');
      }
      const body = (await res.json()) as { data: EmailTemplate };
      setSuccessMsg(`Template "${body.data.name}" saved.`);
      await fetchTemplates();
      selectTemplate(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    try {
      const res = await fetch(`/api/v1/email-templates/${id}`, {
        method: 'DELETE',
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error('Delete failed');
      setSelected(null);
      setForm({ name: '', subject: '', htmlBody: '', textBody: '' });
      setPreview(null);
      await fetchTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Template list */}
      <Card className="lg:col-span-1">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Templates</CardTitle>
          <Button variant="outline" size="sm" onClick={newTemplate}>+ New</Button>
        </CardHeader>
        <CardContent className="space-y-2 px-2">
          {loading ? (
            <p className="px-2 text-sm text-muted-foreground">Loading...</p>
          ) : templates.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">No templates yet.</p>
          ) : (
            templates.map((tmpl) => (
              <button
                key={tmpl.id}
                onClick={() => selectTemplate(tmpl)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${selected?.id === tmpl.id ? 'bg-muted font-medium' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate">{tmpl.name}</span>
                  {tmpl.isDefault && <Badge className="ml-1 shrink-0 bg-blue-100 text-blue-700 text-xs">Default</Badge>}
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {/* Editor + preview */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{selected ? `Edit: ${selected.name}` : 'New Template'}</CardTitle>
          <CardDescription>Use {`{{variable}}`} syntax for dynamic values.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          {successMsg && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{successMsg}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Template Name</label>
              <input
                className="w-full rounded border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. sync-failure-alert"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Subject Line</label>
              <input
                className="w-full rounded border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="Alert: {{alertName}}"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">HTML Body</label>
            <textarea
              className="h-28 w-full rounded border px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.htmlBody}
              onChange={(e) => setForm((f) => ({ ...f, htmlBody: e.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Plain Text Body</label>
            <textarea
              className="h-20 w-full rounded border px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.textBody}
              onChange={(e) => setForm((f) => ({ ...f, textBody: e.target.value }))}
            />
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={() => void saveTemplate()} disabled={saving}>
              {saving ? 'Saving...' : 'Save Template'}
            </Button>
            <Button size="sm" variant="outline" onClick={updatePreview}>Preview</Button>
            {selected && (
              <Button size="sm" variant="destructive" onClick={() => void deleteTemplate(selected.id)}>
                Delete
              </Button>
            )}
          </div>

          {/* Preview pane */}
          {preview && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <div className="flex gap-2 text-xs font-medium">
                <button
                  onClick={() => setPreviewTab('html')}
                  className={previewTab === 'html' ? 'text-primary underline' : 'text-muted-foreground'}
                >HTML</button>
                <button
                  onClick={() => setPreviewTab('text')}
                  className={previewTab === 'text' ? 'text-primary underline' : 'text-muted-foreground'}
                >Plain Text</button>
              </div>
              <div className="text-xs text-muted-foreground">Subject: <span className="text-foreground font-medium">{preview.subject}</span></div>
              {previewTab === 'html' ? (
                <div
                  className="rounded border bg-white p-3 text-sm"
                  dangerouslySetInnerHTML={{ __html: preview.htmlBody }}
                />
              ) : (
                <pre className="whitespace-pre-wrap rounded border bg-white p-3 text-xs">{preview.textBody}</pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
