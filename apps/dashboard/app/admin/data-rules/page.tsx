'use client';

import { useState, useEffect } from 'react';

type ConditionOperator = 'required' | 'not_empty' | 'matches' | 'min_length' | 'max_length' | 'one_of';
type RuleSeverity = 'error' | 'warning' | 'info';
type RuleAction = 'reject' | 'warn' | 'log';

type RuleCondition = {
  field: string;
  operator: ConditionOperator;
  value?: string | number | string[];
};

type BusinessRule = {
  id: string;
  name: string;
  entityType: string;
  conditions: RuleCondition[];
  action: RuleAction;
  severity: RuleSeverity;
  description: string;
  active: boolean;
};

type ViolationStat = {
  ruleId: string;
  ruleName: string;
  violationCount: number;
  severity: RuleSeverity;
};

const SEVERITY_STYLES: Record<RuleSeverity, string> = {
  error: 'text-red-400 bg-red-950 border-red-800',
  warning: 'text-yellow-400 bg-yellow-950 border-yellow-800',
  info: 'text-blue-400 bg-blue-950 border-blue-800',
};

const OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: 'required', label: 'Required' },
  { value: 'not_empty', label: 'Not empty' },
  { value: 'matches', label: 'Matches regex' },
  { value: 'min_length', label: 'Min length' },
  { value: 'max_length', label: 'Max length' },
  { value: 'one_of', label: 'One of' },
];

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

export default function DataRulesPage() {
  const [rules, setRules] = useState<BusinessRule[]>([]);
  const [violations, setViolations] = useState<ViolationStat[]>([]);
  const [tab, setTab] = useState<'rules' | 'violations'>('rules');
  const [showNewForm, setShowNewForm] = useState(false);
  const [newRule, setNewRule] = useState({ name: '', entityType: 'contact', action: 'warn' as RuleAction, severity: 'warning' as RuleSeverity, description: '', conditions: [{ field: '', operator: 'required' as ConditionOperator, value: undefined as string | undefined }] });

  useEffect(() => {
    void Promise.all([loadRules(), loadViolations()]);
  }, []);

  async function loadRules() {
    const res = await fetch('/api/v1/admin/rules', { headers: { 'x-workspace-id': WORKSPACE_ID } });
    if (res.ok) { const b = await res.json() as { data: BusinessRule[] }; setRules(b.data); }
  }

  async function loadViolations() {
    const res = await fetch('/api/v1/admin/rules/violations', { headers: { 'x-workspace-id': WORKSPACE_ID } });
    if (res.ok) { const b = await res.json() as { data: ViolationStat[] }; setViolations(b.data); }
  }

  async function createRule() {
    await fetch('/api/v1/admin/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
      body: JSON.stringify({
        name: newRule.name, entityType: newRule.entityType, conditions: newRule.conditions,
        action: newRule.action, severity: newRule.severity, description: newRule.description,
      }),
    });
    setShowNewForm(false);
    await loadRules();
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Data Validation Rules</h1>
          <p className="text-sm text-gray-400 mt-1">Define and enforce business rules across entity types.</p>
        </div>
        <button onClick={() => setShowNewForm(!showNewForm)} className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded transition-colors">
          {showNewForm ? 'Cancel' : '+ New Rule'}
        </button>
      </header>

      {showNewForm && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-5 mb-6">
          <h2 className="font-medium text-white mb-4">Define New Rule</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Rule Name</label>
              <input value={newRule.name} onChange={(e) => setNewRule((r) => ({ ...r, name: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500" placeholder="e.g. Contact email required" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Entity Type</label>
              <input value={newRule.entityType} onChange={(e) => setNewRule((r) => ({ ...r, entityType: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div className="mb-4">
            <label className="text-xs text-gray-400 block mb-2">Conditions</label>
            {newRule.conditions.map((cond, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input value={cond.field} onChange={(e) => { const c = [...newRule.conditions]; c[i] = { ...c[i]!, field: e.target.value }; setNewRule((r) => ({ ...r, conditions: c })); }} className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500" placeholder="field name" />
                <select value={cond.operator} onChange={(e) => { const c = [...newRule.conditions]; c[i] = { ...c[i]!, operator: e.target.value as ConditionOperator }; setNewRule((r) => ({ ...r, conditions: c })); }} className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 focus:outline-none">
                  {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input value={cond.value ?? ''} onChange={(e) => { const c = [...newRule.conditions]; c[i] = { ...c[i]!, value: e.target.value || undefined }; setNewRule((r) => ({ ...r, conditions: c })); }} className="w-28 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500" placeholder="value" />
              </div>
            ))}
          </div>
          <div className="flex gap-3 mb-4">
            <div className="flex-1">
              <label className="text-xs text-gray-400 block mb-1">Severity</label>
              <select value={newRule.severity} onChange={(e) => setNewRule((r) => ({ ...r, severity: e.target.value as RuleSeverity }))} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100">
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-400 block mb-1">Action</label>
              <select value={newRule.action} onChange={(e) => setNewRule((r) => ({ ...r, action: e.target.value as RuleAction }))} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100">
                <option value="reject">Reject</option>
                <option value="warn">Warn</option>
                <option value="log">Log</option>
              </select>
            </div>
          </div>
          <button onClick={createRule} className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded transition-colors">Create Rule</button>
        </div>
      )}

      <div className="flex border-b border-gray-700 mb-6">
        {(['rules', 'violations'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-5 py-3 text-sm font-medium capitalize transition-colors ${tab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}>{t}</button>
        ))}
      </div>

      {tab === 'rules' && (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className="bg-gray-900 border border-gray-700 rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="font-medium text-white">{rule.name}</span>
                  <span className="text-xs text-gray-500 ml-2">on {rule.entityType}</span>
                </div>
                <div className="flex gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${SEVERITY_STYLES[rule.severity]}`}>{rule.severity}</span>
                  <span className="text-xs text-gray-500 bg-gray-800 border border-gray-700 px-2 py-0.5 rounded-full">{rule.action}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {rule.conditions.map((c, i) => (
                  <span key={i} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded border border-gray-700">{c.field} · {c.operator}{c.value !== undefined ? ` = ${String(c.value)}` : ''}</span>
                ))}
              </div>
            </div>
          ))}
          {rules.length === 0 && <div className="text-center py-10 text-gray-500 text-sm">No rules defined yet.</div>}
        </div>
      )}

      {tab === 'violations' && (
        <div className="space-y-3">
          {violations.map((v) => (
            <div key={v.ruleId} className="bg-gray-900 border border-gray-700 rounded-lg p-4 flex items-center justify-between">
              <div>
                <span className="font-medium text-white">{v.ruleName}</span>
                <span className={`ml-2 text-xs px-2 py-0.5 rounded-full border ${SEVERITY_STYLES[v.severity]}`}>{v.severity}</span>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-white">{v.violationCount}</div>
                <div className="text-xs text-gray-500">violations (7d)</div>
              </div>
            </div>
          ))}
          {violations.length === 0 && <div className="text-center py-10 text-gray-500 text-sm">No violations in the last 7 days.</div>}
        </div>
      )}
    </div>
  );
}
