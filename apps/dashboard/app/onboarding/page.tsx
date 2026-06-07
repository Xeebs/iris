'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OnboardingWizard } from '@/components/onboarding-wizard';

interface OnboardingState {
  started: boolean;
  status: string | null;
  currentStep: number | null;
  completedSteps: number[];
  totalSteps: number;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void initOnboarding();
  }, []);

  async function initOnboarding() {
    try {
      const res = await fetch('/api/v1/onboarding/status');
      if (!res.ok) throw new Error('Failed to fetch status');
      const data = (await res.json()) as { data: OnboardingState };

      if (data.data.status === 'completed' || data.data.status === 'skipped') {
        router.replace('/');
        return;
      }

      if (!data.data.started) {
        const startRes = await fetch('/api/v1/onboarding/start', { method: 'POST' });
        if (!startRes.ok) throw new Error('Failed to start onboarding');
        const startData = (await startRes.json()) as { data: OnboardingState };
        setState(startData.data);
      } else {
        setState(data.data);
      }
    } catch {
      setState({
        started: true,
        status: 'in_progress',
        currentStep: 1,
        completedSteps: [],
        totalSteps: 7,
      });
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Loading onboarding...</p>
      </div>
    );
  }

  if (!state) return null;

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold">Welcome to Iris</h1>
        <p className="text-muted-foreground mt-2">
          Let&apos;s get your workspace set up in under 10 minutes.
        </p>
      </div>

      <OnboardingWizard
        workspaceId="current"
        initialStep={state.currentStep ?? 1}
        completedSteps={state.completedSteps}
        onComplete={() => router.push('/')}
        onSkip={() => router.push('/')}
      />
    </div>
  );
}
