import { msApiCall, msApiGet } from "./msApiFetch.js";

/**
 * Client-side file actions (teams-provisioning-plan.md B5a "Files in the
 * app"). `listFolder` reads live from `GET /api/files` (a server-side Graph
 * listing, fetched with the caller's own forwarded token — "the app
 * displays; SharePoint enforces," B7's own line). `uploadFile` gets an
 * upload-session URL from the server (which also creates the target folder
 * on demand, B4 §5/§6) and then PUTs the actual bytes DIRECTLY to that Graph
 * URL — the one Graph call in this whole B3-B7 build that the browser makes
 * itself, because upload-session URLs are pre-authorized by Graph and never
 * pass through our API (msApiFetch.ts's header explains why every other
 * call here goes through our server instead).
 */

export interface FileListItem {
  id: string;
  name: string;
  size: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  isFolder: boolean;
  mimeType?: string;
}

export interface FileListing {
  folderName: string;
  /** The folder's own SharePoint page — undefined only if Graph omitted it. */
  folderWebUrl?: string;
  items: FileListItem[];
}

export async function listFolder(accountId: string, kantataId: string, loginHintEmail?: string | undefined): Promise<FileListing> {
  return msApiGet<FileListing>(`/api/files?accountId=${encodeURIComponent(accountId)}&kantataId=${encodeURIComponent(kantataId)}`, { loginHintEmail });
}

// Graph's own recommended chunk size (a multiple of 320 KiB).
const CHUNK_SIZE = 327680 * 10; // ~3.2MB

export interface UploadProgress {
  bytesSent: number;
  totalBytes: number;
}

/** Uploads `file` into the folder `kantataId` resolves to (created first if
 * it doesn't exist yet), reporting progress via `onProgress`. Returns the
 * finished Graph driveItem — its `id` is the real reference B5a's own text
 * points at ("the upload returns the item id, so anything sent for client
 * approval records a real reference without anyone pasting a link"). */
export async function uploadFile(
  accountId: string,
  kantataId: string,
  file: File,
  opts: { loginHintEmail?: string | undefined; onProgress?: (p: UploadProgress) => void } = {},
): Promise<{ id: string; name: string; webUrl?: string }> {
  const session = await msApiCall<{ uploadUrl: string; expirationDateTime: string }>("/api/files-upload-session", {
    body: { accountId, kantataId, name: file.name, size: file.size },
    loginHintEmail: opts.loginHintEmail,
  });

  let offset = 0;
  let lastItem: { id: string; name: string; webUrl?: string } | null = null;
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);
    const res = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(end - offset),
        "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`,
      },
      body: chunk,
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`upload failed at byte ${offset} (${res.status})`);
    }
    opts.onProgress?.({ bytesSent: end, totalBytes: file.size });
    if (res.status !== 202) {
      // The final chunk's response IS the finished driveItem — Graph never
      // round-trips it back through our server.
      lastItem = (await res.json()) as { id: string; name: string; webUrl?: string };
    }
    offset = end;
  }

  if (!lastItem) throw new Error("upload session completed with no final item — nothing to reference");
  return lastItem;
}
