import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { McpToolBrowser } from '../mcp-tool-browser.js';

type ToolVersionDetail = {
  toolName: string;
  version: string;
  schemaJson: Record<string, unknown>;
  handlerRef: string;
  isActive: boolean;
  createdAt: string;
  sunsetDate: string | null;
  deprecationMessage: string | null;
};

const TOOL_A = { toolName: 'query-context', latestVersion: '2.0.0', totalVersions: 3 };
const TOOL_B = { toolName: 'list-entities', latestVersion: '1.0.0', totalVersions: 1 };

const VERSION: ToolVersionDetail = {
  toolName: 'query-context',
  version: '2.0.0',
  schemaJson: { type: 'object' },
  handlerRef: 'handlers/query-context@2',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  sunsetDate: null,
  deprecationMessage: null,
};

describe('McpToolBrowser', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the tool list heading', () => {
    render(<McpToolBrowser tools={[TOOL_A]} onSelectTool={vi.fn()} selectedTool={null} versions={[]} loadingVersions={false} />);
    expect(screen.getByText('MCP Tools')).toBeInTheDocument();
  });

  it('shows "No tools registered" when tools list is empty', () => {
    render(<McpToolBrowser tools={[]} onSelectTool={vi.fn()} selectedTool={null} versions={[]} loadingVersions={false} />);
    expect(screen.getByText(/no tools registered/i)).toBeInTheDocument();
  });

  it('renders all tool names in the list', () => {
    render(<McpToolBrowser tools={[TOOL_A, TOOL_B]} onSelectTool={vi.fn()} selectedTool={null} versions={[]} loadingVersions={false} />);
    expect(screen.getByText('query-context')).toBeInTheDocument();
    expect(screen.getByText('list-entities')).toBeInTheDocument();
  });

  it('calls onSelectTool with toolName when a tool button is clicked', () => {
    const onSelectTool = vi.fn();
    render(<McpToolBrowser tools={[TOOL_A]} onSelectTool={onSelectTool} selectedTool={null} versions={[]} loadingVersions={false} />);
    fireEvent.click(screen.getByText('query-context'));
    expect(onSelectTool).toHaveBeenCalledWith('query-context');
  });

  it('shows "Select a tool" placeholder when no tool is selected', () => {
    render(<McpToolBrowser tools={[TOOL_A]} onSelectTool={vi.fn()} selectedTool={null} versions={[]} loadingVersions={false} />);
    expect(screen.getByText(/select a tool/i)).toBeInTheDocument();
  });

  it('shows loading indicator when loadingVersions is true', () => {
    render(<McpToolBrowser tools={[TOOL_A]} onSelectTool={vi.fn()} selectedTool="query-context" versions={[]} loadingVersions={true} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders version detail card when tool is selected', () => {
    render(<McpToolBrowser tools={[TOOL_A]} onSelectTool={vi.fn()} selectedTool="query-context" versions={[VERSION]} loadingVersions={false} />);
    expect(screen.getByText('v2.0.0')).toBeInTheDocument();
  });

  it('shows handler ref in version detail', () => {
    render(<McpToolBrowser tools={[TOOL_A]} onSelectTool={vi.fn()} selectedTool="query-context" versions={[VERSION]} loadingVersions={false} />);
    expect(screen.getByText('handlers/query-context@2')).toBeInTheDocument();
  });

  it('shows deprecation badge when sunsetDate is set', () => {
    const deprecated: ToolVersionDetail = { ...VERSION, sunsetDate: '2027-01-01T00:00:00Z' };
    render(<McpToolBrowser tools={[TOOL_A]} onSelectTool={vi.fn()} selectedTool="query-context" versions={[deprecated]} loadingVersions={false} />);
    expect(screen.getByText(/deprecated/i)).toBeInTheDocument();
  });

  it('shows Inactive badge for inactive version', () => {
    const inactive: ToolVersionDetail = { ...VERSION, isActive: false };
    render(<McpToolBrowser tools={[TOOL_A]} onSelectTool={vi.fn()} selectedTool="query-context" versions={[inactive]} loadingVersions={false} />);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('renders SDK stub when fetch returns data', async () => {
    const stubData = { data: { toolName: 'query-context', version: '2.0.0', language: 'typescript', code: 'const x = 1;' } };
    vi.mocked(fetch).mockResolvedValue({ json: async () => stubData } as Response);

    render(<McpToolBrowser tools={[TOOL_A]} onSelectTool={vi.fn()} selectedTool="query-context" versions={[VERSION]} loadingVersions={false} />);
    fireEvent.click(screen.getByRole('button', { name: /generate ts stub/i }));

    await waitFor(() => expect(screen.getByText('const x = 1;')).toBeInTheDocument());
  });

  it('switches language stub button between TypeScript and Python', () => {
    render(<McpToolBrowser tools={[TOOL_A]} onSelectTool={vi.fn()} selectedTool="query-context" versions={[VERSION]} loadingVersions={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Python' }));
    expect(screen.getByRole('button', { name: /generate py stub/i })).toBeInTheDocument();
  });
});
