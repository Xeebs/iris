'use client';

import { cn } from '@/lib/utils';

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
  completedSteps: number[];
  stepLabels: string[];
}

export function OnboardingProgress({
  currentStep,
  totalSteps,
  completedSteps,
  stepLabels,
}: OnboardingProgressProps) {
  return (
    <div className="flex items-center justify-between w-full mb-8">
      {Array.from({ length: totalSteps }, (_, i) => {
        const stepNum = i + 1;
        const isCompleted = completedSteps.includes(stepNum - 1);
        const isCurrent = stepNum === currentStep;
        const isUpcoming = stepNum > currentStep;

        return (
          <div key={stepNum} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors',
                  isCompleted && 'bg-green-500 border-green-500 text-white',
                  isCurrent && 'bg-primary border-primary text-primary-foreground',
                  isUpcoming && 'bg-background border-muted-foreground/30 text-muted-foreground',
                )}
              >
                {isCompleted ? '✓' : stepNum}
              </div>
              <span
                className={cn(
                  'text-xs mt-1 text-center max-w-[60px]',
                  isCurrent ? 'text-primary font-medium' : 'text-muted-foreground',
                )}
              >
                {stepLabels[i]}
              </span>
            </div>
            {stepNum < totalSteps && (
              <div
                className={cn(
                  'flex-1 h-0.5 mx-1 mb-5',
                  isCompleted ? 'bg-green-500' : 'bg-muted',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
