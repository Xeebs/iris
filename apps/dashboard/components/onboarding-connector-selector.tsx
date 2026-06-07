'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Connector {
  id: string;
  name: string;
  description: string;
  icon: string;
  recommended?: boolean;
  tags: string[];
}

const CONNECTORS: Connector[] = [
  { id: 'hubspot', name: 'HubSpot', description: 'CRM contacts, deals, and companies', icon: 'H', recommended: true, tags: ['sales', 'crm'] },
  { id: 'salesforce', name: 'Salesforce', description: 'Enterprise CRM data and pipeline', icon: 'S', recommended: true, tags: ['sales', 'crm'] },
  { id: 'notion', name: 'Notion', description: 'Wikis, docs, and project databases', icon: 'N', tags: ['docs', 'operations'] },
  { id: 'slack', name: 'Slack', description: 'Messages, channels, and user profiles', icon: 'Sl', tags: ['communication'] },
  { id: 'google-drive', name: 'Google Drive', description: 'Files, folders, and documents', icon: 'G', tags: ['docs', 'files'] },
  { id: 'jira', name: 'Jira', description: 'Issues, projects, and sprints', icon: 'J', tags: ['engineering', 'operations'] },
  { id: 'confluence', name: 'Confluence', description: 'Pages, spaces, and knowledge base', icon: 'C', tags: ['docs', 'engineering'] },
  { id: 'airtable', name: 'Airtable', description: 'Databases, tables, and records', icon: 'A', tags: ['operations', 'data'] },
  { id: 'linear', name: 'Linear', description: 'Issues, projects, and roadmaps', icon: 'L', tags: ['engineering'] },
  { id: 'quickbooks', name: 'QuickBooks', description: 'Invoices, expenses, and customers', icon: 'Q', tags: ['finance'] },
];

interface OnboardingConnectorSelectorProps {
  selectedConnectors: string[];
  onSelectionChange: (connectors: string[]) => void;
  maxSelections?: number;
}

export function OnboardingConnectorSelector({
  selectedConnectors,
  onSelectionChange,
  maxSelections = 3,
}: OnboardingConnectorSelectorProps) {
  const [filter, setFilter] = useState<string | null>(null);

  const allTags = Array.from(new Set(CONNECTORS.flatMap((c) => c.tags)));
  const filtered = filter ? CONNECTORS.filter((c) => c.tags.includes(filter)) : CONNECTORS;

  function toggleConnector(id: string) {
    if (selectedConnectors.includes(id)) {
      onSelectionChange(selectedConnectors.filter((c) => c !== id));
    } else if (selectedConnectors.length < maxSelections) {
      onSelectionChange([...selectedConnectors, id]);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={filter === null ? 'default' : 'outline'}
          onClick={() => setFilter(null)}
        >
          All
        </Button>
        {allTags.map((tag) => (
          <Button
            key={tag}
            size="sm"
            variant={filter === tag ? 'default' : 'outline'}
            onClick={() => setFilter(tag)}
          >
            {tag}
          </Button>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        Select up to {maxSelections} connectors to start with.{' '}
        <span className="font-medium">{selectedConnectors.length}/{maxSelections} selected.</span>
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map((connector) => {
          const isSelected = selectedConnectors.includes(connector.id);
          const isDisabled = !isSelected && selectedConnectors.length >= maxSelections;

          return (
            <Card
              key={connector.id}
              className={cn(
                'cursor-pointer transition-all border-2',
                isSelected && 'border-primary bg-primary/5',
                !isSelected && !isDisabled && 'hover:border-muted-foreground/50',
                isDisabled && 'opacity-50 cursor-not-allowed',
              )}
              onClick={() => !isDisabled && toggleConnector(connector.id)}
            >
              <CardHeader className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-muted rounded flex items-center justify-center text-sm font-bold">
                      {connector.icon}
                    </div>
                    <div>
                      <CardTitle className="text-sm">{connector.name}</CardTitle>
                      <CardDescription className="text-xs">{connector.description}</CardDescription>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {connector.recommended && (
                      <Badge variant="secondary" className="text-xs">Recommended</Badge>
                    )}
                    {isSelected && (
                      <Badge className="text-xs">Selected</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
