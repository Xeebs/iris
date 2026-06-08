'use client';

interface RelevanceFactorControlProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/**
 * Slider control for a single relevance scoring factor weight.
 */
export function RelevanceFactorControl({
  label,
  value,
  min = 0,
  max = 2,
  step = 0.05,
  disabled = false,
  onChange,
}: RelevanceFactorControlProps) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '1rem', background: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>{label}</label>
        <span style={{
          padding: '0.125rem 0.5rem',
          background: '#eff6ff',
          color: '#2563eb',
          borderRadius: '0.25rem',
          fontSize: '0.8125rem',
          fontWeight: 700,
          fontFamily: 'monospace',
        }}>
          {value.toFixed(2)}
        </span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#2563eb', cursor: disabled ? 'not-allowed' : 'pointer' }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem' }}>
        <span style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>{min}</span>
        <span style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>{max}</span>
      </div>
    </div>
  );
}
