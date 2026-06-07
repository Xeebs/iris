import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TokenBreakdownChart, type BreakdownBucket } from '../token-breakdown-chart.js';

function makeBucket(overrides: Partial<BreakdownBucket> = {}): BreakdownBucket {
  return {
    bucket: '2026-06-07',
    groups: {
      hubspot: { tokensSpent: 1200, tokensSaved: 300, queryCount: 5 },
    },
    ...overrides,
  };
}

describe('TokenBreakdownChart', () => {
  it('shows empty state when no buckets', () => {
    render(<TokenBreakdownChart buckets={[]} groupNames={[]} />);
    expect(screen.getByText('No data for the selected time range.')).toBeInTheDocument();
  });

  it('renders legend entries for each group name', () => {
    render(
      <TokenBreakdownChart
        buckets={[makeBucket()]}
        groupNames={['hubspot', 'salesforce']}
      />,
    );
    expect(screen.getByText('hubspot')).toBeInTheDocument();
    expect(screen.getByText('salesforce')).toBeInTheDocument();
  });

  it('renders total token count for a bucket', () => {
    render(
      <TokenBreakdownChart
        buckets={[makeBucket()]}
        groupNames={['hubspot']}
      />,
    );
    expect(screen.getByText('1,200')).toBeInTheDocument();
  });

  it('sums multiple groups in a bucket', () => {
    const bucket = makeBucket({
      groups: {
        hubspot: { tokensSpent: 500, tokensSaved: 0, queryCount: 2 },
        salesforce: { tokensSpent: 300, tokensSaved: 0, queryCount: 1 },
      },
    });
    render(<TokenBreakdownChart buckets={[bucket]} groupNames={['hubspot', 'salesforce']} />);
    expect(screen.getByText('800')).toBeInTheDocument();
  });

  it('renders a row for each bucket', () => {
    const buckets = [
      makeBucket({ bucket: '2026-06-06', groups: { hubspot: { tokensSpent: 100, tokensSaved: 0, queryCount: 1 } } }),
      makeBucket({ bucket: '2026-06-07', groups: { hubspot: { tokensSpent: 200, tokensSaved: 0, queryCount: 2 } } }),
    ];
    render(<TokenBreakdownChart buckets={buckets} groupNames={['hubspot']} />);
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  it('renders bar segment title with token count and query count', () => {
    const bucket = makeBucket({
      groups: { hubspot: { tokensSpent: 1500, tokensSaved: 0, queryCount: 3 } },
    });
    const { container } = render(
      <TokenBreakdownChart buckets={[bucket]} groupNames={['hubspot']} />,
    );
    const segment = container.querySelector('[title*="1,500 tokens"]');
    expect(segment).not.toBeNull();
  });

  it('renders bar container with total tokens in title', () => {
    const bucket = makeBucket({
      groups: { hubspot: { tokensSpent: 900, tokensSaved: 0, queryCount: 4 } },
    });
    const { container } = render(
      <TokenBreakdownChart buckets={[bucket]} groupNames={['hubspot']} />,
    );
    const bar = container.querySelector('[title="900 tokens"]');
    expect(bar).not.toBeNull();
  });
});
