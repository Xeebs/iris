import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityLinker, levenshteinDistance, scoreMatch } from '../entity-linker.js';
import type { EntityRecord } from '../entity-linker.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  return vi.fn((..._args: unknown[]) => Promise.resolve([]));
}

const hubspotContact: EntityRecord = {
  id: 'hubspot:contact:1',
  connector: 'hubspot',
  label: 'Alice Johnson',
  email: 'alice@acme.com',
  phone: '+1-555-123-4567',
};

const slackUser: EntityRecord = {
  id: 'slack:user:U1',
  connector: 'slack',
  label: 'alice.johnson',
  email: 'alice@acme.com',
};

const notionContact: EntityRecord = {
  id: 'notion:page:P1',
  connector: 'notion',
  label: 'Bob Smith',
  email: 'bob@example.com',
};

const linkRow = {
  id: 'link-uuid',
  workspace_id: 'ws-1',
  entity_id_a: 'hubspot:contact:1',
  connector_a: 'hubspot',
  entity_id_b: 'slack:user:U1',
  connector_b: 'slack',
  confidence: 0.85,
  match_signals: { nameSimilarity: 0.7, emailDomainMatch: true, compositeScore: 0.85 },
  status: 'proposed',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('EntityLinker', () => {
  let sql: ReturnType<typeof makeSql>;
  let linker: EntityLinker;

  beforeEach(() => {
    vi.clearAllMocks();
    sql = makeSql();
    linker = new EntityLinker(sql as unknown as Parameters<typeof EntityLinker>[0]);
  });

  describe('proposeLinks', () => {
    it('proposes links between entities from different connectors', () => {
      const proposals = linker.proposeLinks([hubspotContact, slackUser, notionContact]);
      expect(proposals.length).toBeGreaterThanOrEqual(1);
      const hubspotSlack = proposals.find(
        (p) => (p.entityIdA === hubspotContact.id && p.entityIdB === slackUser.id) ||
               (p.entityIdA === slackUser.id && p.entityIdB === hubspotContact.id),
      );
      expect(hubspotSlack).toBeDefined();
    });

    it('does not propose links between entities from the same connector', () => {
      const anotherHubspot: EntityRecord = { id: 'hubspot:contact:2', connector: 'hubspot', label: 'Alice Johnson' };
      const proposals = linker.proposeLinks([hubspotContact, anotherHubspot]);
      expect(proposals).toHaveLength(0);
    });

    it('filters by confidence threshold', () => {
      const low: EntityRecord = { id: 'sf:contact:1', connector: 'salesforce', label: 'Completely Different Name' };
      const proposals = linker.proposeLinks([hubspotContact, low], 0.70);
      expect(proposals.every((p) => p.confidence >= 0.70)).toBe(true);
    });

    it('includes email domain match signal', () => {
      const proposals = linker.proposeLinks([hubspotContact, slackUser], 0.0);
      const proposal = proposals[0];
      expect(proposal?.matchSignals.emailDomainMatch).toBe(true);
    });

    it('sorts proposals by confidence descending', () => {
      const highMatch: EntityRecord = { id: 'sf:1', connector: 'salesforce', label: 'Alice Johnson', email: 'alice@acme.com' };
      const proposals = linker.proposeLinks([hubspotContact, slackUser, highMatch], 0.0);
      for (let i = 1; i < proposals.length; i++) {
        expect(proposals[i - 1]!.confidence).toBeGreaterThanOrEqual(proposals[i]!.confidence);
      }
    });

    it('uses embedding similarity when vectors are provided', () => {
      const withEmbedding: EntityRecord = {
        ...hubspotContact,
        embeddingVector: [1, 0, 0, 0],
      };
      const slackWithEmbedding: EntityRecord = {
        ...slackUser,
        embeddingVector: [1, 0, 0, 0], // identical vector = similarity 1
      };
      const proposals = linker.proposeLinks([withEmbedding, slackWithEmbedding], 0.0);
      const p = proposals[0];
      expect(p?.matchSignals.embeddingSimilarity).toBe(1);
    });

    it('returns empty array for single entity', () => {
      expect(linker.proposeLinks([hubspotContact])).toHaveLength(0);
    });
  });

  describe('createLink', () => {
    it('inserts link and returns mapped record', async () => {
      sql.mockResolvedValueOnce([linkRow]);
      const proposal = {
        entityIdA: 'hubspot:contact:1',
        connectorA: 'hubspot',
        entityIdB: 'slack:user:U1',
        connectorB: 'slack',
        confidence: 0.85,
        matchSignals: { compositeScore: 0.85 },
      };
      const result = await linker.createLink('ws-1', proposal);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().id).toBe('link-uuid');
      expect(result._unsafeUnwrap().confidence).toBe(0.85);
    });

    it('returns err when insert returns no rows', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await linker.createLink('ws-1', {
        entityIdA: 'a', connectorA: 'x', entityIdB: 'b', connectorB: 'y',
        confidence: 0.8, matchSignals: { compositeScore: 0.8 },
      });
      expect(result.isErr()).toBe(true);
    });

    it('returns err on db failure', async () => {
      sql.mockRejectedValueOnce(new Error('constraint violation'));
      const result = await linker.createLink('ws-1', {
        entityIdA: 'a', connectorA: 'x', entityIdB: 'b', connectorB: 'y',
        confidence: 0.8, matchSignals: { compositeScore: 0.8 },
      });
      expect(result.isErr()).toBe(true);
    });
  });

  describe('updateLinkStatus', () => {
    it('updates status and returns updated record', async () => {
      sql.mockResolvedValueOnce([{ ...linkRow, status: 'confirmed' }]);
      const result = await linker.updateLinkStatus('ws-1', 'link-uuid', 'confirmed');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().status).toBe('confirmed');
    });

    it('returns err when link not found', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await linker.updateLinkStatus('ws-1', 'no-such-link', 'rejected');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not found');
    });
  });

  describe('listLinks', () => {
    it('returns all links for workspace', async () => {
      sql.mockResolvedValueOnce([linkRow]);
      const result = await linker.listLinks('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(1);
    });

    it('filters by status', async () => {
      sql.mockResolvedValueOnce([linkRow]);
      const result = await linker.listLinks('ws-1', 'proposed');
      expect(result.isOk()).toBe(true);
      expect(sql).toHaveBeenCalledOnce();
    });

    it('returns empty array when no links', async () => {
      sql.mockResolvedValueOnce([]);
      const result = await linker.listLinks('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });
  });

  describe('analyzeEntityConnections', () => {
    it('queries entities and creates proposals', async () => {
      // entities query
      sql.mockResolvedValueOnce([
        { id: 'hubspot:contact:1', connector: 'hubspot', label: 'Alice Johnson', attributes: { email: 'alice@acme.com' } },
        { id: 'slack:user:U1', connector: 'slack', label: 'alice.johnson', attributes: { email: 'alice@acme.com' } },
      ]);
      // createLink inserts
      sql.mockResolvedValue([linkRow]);

      const result = await linker.analyzeEntityConnections('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeGreaterThanOrEqual(0);
    });

    it('returns err on db failure', async () => {
      sql.mockRejectedValueOnce(new Error('table not found'));
      const result = await linker.analyzeEntityConnections('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });
});

// ─── levenshteinDistance ───────────────────────────────────────────────────────

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns string length when other is empty', () => {
    expect(levenshteinDistance('abc', '')).toBe(3);
    expect(levenshteinDistance('', 'xyz')).toBe(3);
  });

  it('computes edit distance for single substitution', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('computes edit distance for insertion+deletion', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});

// ─── scoreMatch ────────────────────────────────────────────────────────────────

describe('scoreMatch', () => {
  it('returns max name score for identical labels (no email or attrs)', () => {
    const result = scoreMatch({ label: 'Alice Johnson' }, { label: 'Alice Johnson' });
    // nameScore=1, emailDomainMatch=false, overlap=0 → 1*0.5+0+0=0.5
    expect(result.score).toBeCloseTo(0.5, 2);
    expect(result.nameScore).toBe(1);
  });

  it('detects email domain match and boosts score', () => {
    const result = scoreMatch(
      { label: 'Alice J', email: 'alice@acme.com' },
      { label: 'Alice Johnson', email: 'alice2@acme.com' },
    );
    expect(result.emailDomainMatch).toBe(true);
    expect(result.score).toBeGreaterThan(0.4);
  });

  it('returns 0 score for completely different entities', () => {
    const result = scoreMatch({ label: 'Alice' }, { label: 'zzzzzzzzz' });
    expect(result.nameScore).toBeLessThan(0.3);
  });

  it('computes attribute overlap correctly', () => {
    // Same label (nameScore=1) + 2/3 attr overlap → score = 0.5 + 0.667*0.3 ≈ 0.7
    const result = scoreMatch(
      { label: 'same', attributes: { company: 'Acme', role: 'eng' } },
      { label: 'same', attributes: { company: 'Acme', role: 'eng', extra: 'x' } },
    );
    expect(result.attributeOverlap).toBeGreaterThan(0.5);
    expect(result.score).toBeGreaterThan(0.65);
  });

  it('caps score at 1.0', () => {
    const result = scoreMatch(
      { label: 'Bob', email: 'bob@co.com', attributes: { x: 'y' } },
      { label: 'Bob', email: 'bob@co.com', attributes: { x: 'y' } },
    );
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

// ─── EntityLinker new methods ─────────────────────────────────────────────────

describe('EntityLinker.confirmMerge', () => {
  let sql: ReturnType<typeof makeSql>;
  let linker: EntityLinker;

  beforeEach(() => {
    sql = makeSql();
    linker = new EntityLinker(sql);
  });

  it('inserts merge record and returns merge_id', async () => {
    sql.mockResolvedValueOnce([{ merge_id: 'm-1' }]);
    sql.mockResolvedValueOnce([]);
    const result = await linker.confirmMerge('e-a', 'e-b', 'ws-1', 'user-1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('m-1');
  });

  it('returns err when insert fails', async () => {
    sql.mockRejectedValueOnce(new Error('DB down'));
    const result = await linker.confirmMerge('e-a', 'e-b', 'ws-1', 'user-1');
    expect(result.isErr()).toBe(true);
  });

  it('returns err when insert returns no rows', async () => {
    sql.mockResolvedValueOnce([]);
    const result = await linker.confirmMerge('e-a', 'e-b', 'ws-1', 'user-1');
    expect(result.isErr()).toBe(true);
  });
});

describe('EntityLinker.undoMerge', () => {
  let sql: ReturnType<typeof makeSql>;
  let linker: EntityLinker;

  beforeEach(() => {
    sql = makeSql();
    linker = new EntityLinker(sql);
  });

  it('returns ok on successful undo', async () => {
    sql.mockResolvedValueOnce([]);
    const result = await linker.undoMerge('m-1', 'ws-1');
    expect(result.isOk()).toBe(true);
  });

  it('returns err on DB failure', async () => {
    sql.mockRejectedValueOnce(new Error('DB down'));
    const result = await linker.undoMerge('m-1', 'ws-1');
    expect(result.isErr()).toBe(true);
  });
});

describe('EntityLinker.getMergeHistory', () => {
  let sql: ReturnType<typeof makeSql>;
  let linker: EntityLinker;

  beforeEach(() => {
    sql = makeSql();
    linker = new EntityLinker(sql);
  });

  it('returns empty list when no merges', async () => {
    sql.mockResolvedValueOnce([]);
    const result = await linker.getMergeHistory('ws-1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('maps merge rows to MergeRecord objects', async () => {
    const now = new Date().toISOString();
    sql.mockResolvedValueOnce([{
      merge_id: 'm-1', workspace_id: 'ws-1',
      source_entity_id: 'e-a', target_entity_id: 'e-b',
      merged_by: 'user-1', merged_at: now, undone_at: null,
    }]);
    const result = await linker.getMergeHistory('ws-1');
    expect(result.isOk()).toBe(true);
    const records = result._unsafeUnwrap();
    expect(records).toHaveLength(1);
    expect(records[0]?.mergeId).toBe('m-1');
    expect(records[0]?.undoneAt).toBeUndefined();
  });

  it('includes undoneAt when present', async () => {
    const now = new Date().toISOString();
    sql.mockResolvedValueOnce([{
      merge_id: 'm-2', workspace_id: 'ws-1',
      source_entity_id: 'e-a', target_entity_id: 'e-b',
      merged_by: 'user-1', merged_at: now, undone_at: now,
    }]);
    const result = await linker.getMergeHistory('ws-1');
    const record = result._unsafeUnwrap()[0];
    expect(record?.undoneAt).toBeInstanceOf(Date);
  });
});
