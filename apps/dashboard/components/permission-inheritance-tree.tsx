'use client';

type TemplateNode = {
  name: string;
  permissions: string[];
  inheritsFrom?: string;
};

type Props = {
  templates: { name: string; permissions: string[] }[];
  activeTemplate?: string;
  onSelect: (templateName: string) => void;
};

const INHERITANCE: Record<string, string | undefined> = {
  viewer: undefined,
  analyst: 'viewer',
  connector_admin: 'viewer',
  admin: 'analyst',
};

const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  viewer: 'Read-only access to entities, metrics, and queries.',
  analyst: 'Can create and run queries in addition to viewer access.',
  connector_admin: 'Full control over connector configurations.',
  admin: 'Full workspace administration.',
};

export function PermissionInheritanceTree({ templates, activeTemplate, onSelect }: Props) {
  const templateMap = Object.fromEntries(templates.map((t) => [t.name, t]));
  const roots = templates.filter((t) => !INHERITANCE[t.name]);

  function renderNode(name: string, depth: number): React.ReactNode {
    const tmpl = templateMap[name];
    if (!tmpl) return null;
    const children = templates.filter((t) => INHERITANCE[t.name] === name);

    return (
      <div key={name} style={{ marginLeft: depth * 20 }}>
        <button
          onClick={() => onSelect(name)}
          className={`w-full text-left rounded-lg border px-4 py-3 mb-2 transition-colors ${
            activeTemplate === name
              ? 'border-blue-500/50 bg-blue-500/10'
              : 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700/50'
          }`}
        >
          <div className="flex items-center gap-2">
            {depth > 0 && <span className="text-zinc-600 text-xs">↳</span>}
            <span className="font-medium text-white capitalize">{name}</span>
            <span className="ml-auto text-xs text-zinc-500">{tmpl.permissions.length} perms</span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">{TEMPLATE_DESCRIPTIONS[name]}</p>
        </button>
        {children.map((c) => renderNode(c.name, depth + 1))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Role Templates</h3>
      {roots.map((r) => renderNode(r.name, 0))}
    </div>
  );
}
