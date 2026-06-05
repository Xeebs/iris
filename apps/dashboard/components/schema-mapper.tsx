'use client';

import type { SchemaField } from '@/lib/setup-wizard';

type SchemaMapperProps = {
  fields: SchemaField[];
  onToggle: (fieldName: string, included: boolean) => void;
};

/**
 * Displays discovered schema fields and lets the user include/exclude them.
 *
 * @param fields - Schema field list from buildSchemaFields()
 * @param onToggle - Called when a field's inclusion is toggled
 */
export function SchemaMapper({ fields, onToggle }: SchemaMapperProps): React.JSX.Element {
  if (fields.length === 0) {
    return (
      <p className="text-sm text-gray-500">No schema fields discovered yet.</p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              Include
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              Field
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              Type
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              Nullable
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {fields.map((field) => (
            <tr key={field.name} className="hover:bg-gray-50">
              <td className="px-4 py-2">
                <input
                  type="checkbox"
                  checked={field.included}
                  onChange={(e) => onToggle(field.name, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-gray-900"
                  aria-label={`Include ${field.name}`}
                />
              </td>
              <td className="px-4 py-2 font-mono text-xs">{field.name}</td>
              <td className="px-4 py-2 text-gray-600">{field.type}</td>
              <td className="px-4 py-2 text-gray-400">{field.nullable ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
