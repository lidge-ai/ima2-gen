/**
 * Folders for results. The server keeps folders of asset records (routes/assets.ts); a result is in a folder when
 * an asset record for its file is. History rows say which folder (folderId) and can be listed by folder.
 */
import type { Http } from "./http.ts";
import type { MediaKind } from "./types.ts";

export interface Folder {
  id: string;
  name: string;
}

interface WireFolder { id: string; name: string }
interface WireFiled { id: string; kind: string; folderId: string | null }
const FILE_KINDS: readonly string[] = ["image", "video", "audio"];
const enc = encodeURIComponent;

export function foldersApi(http: Http) {
  const filedIn = async (query: Record<string, string>) =>
    (await http.request<{ assets: WireFiled[] }>("GET", "/api/assets", { query: { ...query, limit: "500" } })).assets.filter((asset) => FILE_KINDS.includes(asset.kind));
  const move = (assetId: string, folderId: string | null) => http.request<unknown>("PATCH", "/api/assets/" + enc(assetId), { body: { folderId } });
  return {
    /** Every folder, by name. */
    list: async (): Promise<Folder[]> =>
      (await http.request<{ folders: WireFolder[] }>("GET", "/api/assets/folders")).folders.map((folder) => ({ id: folder.id, name: folder.name })),
    create: async (name: string): Promise<Folder> => {
      const { folder } = await http.request<{ folder: WireFolder }>("POST", "/api/assets/folders", { body: { name } });
      return { id: folder.id, name: folder.name };
    },
    rename: async (id: string, name: string): Promise<Folder> => {
      const { folder } = await http.request<{ folder: WireFolder }>("PATCH", "/api/assets/folders/" + enc(id), { body: { name } });
      return { id: folder.id, name: folder.name };
    },
    /** Deletes the folder. What was in it is taken out first and stays in Assets. */
    remove: async (id: string): Promise<void> => {
      for (const asset of await filedIn({ folderId: id })) await move(asset.id, null);
      await http.request<unknown>("DELETE", "/api/assets/folders/" + enc(id));
    },
    /** Puts a result in a folder, or takes it out of its folder with null. */
    file: async (result: { historyId: string; kind: MediaKind; prompt?: string }, folderId: string | null): Promise<void> => {
      const records = await filedIn({ filePath: result.historyId });
      for (const record of records) await move(record.id, folderId);
      if (records.length === 0 && folderId !== null) {
        await http.request<unknown>("POST", "/api/assets", {
          body: { kind: result.kind, filePath: result.historyId, folderId, ...(result.prompt ? { name: result.prompt.slice(0, 80) } : {}) },
        });
      }
    },
  };
}
