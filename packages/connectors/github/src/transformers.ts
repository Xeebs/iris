import type { SemanticEntity } from '@iris/connector-sdk';

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  topics?: string[];
  updated_at: string;
  owner: { login: string };
}

export interface GitHubUser {
  login: string;
}

export interface GitHubLabel {
  name: string;
}

export interface GitHubMilestone {
  title: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  user: GitHubUser;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  milestone: GitHubMilestone | null;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  /** Present only when the issue is actually a pull request */
  pull_request?: { merged_at: string | null };
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  user: GitHubUser;
  head: { ref: string };
  base: { ref: string };
  labels: GitHubLabel[];
  requested_reviewers: GitHubUser[];
  draft: boolean;
  merged_at: string | null;
  updated_at: string;
  closed_at: string | null;
}

export interface GitHubDiscussionCategory {
  name: string;
}

export interface GitHubDiscussion {
  id: number;
  number: number;
  title: string;
  user: GitHubUser;
  category: GitHubDiscussionCategory;
  comments: number;
  answer_html_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * @param repo - Raw GitHub repository object from the API
 * @returns SemanticEntity representation of the repository
 */
export function transformRepository(repo: GitHubRepository): SemanticEntity {
  return {
    id: `github:repository:${repo.full_name}`,
    type: 'repository',
    label: repo.full_name,
    attributes: {
      description: repo.description ?? null,
      language: repo.language ?? null,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      openIssuesCount: repo.open_issues_count,
      isPrivate: repo.private,
      defaultBranch: repo.default_branch,
      topics: repo.topics && repo.topics.length > 0 ? repo.topics.join(', ') : null,
    },
    relationships: [],
    lastModified: new Date(repo.updated_at),
    sourceId: `github:repository:${repo.full_name}`,
  };
}

/**
 * @param issue - Raw GitHub issue object from the API (must not have pull_request field)
 * @param owner - Repository owner login
 * @param repoName - Repository name
 * @returns SemanticEntity representation of the issue
 */
export function transformIssue(issue: GitHubIssue, owner: string, repoName: string): SemanticEntity {
  const repoId = `github:repository:${owner}/${repoName}`;
  const labelNames = issue.labels.map((l) => l.name);
  const assigneeLogins = issue.assignees.map((a) => a.login);

  return {
    id: `github:issue:${owner}/${repoName}#${issue.number}`,
    type: 'issue',
    label: `#${issue.number}: ${issue.title}`,
    attributes: {
      state: issue.state,
      number: issue.number,
      author: issue.user.login,
      labels: labelNames.length > 0 ? labelNames.join(', ') : null,
      milestone: issue.milestone?.title ?? null,
      commentCount: issue.comments,
    },
    relationships: [
      { type: 'belongs_to', targetId: repoId },
      ...assigneeLogins.map((login) => ({
        type: 'assigned_to',
        targetId: `github:user:${login}`,
      })),
    ],
    lastModified: new Date(issue.updated_at),
    sourceId: `github:issue:${owner}/${repoName}#${issue.number}`,
  };
}

/**
 * @param pr - Raw GitHub pull request object from the API
 * @param owner - Repository owner login
 * @param repoName - Repository name
 * @returns SemanticEntity representation of the pull request
 */
export function transformPullRequest(pr: GitHubPullRequest, owner: string, repoName: string): SemanticEntity {
  const repoId = `github:repository:${owner}/${repoName}`;
  const reviewerLogins = pr.requested_reviewers.map((r) => r.login);

  return {
    id: `github:pull_request:${owner}/${repoName}#${pr.number}`,
    type: 'pull_request',
    label: `PR #${pr.number}: ${pr.title}`,
    attributes: {
      state: pr.merged_at ? 'merged' : pr.state,
      number: pr.number,
      author: pr.user.login,
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
      draft: pr.draft,
      merged: pr.merged_at !== null,
      reviewers: reviewerLogins.length > 0 ? reviewerLogins.join(', ') : null,
    },
    relationships: [
      { type: 'belongs_to', targetId: repoId },
      ...reviewerLogins.map((login) => ({
        type: 'review_requested_from',
        targetId: `github:user:${login}`,
      })),
    ],
    lastModified: new Date(pr.updated_at),
    sourceId: `github:pull_request:${owner}/${repoName}#${pr.number}`,
  };
}

/**
 * @param discussion - Raw GitHub discussion object from the API
 * @param owner - Repository owner login
 * @param repoName - Repository name
 * @returns SemanticEntity representation of the discussion
 */
export function transformDiscussion(discussion: GitHubDiscussion, owner: string, repoName: string): SemanticEntity {
  const repoId = `github:repository:${owner}/${repoName}`;

  return {
    id: `github:discussion:${owner}/${repoName}#${discussion.number}`,
    type: 'discussion',
    label: `Discussion #${discussion.number}: ${discussion.title}`,
    attributes: {
      category: discussion.category.name,
      author: discussion.user.login,
      answered: discussion.answer_html_url !== null,
      commentCount: discussion.comments,
    },
    relationships: [{ type: 'belongs_to', targetId: repoId }],
    lastModified: new Date(discussion.updated_at),
    sourceId: `github:discussion:${owner}/${repoName}#${discussion.number}`,
  };
}
