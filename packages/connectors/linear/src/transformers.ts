import type { SemanticEntity } from '@iris/connector-sdk';

// ─── Raw Linear API types ─────────────────────────────────────────────────────

export type LinearState = {
  id: string;
  name: string;
  type: string;
};

export type LinearLabel = {
  id: string;
  name: string;
};

export type LinearTeam = {
  id: string;
  name: string;
  key: string;
};

export type LinearUser = {
  id: string;
  name: string;
};

export type LinearIssue = {
  id: string;
  title: string;
  identifier: string;
  priority: number;
  priorityLabel: string;
  state: LinearState;
  team: LinearTeam;
  assignee?: LinearUser | null;
  labels: { nodes: LinearLabel[] };
  updatedAt: string;
  createdAt: string;
  cycleId?: string | null;
};

export type LinearProject = {
  id: string;
  name: string;
  description?: string | null;
  state: string;
  updatedAt: string;
  teams: { nodes: LinearTeam[] };
};

export type LinearCycle = {
  id: string;
  name?: string | null;
  number: number;
  team: LinearTeam;
  startsAt: string;
  endsAt: string;
  updatedAt: string;
};

// ─── Transformers ─────────────────────────────────────────────────────────────

/**
 * Transform a Linear issue to a SemanticEntity.
 * Excludes raw user IDs (account IDs) to avoid PII; uses display name only.
 *
 * @param issue - Raw Linear issue object
 * @returns Compact SemanticEntity suitable for embedding and retrieval
 */
export function transformIssue(issue: LinearIssue): SemanticEntity {
  const relationships: SemanticEntity['relationships'] = [
    { type: 'belongs_to', targetId: `linear:team:${issue.team.id}` },
  ];

  if (issue.cycleId) {
    relationships.push({ type: 'in_cycle', targetId: `linear:cycle:${issue.cycleId}` });
  }

  const labels = issue.labels.nodes.map((l) => l.name).join(', ') || null;

  return {
    id: `linear:issue:${issue.id}`,
    type: 'issue',
    label: `${issue.identifier}: ${issue.title}`,
    attributes: {
      status: issue.state.name,
      stateType: issue.state.type,
      priority: issue.priorityLabel,
      assignee: issue.assignee?.name ?? null,
      labels,
      team: issue.team.key,
    },
    relationships,
    lastModified: new Date(issue.updatedAt),
    sourceId: `linear:issue:${issue.id}`,
  };
}

/**
 * Transform a Linear project to a SemanticEntity.
 *
 * @param project - Raw Linear project object
 * @returns Compact SemanticEntity
 */
export function transformProject(project: LinearProject): SemanticEntity {
  const relationships: SemanticEntity['relationships'] = project.teams.nodes.map((t) => ({
    type: 'belongs_to' as const,
    targetId: `linear:team:${t.id}`,
  }));

  return {
    id: `linear:project:${project.id}`,
    type: 'project',
    label: project.name,
    attributes: {
      description: project.description ?? null,
      state: project.state,
    },
    relationships,
    lastModified: new Date(project.updatedAt),
    sourceId: `linear:project:${project.id}`,
  };
}

/**
 * Transform a Linear cycle to a SemanticEntity.
 *
 * @param cycle - Raw Linear cycle object
 * @returns Compact SemanticEntity
 */
export function transformCycle(cycle: LinearCycle): SemanticEntity {
  return {
    id: `linear:cycle:${cycle.id}`,
    type: 'cycle',
    label: cycle.name ?? `Cycle ${cycle.number} (${cycle.team.name})`,
    attributes: {
      number: cycle.number,
      team: cycle.team.key,
      startsAt: cycle.startsAt,
      endsAt: cycle.endsAt,
    },
    relationships: [
      { type: 'belongs_to', targetId: `linear:team:${cycle.team.id}` },
    ],
    lastModified: new Date(cycle.updatedAt),
    sourceId: `linear:cycle:${cycle.id}`,
  };
}
