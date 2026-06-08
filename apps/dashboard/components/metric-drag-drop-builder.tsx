'use client';

import { useState } from 'react';

type Aggregation = 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX';
type Operator = '+' | '-' | '*' | '/';

type BuilderBlock =
  | { kind: 'agg'; fn: Aggregation; field: string }
  | { kind: 'op'; op: Operator }
  | { kind: 'number'; value: string };

const AGGREGATIONS: Aggregation[] = ['SUM', 'COUNT', 'AVG', 'MIN', 'MAX'];
const OPERATORS: Operator[] = ['+', '-', '*', '/'];
const COMMON_FIELDS = ['revenue', 'deal_amount', 'mrr', 'churn', 'arr', 'customers', 'contacts', 'leads', 'tickets', 'headcount'];

function blockToFormula(block: BuilderBlock): string {
  if (block.kind === 'agg') return `${block.fn}(${block.field})`;
  if (block.kind === 'op') return block.op;
  return block.value;
}

type Props = {
  onFormulaChange: (formula: string) => void;
};

/**
 * Visual drag-and-drop style metric formula builder using aggregation + operator blocks.
 * Generates a formula string compatible with MetricFormulaEngine.
 *
 * @param onFormulaChange - Called whenever the formula changes
 */
export function MetricDragDropBuilder({ onFormulaChange }: Props) {
  const [blocks, setBlocks] = useState<BuilderBlock[]>([]);
  const [selectedFn, setSelectedFn] = useState<Aggregation>('SUM');
  const [selectedField, setSelectedField] = useState('revenue');
  const [customField, setCustomField] = useState('');
  const [selectedOp, setSelectedOp] = useState<Operator>('+');
  const [numberVal, setNumberVal] = useState('');

  function addAgg() {
    const field = customField.trim() || selectedField;
    const newBlocks = [...blocks, { kind: 'agg' as const, fn: selectedFn, field }];
    setBlocks(newBlocks);
    onFormulaChange(newBlocks.map(blockToFormula).join(' '));
  }

  function addOp() {
    const newBlocks = [...blocks, { kind: 'op' as const, op: selectedOp }];
    setBlocks(newBlocks);
    onFormulaChange(newBlocks.map(blockToFormula).join(' '));
  }

  function addNumber() {
    if (!numberVal.trim()) return;
    const newBlocks = [...blocks, { kind: 'number' as const, value: numberVal.trim() }];
    setBlocks(newBlocks);
    onFormulaChange(newBlocks.map(blockToFormula).join(' '));
    setNumberVal('');
  }

  function removeBlock(idx: number) {
    const newBlocks = blocks.filter((_, i) => i !== idx);
    setBlocks(newBlocks);
    onFormulaChange(newBlocks.map(blockToFormula).join(' '));
  }

  const BLOCK_COLORS: Record<string, { bg: string; color: string }> = {
    agg: { bg: '#eef2ff', color: '#6366f1' },
    op: { bg: '#f3f4f6', color: '#374151' },
    number: { bg: '#fef9c3', color: '#92400e' },
  };

  return (
    <div>
      {/* Block preview */}
      <div style={{
        minHeight: 48, padding: '8px 12px', border: '1px dashed #d1d5db', borderRadius: 6,
        display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16, alignItems: 'center',
        background: '#f9fafb',
      }}>
        {blocks.length === 0 && (
          <span style={{ color: '#9ca3af', fontSize: 12 }}>Add blocks below to build your formula</span>
        )}
        {blocks.map((block, i) => {
          const style = BLOCK_COLORS[block.kind] ?? BLOCK_COLORS['op']!;
          return (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 8px', borderRadius: 6,
                background: style.bg, color: style.color,
                fontSize: 12, fontFamily: 'monospace', fontWeight: 600,
              }}
            >
              {blockToFormula(block)}
              <button
                onClick={() => removeBlock(i)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#9ca3af', fontSize: 10 }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* Block builders */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {/* Aggregation */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Aggregation</div>
          <select
            value={selectedFn}
            onChange={(e) => setSelectedFn(e.target.value as Aggregation)}
            style={{ width: '100%', marginBottom: 6, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12 }}
          >
            {AGGREGATIONS.map((fn) => <option key={fn}>{fn}</option>)}
          </select>
          <select
            value={customField || selectedField}
            onChange={(e) => { setSelectedField(e.target.value); setCustomField(''); }}
            style={{ width: '100%', marginBottom: 6, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12 }}
          >
            {COMMON_FIELDS.map((f) => <option key={f}>{f}</option>)}
          </select>
          <input
            placeholder="or custom field"
            value={customField}
            onChange={(e) => setCustomField(e.target.value)}
            style={{ width: '100%', marginBottom: 6, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, boxSizing: 'border-box' }}
          />
          <button
            onClick={addAgg}
            style={{ width: '100%', padding: '5px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
          >
            + Add
          </button>
        </div>

        {/* Operator */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Operator</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 }}>
            {OPERATORS.map((op) => (
              <button
                key={op}
                onClick={() => setSelectedOp(op)}
                style={{
                  padding: '6px', border: `2px solid ${selectedOp === op ? '#6366f1' : '#e5e7eb'}`,
                  borderRadius: 4, background: selectedOp === op ? '#eef2ff' : '#fff',
                  cursor: 'pointer', fontSize: 16, fontWeight: 700,
                  color: selectedOp === op ? '#6366f1' : '#374151',
                }}
              >
                {op}
              </button>
            ))}
          </div>
          <button
            onClick={addOp}
            style={{ width: '100%', padding: '5px', background: '#6b7280', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
          >
            + Add
          </button>
        </div>

        {/* Number */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Number</div>
          <input
            type="number"
            placeholder="e.g. 100"
            value={numberVal}
            onChange={(e) => setNumberVal(e.target.value)}
            style={{ width: '100%', marginBottom: 8, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, boxSizing: 'border-box' }}
          />
          <button
            onClick={addNumber}
            style={{ width: '100%', padding: '5px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
          >
            + Add
          </button>
        </div>
      </div>
    </div>
  );
}
