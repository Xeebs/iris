import type { SemanticEntity } from '@iris/connector-sdk';

// ─── Raw Slack API types ──────────────────────────────────────────────────────

export interface SlackChannel {
  id: string;
  name: string;
  topic?: { value: string };
  purpose?: { value: string };
  num_members?: number;
  is_private?: boolean;
  updated?: number; // Unix timestamp seconds
}

export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  profile?: {
    title?: string;
    email?: string;
    display_name?: string;
    real_name?: string;
  };
  updated?: number;
  is_bot?: boolean;
  deleted?: boolean;
}

export interface SlackMessage {
  ts: string;
  user?: string;
  text: string;
  thread_ts?: string;
  reply_count?: number;
  type: string;
}

// ─── Transformers ─────────────────────────────────────────────────────────────

/**
 * @param channel - Raw Slack channel object
 * @returns SemanticEntity for the channel
 */
export function transformChannel(channel: SlackChannel): SemanticEntity {
  return {
    id: `slack:channel:${channel.id}`,
    type: 'channel',
    label: `#${channel.name}`,
    attributes: {
      topic: channel.topic?.value ?? null,
      purpose: channel.purpose?.value ?? null,
      memberCount: channel.num_members ?? null,
      isPrivate: channel.is_private ?? false,
    },
    relationships: [],
    lastModified: channel.updated ? new Date(channel.updated * 1000) : new Date(),
    sourceId: `slack:channel:${channel.id}`,
  };
}

/**
 * @param user - Raw Slack user object
 * @returns SemanticEntity for the user (skips bots and deleted users)
 */
export function transformUser(user: SlackUser): SemanticEntity {
  return {
    id: `slack:user:${user.id}`,
    type: 'user',
    label: user.real_name ?? user.profile?.display_name ?? user.name,
    attributes: {
      username: user.name,
      displayName: user.profile?.display_name ?? null,
      title: user.profile?.title ?? null,
      isBot: user.is_bot ?? false,
    },
    relationships: [],
    lastModified: user.updated ? new Date(user.updated * 1000) : new Date(),
    sourceId: `slack:user:${user.id}`,
  };
}

/**
 * @param message   - Raw Slack message object
 * @param channelId - Channel the message belongs to
 * @returns SemanticEntity for the message
 */
export function transformMessage(message: SlackMessage, channelId: string): SemanticEntity {
  const ts = parseFloat(message.ts);
  const msgDate = new Date(ts * 1000);

  const relationships: SemanticEntity['relationships'] = [
    { type: 'posted_in', targetId: `slack:channel:${channelId}` },
  ];
  if (message.user) {
    relationships.push({ type: 'authored_by', targetId: `slack:user:${message.user}` });
  }

  return {
    id: `slack:message:${channelId}:${message.ts}`,
    type: 'message',
    label: message.text.slice(0, 100),
    attributes: {
      text: message.text,
      channelId,
      userId: message.user ?? null,
      threadTs: message.thread_ts ?? null,
      replyCount: message.reply_count ?? null,
    },
    relationships,
    lastModified: msgDate,
    sourceId: `slack:message:${message.ts}`,
  };
}
