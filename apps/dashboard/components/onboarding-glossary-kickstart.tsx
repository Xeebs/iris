'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface GlossaryTerm {
  term: string;
  definition: string;
  selected: boolean;
}

interface OnboardingGlossaryKickstartProps {
  industry: string | null;
  onTermsSelected: (terms: Array<{ term: string; definition: string }>) => void;
}

export function OnboardingGlossaryKickstart({
  industry,
  onTermsSelected,
}: OnboardingGlossaryKickstartProps) {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadTemplates();
  }, [industry]);

  async function loadTemplates() {
    setLoading(true);
    try {
      const url = industry
        ? `/api/v1/onboarding/glossary-templates?industry=${encodeURIComponent(industry)}`
        : '/api/v1/onboarding/glossary-templates';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load templates');

      if (industry) {
        const data = (await res.json()) as { data: { terms: Array<{ term: string; definition: string }> } };
        setTerms(data.data.terms.map((t) => ({ ...t, selected: true })));
      } else {
        const data = (await res.json()) as {
          data: { templates: Record<string, Array<{ term: string; definition: string }>> };
        };
        const allTerms = Object.values(data.data.templates).flat();
        setTerms(allTerms.slice(0, 8).map((t) => ({ ...t, selected: true })));
      }
    } catch {
      setTerms([]);
    } finally {
      setLoading(false);
    }
  }

  function toggleTerm(index: number) {
    setTerms((prev) =>
      prev.map((t, i) => (i === index ? { ...t, selected: !t.selected } : t)),
    );
  }

  function handleConfirm() {
    onTermsSelected(terms.filter((t) => t.selected).map(({ term, definition }) => ({ term, definition })));
  }

  if (loading) {
    return <p className="text-muted-foreground py-4">Loading glossary templates...</p>;
  }

  if (terms.length === 0) {
    return (
      <div className="py-4 text-center">
        <p className="text-muted-foreground">No templates available for this industry.</p>
        <p className="text-sm text-muted-foreground mt-1">You can add glossary terms manually later.</p>
        <Button onClick={() => onTermsSelected([])} className="mt-4">
          Continue
        </Button>
      </div>
    );
  }

  const selectedCount = terms.filter((t) => t.selected).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pre-populate your glossary with {industry ? `${industry} industry` : 'common business'} terms.
        Deselect any you don&apos;t need.
      </p>

      <div className="space-y-2">
        {terms.map((term, i) => (
          <Card
            key={term.term}
            className={`cursor-pointer transition-colors ${term.selected ? '' : 'opacity-60'}`}
            onClick={() => toggleTerm(i)}
          >
            <CardHeader className="py-3 px-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={term.selected}
                  onCheckedChange={() => toggleTerm(i)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {term.term}
                    <Badge variant="outline" className="text-xs font-normal">auto-populated</Badge>
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">{term.definition}</CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Button onClick={handleConfirm} disabled={selectedCount === 0}>
        Add {selectedCount} term{selectedCount !== 1 ? 's' : ''} to glossary
      </Button>
    </div>
  );
}
