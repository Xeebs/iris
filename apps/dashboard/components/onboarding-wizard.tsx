'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { OnboardingProgress } from './onboarding-progress';
import { OnboardingConnectorSelector } from './onboarding-connector-selector';
import { OnboardingGlossaryKickstart } from './onboarding-glossary-kickstart';

const STEP_LABELS = [
  'Workspace Setup',
  'Select Connectors',
  'Connect Sources',
  'Schema Review',
  'Glossary',
  'First Sync',
  'Done',
];

interface WizardState {
  workspaceName: string;
  industry: string;
  companySize: string;
  useCase: string;
  selectedConnectors: string[];
  glossaryTerms: Array<{ term: string; definition: string }>;
  firstSyncTriggered: boolean;
}

interface OnboardingWizardProps {
  workspaceId: string;
  initialStep?: number;
  completedSteps?: number[];
  onComplete: () => void;
  onSkip: () => void;
}

export function OnboardingWizard({
  workspaceId,
  initialStep = 1,
  completedSteps = [],
  onComplete,
  onSkip,
}: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [done, setDone] = useState<number[]>(completedSteps);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<WizardState>({
    workspaceName: '',
    industry: '',
    companySize: '',
    useCase: '',
    selectedConnectors: [],
    glossaryTerms: [],
    firstSyncTriggered: false,
  });

  async function advanceStep(payload: Record<string, unknown> = {}) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/onboarding/step', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: currentStep, ...payload }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error: { message: string } };
        throw new Error(body.error?.message ?? 'Step update failed');
      }
      setDone((prev) => [...prev, currentStep - 1]);
      if (currentStep === 7) {
        onComplete();
      } else {
        setCurrentStep((s) => s + 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save progress');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    try {
      await fetch('/api/v1/onboarding/skip', { method: 'POST' });
    } finally {
      onSkip();
    }
  }

  async function handleFirstSync() {
    if (state.selectedConnectors.length === 0) {
      await advanceStep({ firstSyncTriggered: false });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      for (const connId of state.selectedConnectors) {
        const connRes = await fetch(`/api/v1/connectors?name=${encodeURIComponent(connId)}`);
        if (connRes.ok) {
          const connData = (await connRes.json()) as { data: Array<{ id: string }> };
          const inst = connData.data?.[0];
          if (inst) {
            await fetch(`/api/v1/connectors/${inst.id}/sync`, { method: 'POST' });
          }
        }
      }
      setState((s) => ({ ...s, firstSyncTriggered: true }));
      await advanceStep({ firstSyncTriggered: true });
    } catch {
      await advanceStep({ firstSyncTriggered: false });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <OnboardingProgress
        currentStep={currentStep}
        totalSteps={7}
        completedSteps={done}
        stepLabels={STEP_LABELS}
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {currentStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Set up your workspace</CardTitle>
            <CardDescription>Tell us about your organization so we can tailor Iris for you.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                placeholder="Acme Corp"
                value={state.workspaceName}
                onChange={(e) => setState((s) => ({ ...s, workspaceName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Select
                value={state.industry}
                onValueChange={(v) => setState((s) => ({ ...s, industry: v }))}
              >
                <SelectTrigger id="industry">
                  <SelectValue placeholder="Select an industry" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="finance">Finance</SelectItem>
                  <SelectItem value="sales">Sales</SelectItem>
                  <SelectItem value="operations">Operations</SelectItem>
                  <SelectItem value="hr">Human Resources</SelectItem>
                  <SelectItem value="engineering">Engineering</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-size">Company size</Label>
              <Select
                value={state.companySize}
                onValueChange={(v) => setState((s) => ({ ...s, companySize: v }))}
              >
                <SelectTrigger id="company-size">
                  <SelectValue placeholder="Select company size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1-10">1–10 employees</SelectItem>
                  <SelectItem value="11-50">11–50 employees</SelectItem>
                  <SelectItem value="51-200">51–200 employees</SelectItem>
                  <SelectItem value="201-1000">201–1,000 employees</SelectItem>
                  <SelectItem value="1000+">1,000+ employees</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="use-case">Primary use case</Label>
              <Input
                id="use-case"
                placeholder="e.g., Revenue analytics, Customer 360..."
                value={state.useCase}
                onChange={(e) => setState((s) => ({ ...s, useCase: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => void advanceStep({
                  industry: state.industry || undefined,
                  companySize: state.companySize || undefined,
                  useCase: state.useCase || undefined,
                })}
                disabled={submitting}
              >
                {submitting ? 'Saving...' : 'Continue'}
              </Button>
              <Button variant="ghost" onClick={() => void handleSkip()}>Skip setup</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Choose your data sources</CardTitle>
            <CardDescription>Pick the connectors you&apos;d like to index first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <OnboardingConnectorSelector
              selectedConnectors={state.selectedConnectors}
              onSelectionChange={(c) => setState((s) => ({ ...s, selectedConnectors: c }))}
            />
            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => void advanceStep({
                  selectedConnectors: state.selectedConnectors.length > 0 ? state.selectedConnectors : undefined,
                })}
                disabled={submitting}
              >
                {submitting ? 'Saving...' : 'Continue'}
              </Button>
              <Button variant="outline" onClick={() => setCurrentStep((s) => s - 1)}>Back</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Connect your sources</CardTitle>
            <CardDescription>
              Authenticate with each selected data source. You can do this now or configure them later.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {state.selectedConnectors.length === 0 ? (
              <p className="text-muted-foreground text-sm">No connectors selected. You can add them later from the Connectors page.</p>
            ) : (
              <ul className="space-y-2">
                {state.selectedConnectors.map((id) => (
                  <li key={id} className="flex items-center justify-between p-3 border rounded">
                    <span className="capitalize font-medium">{id}</span>
                    <Button size="sm" variant="outline" onClick={() => window.open(`/connectors/setup?type=${id}`, '_blank')}>
                      Configure
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2 pt-2">
              <Button onClick={() => void advanceStep()} disabled={submitting}>
                {submitting ? 'Saving...' : 'Continue'}
              </Button>
              <Button variant="outline" onClick={() => setCurrentStep((s) => s - 1)}>Back</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Schema confirmation</CardTitle>
            <CardDescription>Review the entity types and fields we&apos;ll index from your connectors.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Iris will automatically discover and index the following entity types from your connected sources.
              You can customize field mappings from the connector settings page after onboarding.
            </p>
            <div className="rounded border p-3 bg-muted/30 text-sm space-y-1">
              <p>Contacts, Companies, Deals → from CRM connectors</p>
              <p>Pages, Databases → from Notion / Confluence</p>
              <p>Issues, Projects → from Jira / Linear</p>
              <p>Messages, Channels → from Slack</p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => void advanceStep()} disabled={submitting}>
                {submitting ? 'Saving...' : 'Looks good, continue'}
              </Button>
              <Button variant="outline" onClick={() => setCurrentStep((s) => s - 1)}>Back</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 5 && (
        <Card>
          <CardHeader>
            <CardTitle>Glossary kickstart</CardTitle>
            <CardDescription>Pre-populate your glossary with standard business terms for your industry.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <OnboardingGlossaryKickstart
              industry={state.industry || null}
              onTermsSelected={(terms) => setState((s) => ({ ...s, glossaryTerms: terms }))}
            />
            <div className="flex gap-2 pt-2">
              <Button onClick={() => void advanceStep()} disabled={submitting}>
                {submitting ? 'Saving...' : 'Continue'}
              </Button>
              <Button variant="outline" onClick={() => setCurrentStep((s) => s - 1)}>Back</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 6 && (
        <Card>
          <CardHeader>
            <CardTitle>Trigger your first sync</CardTitle>
            <CardDescription>Start indexing your connected data sources now.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will kick off an initial sync for all connected sources. Depending on the size of your data,
              this may take a few minutes to complete.
            </p>
            {state.selectedConnectors.length > 0 ? (
              <ul className="text-sm space-y-1">
                {state.selectedConnectors.map((id) => (
                  <li key={id} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                    <span className="capitalize">{id}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No connectors configured yet.</p>
            )}
            <div className="flex gap-2 pt-2">
              <Button onClick={() => void handleFirstSync()} disabled={submitting}>
                {submitting ? 'Starting sync...' : 'Start sync'}
              </Button>
              <Button variant="outline" onClick={() => void advanceStep()} disabled={submitting}>
                Skip for now
              </Button>
              <Button variant="ghost" onClick={() => setCurrentStep((s) => s - 1)}>Back</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 7 && (
        <Card>
          <CardHeader>
            <CardTitle>You&apos;re all set!</CardTitle>
            <CardDescription>Iris is ready to serve contextual intelligence to your AI tools.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">Next steps:</p>
            <ul className="text-sm space-y-2 list-disc list-inside text-muted-foreground">
              <li>Connect your AI tool via MCP (see <strong>Settings → API Keys</strong>)</li>
              <li>Monitor your index from the <strong>Overview</strong> dashboard</li>
              <li>Expand your glossary in <strong>Settings → Glossary</strong></li>
            </ul>
            <Button onClick={() => void advanceStep()} disabled={submitting}>
              {submitting ? 'Finishing...' : 'Go to dashboard'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
