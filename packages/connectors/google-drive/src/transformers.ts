import type { SemanticEntity } from '@iris/connector-sdk';

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  size?: string;
  description?: string;
  webViewLink?: string;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_DOC_MIME_TYPES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
]);

/**
 * @param file - Raw Google Drive file metadata
 * @param content - Optional extracted text content (for text files)
 * @returns SemanticEntity representing the file or folder
 */
export function transformFile(file: GoogleDriveFile, content?: string): SemanticEntity {
  const isFolder = file.mimeType === FOLDER_MIME;
  const type = isFolder ? 'folder' : 'file';

  const attributes: Record<string, unknown> = {
    mimeType: file.mimeType,
    description: file.description ?? null,
    size: file.size ? Number(file.size) : null,
    webViewLink: file.webViewLink ?? null,
  };

  if (!isFolder && content) {
    attributes['content'] = content.slice(0, 1000);
  }

  if (!isFolder) {
    attributes['isGoogleDoc'] = GOOGLE_DOC_MIME_TYPES.has(file.mimeType);
  }

  const relationships = (file.parents ?? []).map((parentId) => ({
    type: 'child_of' as const,
    targetId: `google-drive:folder:${parentId}`,
  }));

  return {
    id: `google-drive:${type}:${file.id}`,
    type,
    label: file.name,
    attributes,
    relationships,
    lastModified: file.modifiedTime ? new Date(file.modifiedTime) : new Date(0),
    sourceId: `google-drive:${type}:${file.id}`,
  };
}
