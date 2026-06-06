import type { SemanticEntity } from '@iris/connector-sdk';

// ─── Raw Jira API types ───────────────────────────────────────────────────────

export type JiraProject = {
  id: string;
  key: string;
  name: string;
  description?: string;
  projectTypeKey: string;
  lead?: { accountId: string; displayName: string };
};

export type JiraIssueFields = {
  summary: string;
  description?: string | null;
  issuetype: { id: string; name: string };
  status: { name: string; statusCategory?: { key: string } };
  priority?: { name: string } | null;
  assignee?: { accountId: string; displayName: string } | null;
  reporter?: { accountId: string; displayName: string } | null;
  labels?: string[];
  project: { id: string; key: string; name: string };
  created: string;
  updated: string;
  resolutiondate?: string | null;
  /** Epic link custom field */
  customfield_10014?: string | null;
};

export type JiraIssue = {
  id: string;
  key: string;
  fields: JiraIssueFields;
};

// ─── Transformers ─────────────────────────────────────────────────────────────

/**
 * Transform a Jira project to a SemanticEntity.
 *
 * @param project - Raw Jira project object
 * @returns Compact SemanticEntity suitable for embedding and retrieval
 */
export function transformProject(project: JiraProject): SemanticEntity {
  return {
    id: `jira:project:${project.id}`,
    type: 'project',
    label: `${project.name} (${project.key})`,
    attributes: {
      key: project.key,
      projectType: project.projectTypeKey,
      description: project.description ?? null,
      lead: project.lead?.displayName ?? null,
    },
    relationships: [],
    lastModified: new Date(),
    sourceId: `jira:project:${project.id}`,
  };
}

/**
 * Transform a Jira issue to a SemanticEntity.
 * Filters PII fields (emails) and builds compact attribute set.
 *
 * @param issue - Raw Jira issue object
 * @returns Compact SemanticEntity
 */
export function transformIssue(issue: JiraIssue): SemanticEntity {
  const { fields } = issue;
  const relationships: SemanticEntity['relationships'] = [
    { type: 'belongs_to', targetId: `jira:project:${fields.project.id}` },
  ];

  if (fields.customfield_10014) {
    relationships.push({ type: 'epic', targetId: `jira:issue:${fields.customfield_10014}` });
  }

  return {
    id: `jira:issue:${issue.id}`,
    type: 'issue',
    label: `${issue.key}: ${fields.summary}`,
    attributes: {
      key: issue.key,
      issueType: fields.issuetype.name,
      status: fields.status.name,
      statusCategory: fields.status.statusCategory?.key ?? null,
      priority: fields.priority?.name ?? null,
      assignee: fields.assignee?.displayName ?? null,
      reporter: fields.reporter?.displayName ?? null,
      labels: fields.labels?.length ? fields.labels.join(', ') : null,
      project: fields.project.key,
      resolved: fields.resolutiondate ?? null,
    },
    relationships,
    lastModified: new Date(fields.updated),
    sourceId: `jira:issue:${issue.id}`,
  };
}
