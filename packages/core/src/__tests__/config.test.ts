import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, _resetConfig } from '../config.js';

const VALID_ENV: Record<string, string> = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iris',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadConfig', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    _resetConfig();
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
    _resetConfig();
  });

  it('returns a valid config when required vars are set', () => {
    Object.assign(process.env, VALID_ENV);
    const config = loadConfig();
    expect(config.DATABASE_URL).toBe(VALID_ENV['DATABASE_URL']);
    expect(config.REDIS_URL).toBe(VALID_ENV['REDIS_URL']);
  });

  it('applies defaults for optional vars', () => {
    Object.assign(process.env, VALID_ENV);
    const config = loadConfig();
    expect(config.EMBEDDING_PROVIDER).toBe('openai');
    expect(config.MCP_SERVER_PORT).toBe(3100);
    expect(config.ENABLE_SEMANTIC_CACHE).toBe(true);
    expect(config.ENABLE_KNOWLEDGE_GRAPH).toBe(false);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.NODE_ENV).toBe('development');
  });

  it('throws a clear error when DATABASE_URL is missing', () => {
    Object.assign(process.env, { REDIS_URL: VALID_ENV['REDIS_URL'] });
    expect(() => loadConfig()).toThrow('DATABASE_URL');
  });

  it('throws a clear error when REDIS_URL is missing', () => {
    Object.assign(process.env, { DATABASE_URL: VALID_ENV['DATABASE_URL'] });
    expect(() => loadConfig()).toThrow('REDIS_URL');
  });

  it('throws when DATABASE_URL is not a valid URL', () => {
    Object.assign(process.env, { ...VALID_ENV, DATABASE_URL: 'not-a-url' });
    expect(() => loadConfig()).toThrow();
  });

  it('caches the parsed config on subsequent calls', () => {
    Object.assign(process.env, VALID_ENV);
    const first = loadConfig();
    const second = loadConfig();
    expect(first).toBe(second);
  });

  it('parses ENABLE_SEMANTIC_CACHE=false correctly', () => {
    Object.assign(process.env, { ...VALID_ENV, ENABLE_SEMANTIC_CACHE: 'false' });
    const config = loadConfig();
    expect(config.ENABLE_SEMANTIC_CACHE).toBe(false);
  });

  it('coerces MCP_SERVER_PORT string to number', () => {
    Object.assign(process.env, { ...VALID_ENV, MCP_SERVER_PORT: '4000' });
    const config = loadConfig();
    expect(config.MCP_SERVER_PORT).toBe(4000);
  });
});
