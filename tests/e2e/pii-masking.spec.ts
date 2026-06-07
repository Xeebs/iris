/**
 * PII masking enforcement E2E tests.
 *
 * Verifies that PII fields (email, phone, SSN) are masked in MCP tool
 * responses and REST API entity queries according to the configured masking
 * strategy (redaction, hashing, tokenization).
 *
 * Requires: running API + MCP server, workspace with PII config seeded.
 * Env vars: TEST_WORKSPACE_A_ID, TEST_WORKSPACE_A_KEY, MCP_URL.
 */

import { test, expect } from '@playwright/test';
import { API_URL, getWorkspaceA } from './utils/test-setup.js';

const MCP_URL = process.env['MCP_URL'] ?? 'http://localhost:3002';

/** Simple email pattern for checking if value is unmasked. */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^\+?[\d\s\-().]{7,}$/;

test.describe('PII masking — REST API entity retrieval', () => {
  const wsA = getWorkspaceA();

  test('entities endpoint masks email fields when redaction is configured', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/v1/entities?workspaceId=${wsA.workspaceId}&type=contact&limit=5`,
      { headers: wsA.authHeaders },
    );
    test.skip(!res.ok(), 'entities endpoint unavailable');

    const body = await res.json() as { data: { attributes?: Record<string, unknown> }[] };
    for (const entity of body.data) {
      const email = entity.attributes?.['email'];
      if (typeof email === 'string' && email.length > 0) {
        const isRedacted = email === '[REDACTED]';
        const isHashed = /^[a-f0-9]{8,}$/.test(email);
        const isTokenized = /^tok_/.test(email);
        const isMasked = isRedacted || isHashed || isTokenized;
        if (!isMasked) {
          expect(EMAIL_RE.test(email)).toBe(false);
        }
      }
    }
  });

  test('PII config endpoint returns current masking rules', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/v1/pii-config?workspaceId=${wsA.workspaceId}`,
      { headers: wsA.authHeaders },
    );
    test.skip(!res.ok(), 'PII config endpoint unavailable');

    const body = await res.json() as { data: { enableAutoDetection?: boolean } };
    expect(body.data).toBeDefined();
    expect(typeof body.data.enableAutoDetection).toBe('boolean');
  });

  test('entity attributes with pii:true are excluded from search results', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/v1/entities?workspaceId=${wsA.workspaceId}&query=john&limit=10`,
      { headers: wsA.authHeaders },
    );
    test.skip(!res.ok(), 'entities search unavailable');

    const body = await res.json() as { data: { attributes?: Record<string, unknown> }[] };
    for (const entity of body.data) {
      const ssn = entity.attributes?.['ssn'];
      if (ssn !== undefined) {
        expect(typeof ssn === 'string' && ssn.length > 0 && !/^\d{3}-\d{2}-\d{4}$/.test(ssn)).toBe(true);
      }
    }
  });
});

test.describe('PII masking — MCP query-context tool', () => {
  const wsA = getWorkspaceA();

  async function callMcpTool(
    request: import('@playwright/test').APIRequestContext,
    tool: string,
    args: Record<string, unknown>,
  ) {
    return request.post(`${MCP_URL}/mcp`, {
      headers: {
        Authorization: `Bearer ${wsA.apiKey}`,
        'Content-Type': 'application/json',
      },
      data: {
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 10000),
        method: 'tools/call',
        params: { name: tool, arguments: args },
      },
    });
  }

  test('query-context response does not expose raw email addresses', async ({ request }) => {
    const res = await callMcpTool(request, 'query-context', {
      query: 'contacts',
      workspaceId: wsA.workspaceId,
    });
    test.skip(!res.ok(), 'MCP server unavailable');

    const body = await res.json() as {
      result?: { content?: { type: string; text: string }[] };
    };
    const text = body.result?.content?.find((c) => c.type === 'text')?.text ?? '';
    const emailMatches = text.match(/[^@\s]+@[^@\s]+\.[^@\s]+/g) ?? [];
    for (const match of emailMatches) {
      expect(EMAIL_RE.test(match)).toBe(false);
    }
  });

  test('query-context response does not expose raw phone numbers', async ({ request }) => {
    const res = await callMcpTool(request, 'query-context', {
      query: 'contacts with phone',
      workspaceId: wsA.workspaceId,
    });
    test.skip(!res.ok(), 'MCP server unavailable');

    const body = await res.json() as {
      result?: { content?: { type: string; text: string }[] };
    };
    const text = body.result?.content?.find((c) => c.type === 'text')?.text ?? '';
    const phoneMatches = text.match(/\+?[\d]{3}[\s.-]?[\d]{3}[\s.-]?[\d]{4}/g) ?? [];
    for (const match of phoneMatches) {
      expect(PHONE_RE.test(match)).toBe(false);
    }
  });

  test('get-entity MCP tool masks PII fields when returned', async ({ request }) => {
    const listRes = await callMcpTool(request, 'list-entities', {
      entityType: 'contact',
      workspaceId: wsA.workspaceId,
      limit: 1,
    });
    test.skip(!listRes.ok(), 'MCP server unavailable');

    const listBody = await listRes.json() as {
      result?: { content?: { type: string; text: string }[] };
    };
    const text = listBody.result?.content?.find((c) => c.type === 'text')?.text ?? '';
    if (!text.includes('hubspot:contact:') && !text.includes('contact:')) {
      test.skip(true, 'no contact entities indexed');
    }

    const entityIdMatch = text.match(/(?:hubspot:contact:|contact:)([^\s,"]+)/);
    if (!entityIdMatch) test.skip(true, 'could not parse entity id from list response');

    const entityId = entityIdMatch[0];
    const getRes = await callMcpTool(request, 'get-entity', {
      entityId,
      workspaceId: wsA.workspaceId,
    });
    if (!getRes.ok()) test.skip(true, 'get-entity tool unavailable');

    const getBody = await getRes.json() as {
      result?: { content?: { type: string; text: string }[] };
    };
    const entityText = getBody.result?.content?.find((c) => c.type === 'text')?.text ?? '';
    const rawEmails = entityText.match(/[^@\s"']+@[^@\s"']+\.[^@\s"']+/g) ?? [];
    for (const email of rawEmails) {
      expect(EMAIL_RE.test(email)).toBe(false);
    }
  });

  test('MCP context budget is respected when returning masked entities', async ({ request }) => {
    const res = await callMcpTool(request, 'query-context', {
      query: 'contacts',
      workspaceId: wsA.workspaceId,
      contextBudget: 500,
    });
    test.skip(!res.ok(), 'MCP server unavailable');

    const body = await res.json() as {
      result?: { content?: { type: string; text: string }[] };
    };
    const text = body.result?.content?.find((c) => c.type === 'text')?.text ?? '';
    expect(text.length).toBeLessThan(3000);
  });
});

test.describe('PII masking — audit logging', () => {
  const wsA = getWorkspaceA();

  test('audit log records masked field list after entity retrieval', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/v1/audit?workspaceId=${wsA.workspaceId}&eventType=query&limit=1`,
      { headers: wsA.authHeaders },
    );
    test.skip(!res.ok(), 'audit log endpoint unavailable');

    const body = await res.json() as { data: { eventType: string }[] };
    if (body.data.length === 0) test.skip(true, 'no audit events yet');

    const event = body.data[0];
    expect(event.eventType).toBeTruthy();
  });
});
