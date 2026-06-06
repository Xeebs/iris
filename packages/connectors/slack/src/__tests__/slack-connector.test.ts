import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { SlackConnector } from '../slack-connector.js';
import { assertEntityShape } from '@iris/connector-sdk';

import channelsFixture from '../../tests/fixtures/channels.json' assert { type: 'json' };
import usersFixture from '../../tests/fixtures/users.json' assert { type: 'json' };
import messagesFixture from '../../tests/fixtures/messages.json' assert { type: 'json' };

const API = 'https://slack.com/api';
const AUTH_TEST_RESPONSE = { ok: true, team: 'Acme', user: 'testbot', team_id: 'T001', user_id: 'U000' };

const server = setupServer(
  http.get(`${API}/conversations.list`, () => HttpResponse.json(channelsFixture)),
  http.get(`${API}/users.list`, () => HttpResponse.json(usersFixture)),
  http.get(`${API}/conversations.history`, () => HttpResponse.json(messagesFixture)),
  http.get(`${API}/auth.test`, () => HttpResponse.json(AUTH_TEST_RESPONSE)),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeConnector(): SlackConnector {
  const connector = new SlackConnector();
  connector.setAccessToken('xoxb-test-token');
  return connector;
}

describe('SlackConnector', () => {
  describe('connect()', () => {
    it('succeeds when access token is set', async () => {
      const connector = makeConnector();
      const result = await connector.connect({});
      expect(result.isOk()).toBe(true);
    });

    it('fails when no access token is set', async () => {
      const connector = new SlackConnector();
      const result = await connector.connect({});
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('AUTH_MISSING');
    });
  });

  describe('sync() — channels', () => {
    it('yields channel entities', async () => {
      const connector = makeConnector();
      const entities = [];

      for await (const entity of connector.sync({ entityTypes: ['channel'] })) {
        assertEntityShape(entity);
        entities.push(entity);
      }

      expect(entities).toHaveLength(2);
      expect(entities[0]!.type).toBe('channel');
      expect(entities[0]!.id).toBe('slack:channel:C001');
      expect(entities[0]!.label).toBe('#general');
    });

    it('includes channel topic and purpose in attributes', async () => {
      const connector = makeConnector();

      for await (const entity of connector.sync({ entityTypes: ['channel'] })) {
        expect(entity.attributes['topic']).toBe('Company-wide announcements');
        expect(entity.attributes['purpose']).toBe('The general channel');
        break;
      }
    });
  });

  describe('sync() — users', () => {
    it('yields non-bot user entities', async () => {
      const connector = makeConnector();
      const entities = [];

      for await (const entity of connector.sync({ entityTypes: ['user'] })) {
        entities.push(entity);
      }

      expect(entities).toHaveLength(2); // bot filtered out
      expect(entities[0]!.type).toBe('user');
      expect(entities[0]!.id).toBe('slack:user:U001');
      expect(entities[0]!.label).toBe('Alice Smith');
    });

    it('skips bot users', async () => {
      const connector = makeConnector();
      const entities = [];

      for await (const entity of connector.sync({ entityTypes: ['user'] })) {
        entities.push(entity);
      }

      const ids = entities.map((e) => e.id);
      expect(ids).not.toContain('slack:user:UBOT1');
    });
  });

  describe('sync() — messages', () => {
    it('yields message entities', async () => {
      const connector = makeConnector();
      const entities = [];

      for await (const entity of connector.sync({ entityTypes: ['message'] })) {
        entities.push(entity);
      }

      // 2 channels × 2 messages = 4
      expect(entities).toHaveLength(4);
      expect(entities[0]!.type).toBe('message');
      expect(entities[0]!.id).toMatch(/^slack:message:C001:/);
    });

    it('includes posted_in relationship to channel', async () => {
      const connector = makeConnector();

      for await (const entity of connector.sync({ entityTypes: ['message'] })) {
        const rel = entity.relationships.find((r) => r.type === 'posted_in');
        expect(rel).toBeTruthy();
        expect(rel!.targetId).toMatch(/^slack:channel:/);
        break;
      }
    });

    it('includes authored_by relationship when user field is present', async () => {
      const connector = makeConnector();

      for await (const entity of connector.sync({ entityTypes: ['message'] })) {
        const rel = entity.relationships.find((r) => r.type === 'authored_by');
        expect(rel).toBeTruthy();
        expect(rel!.targetId).toMatch(/^slack:user:/);
        break;
      }
    });
  });

  describe('sync() — error handling', () => {
    it('throws on 429 rate limit from conversations.list', async () => {
      server.use(
        http.get(`${API}/conversations.list`, () => new HttpResponse(null, { status: 429 })),
      );

      const connector = makeConnector();
      const gen = connector.sync({ entityTypes: ['channel'] });

      await expect(gen.next()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });

    it('throws on Slack API ok=false with invalid_auth', async () => {
      server.use(
        http.get(`${API}/conversations.list`, () =>
          HttpResponse.json({ ok: false, error: 'invalid_auth' }),
        ),
      );

      const connector = makeConnector();
      const gen = connector.sync({ entityTypes: ['channel'] });

      await expect(gen.next()).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
    });
  });

  describe('getSchema()', () => {
    it('returns entity types for channel, user, and message', async () => {
      const connector = makeConnector();
      const schema = await connector.getSchema();
      const names = schema.entityTypes.map((e) => e.name);

      expect(names).toContain('channel');
      expect(names).toContain('user');
      expect(names).toContain('message');
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy when auth.test succeeds', async () => {
      const connector = makeConnector();
      const status = await connector.healthCheck();

      expect(status.healthy).toBe(true);
      expect(status.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns unhealthy on auth failure', async () => {
      server.use(
        http.get(`${API}/auth.test`, () =>
          HttpResponse.json({ ok: false, error: 'invalid_auth' }),
        ),
      );

      const connector = makeConnector();
      const status = await connector.healthCheck();

      expect(status.healthy).toBe(false);
    });
  });
});
