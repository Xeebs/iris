export { GitHubConnector, manifest } from './github-connector.js';
export type { GitHubConfig } from './github-connector.js';
export type {
  GitHubRepository,
  GitHubIssue,
  GitHubPullRequest,
  GitHubDiscussion,
} from './transformers.js';
export {
  transformRepository,
  transformIssue,
  transformPullRequest,
  transformDiscussion,
} from './transformers.js';
