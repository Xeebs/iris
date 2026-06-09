'use client';

import { useState } from 'react';

export type ConnectorVersion = {
  version: string;
  releaseNotes: string;
  publishedAt: string;
  deprecated: boolean;
};

export type ConnectorDetailProps = {
  id: string;
  name: string;
  description: string;
  category: string;
  author: string | null;
  iconUrl: string | null;
  documentationUrl: string | null;
  isOfficial: boolean;
  popularityScore: number;
  workspaceInstallsCount: number;
  versions: ConnectorVersion[];
  avgRating: number;
  reviewCount: number;
  isInstalled: boolean;
  onInstall: () => Promise<void>;
};

export function ConnectorDetailPanel({
  name,
  description,
  category,
  author,
  documentationUrl,
  isOfficial,
  popularityScore,
  workspaceInstallsCount,
  versions,
  avgRating,
  reviewCount,
  isInstalled,
  onInstall,
}: ConnectorDetailProps) {
  const [installing, setInstalling] = useState(false);
  const [tab, setTab] = useState<'overview' | 'versions'>('overview');

  async function handleInstall() {
    setInstalling(true);
    try {
      await onInstall();
    } finally {
      setInstalling(false);
    }
  }

  const latestVersion = versions[0];

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
      <div className="p-6 border-b border-gray-700">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-semibold text-white truncate">{name}</h2>
              {isOfficial && (
                <span className="text-xs bg-blue-900 text-blue-300 border border-blue-700 rounded-full px-2 py-0.5">Official</span>
              )}
              <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 rounded-full px-2 py-0.5">{category}</span>
            </div>
            {author && <p className="text-sm text-gray-400 mb-2">by {author}</p>}
            <p className="text-sm text-gray-300">{description}</p>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            <button
              onClick={handleInstall}
              disabled={isInstalled || installing}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${isInstalled ? 'bg-green-900 text-green-300 cursor-default' : 'bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50'}`}
            >
              {isInstalled ? 'Installed' : installing ? 'Installing...' : 'Install'}
            </button>
            {documentationUrl && (
              <a href={documentationUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">
                Documentation
              </a>
            )}
          </div>
        </div>

        <div className="flex gap-6 mt-4 pt-4 border-t border-gray-800">
          <div className="text-center">
            <div className="text-lg font-semibold text-white">{avgRating.toFixed(1)}</div>
            <div className="text-xs text-gray-500">{reviewCount} reviews</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-white">{workspaceInstallsCount.toLocaleString()}</div>
            <div className="text-xs text-gray-500">installs</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-white">{popularityScore.toFixed(0)}</div>
            <div className="text-xs text-gray-500">score</div>
          </div>
          {latestVersion && (
            <div className="text-center">
              <div className="text-lg font-semibold text-white">{latestVersion.version}</div>
              <div className="text-xs text-gray-500">latest</div>
            </div>
          )}
        </div>
      </div>

      <div className="flex border-b border-gray-700">
        {(['overview', 'versions'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-3 text-sm font-medium capitalize transition-colors ${tab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="p-6">
        {tab === 'overview' && (
          <div className="text-sm text-gray-300 space-y-3">
            <p>{description}</p>
          </div>
        )}

        {tab === 'versions' && (
          <div className="space-y-3">
            {versions.map((v) => (
              <div key={v.version} className={`border rounded p-3 ${v.deprecated ? 'border-gray-800 opacity-60' : 'border-gray-700'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-white">{v.version}</span>
                  <div className="flex items-center gap-2">
                    {v.deprecated && <span className="text-xs text-yellow-400">deprecated</span>}
                    <span className="text-xs text-gray-500">{new Date(v.publishedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                {v.releaseNotes && <p className="text-xs text-gray-400">{v.releaseNotes}</p>}
              </div>
            ))}
            {versions.length === 0 && <p className="text-sm text-gray-500">No versions available.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
