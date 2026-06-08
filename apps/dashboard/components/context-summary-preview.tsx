'use client';

type SummaryPreviewProps = {
  originalContent: string;
  summaryContent: string;
  originalTokens: number;
  summaryTokens: number;
  compressionRatio: number;
  format: string;
  intent: string;
  provider: string;
};

export default function ContextSummaryPreview({
  originalContent,
  summaryContent,
  originalTokens,
  summaryTokens,
  compressionRatio,
  format,
  intent,
  provider,
}: SummaryPreviewProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Original tokens', value: originalTokens.toLocaleString() },
          { label: 'Summary tokens', value: summaryTokens.toLocaleString() },
          { label: 'Compression', value: `${(compressionRatio * 100).toFixed(0)}%` },
          { label: 'Intent', value: intent },
        ].map(stat => (
          <div key={stat.label} className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <p className="text-lg font-semibold text-gray-900">{stat.value}</p>
            <p className="text-xs text-gray-500">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-600">Original</span>
            <span className="text-xs text-gray-400">{originalTokens.toLocaleString()} tokens</span>
          </div>
          <pre className="max-h-48 overflow-y-auto p-4 text-xs text-gray-600 whitespace-pre-wrap font-mono">
            {originalContent}
          </pre>
        </div>

        <div className="rounded-lg border border-blue-100 bg-blue-50">
          <div className="border-b border-blue-100 px-4 py-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-700">Summary ({format})</span>
            <span className="text-xs text-blue-400">{summaryTokens.toLocaleString()} tokens · {provider}</span>
          </div>
          <pre className="max-h-48 overflow-y-auto p-4 text-xs text-blue-800 whitespace-pre-wrap font-mono">
            {summaryContent}
          </pre>
        </div>
      </div>
    </div>
  );
}
