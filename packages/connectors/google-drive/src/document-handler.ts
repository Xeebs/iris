import { logger } from '@iris/core/logger';

const log = logger.child({ connector: 'google-drive', handler: 'document' });

export interface DriveFileContent {
  entityId: string;
  title: string;
  mimeType: string;
  buffer: Buffer;
}

export interface ExtractedDocument {
  entityId: string;
  title: string;
  contentPlaintext: string;
}

/** MIME types that Google Drive exports as text when downloading */
const EXPORTABLE_MIME_TYPES: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

/** Raw MIME types Iris can extract without conversion */
const EXTRACTABLE_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

/**
 * Returns true when a Google Drive file should have its content extracted for indexing.
 *
 * @param mimeType - MIME type of the Drive file
 */
export function shouldExtractContent(mimeType: string): boolean {
  return mimeType in EXPORTABLE_MIME_TYPES || EXTRACTABLE_MIME_TYPES.has(mimeType);
}

/**
 * Returns the export MIME type to request when downloading a Google Workspace file,
 * or null for native binary files (PDF, DOCX).
 *
 * @param mimeType - Google Drive MIME type
 */
export function getExportMimeType(mimeType: string): string | null {
  return EXPORTABLE_MIME_TYPES[mimeType] ?? null;
}

/**
 * Extract plain text from a Google Drive file's buffer based on its MIME type.
 * Delegates PDF/DOCX parsing to the DocumentIndexer and handles plain-text types inline.
 *
 * @param file           - File content and metadata
 * @param extractors     - Optional external extractor (injected to avoid hard dep on pdfjs)
 */
export async function extractDriveDocumentContent(
  file: DriveFileContent,
  extractors?: {
    extractPDF: (buf: Buffer) => Promise<string | null>;
    extractDocx: (buf: Buffer) => Promise<string | null>;
  },
): Promise<ExtractedDocument | null> {
  try {
    let text: string | null = null;

    if (file.mimeType === 'application/pdf' && extractors?.extractPDF) {
      text = await extractors.extractPDF(file.buffer);
    } else if (
      (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
       file.mimeType === 'application/msword') &&
      extractors?.extractDocx
    ) {
      text = await extractors.extractDocx(file.buffer);
    } else {
      // Plain text, markdown, CSV, exported Google Workspace docs
      text = file.buffer.toString('utf-8').replace(/\s+/g, ' ').trim();
    }

    if (!text) {
      log.warn('No text extracted from Drive file', { entityId: file.entityId, mimeType: file.mimeType });
      return null;
    }

    return {
      entityId: file.entityId,
      title: file.title,
      contentPlaintext: text,
    };
  } catch (e) {
    log.error('Drive document extraction failed', {
      entityId: file.entityId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
