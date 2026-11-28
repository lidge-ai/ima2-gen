/**
 * Elements: a character, product, style or scene kept as 1 to 6 reference images, to use again in any form
 * that takes references. The server stores them as assets of kind "element" (routes/assets.ts); an element's
 * images are files in its generated storage, so a form sends them by path instead of uploading them again.
 */
import type { Http } from "./http.ts";
import type { MediaInputRole, UploadedInput } from "./types.ts";

export const ELEMENT_KINDS = ["character", "product", "style", "scene"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];
export const MAX_ELEMENT_IMAGES = 6;

export interface ElementImage {
  /** Path inside the server's generated storage. */
  path: string;
  /** Same-origin URL the UI can show. */
  url: string;
}

export interface Element {
  id: string;
  name: string;
  kind: ElementKind;
  images: readonly ElementImage[];
  notes?: string;
  updatedAt: string;
}

interface WireAsset {
  id: string;
  kind: string;
  name: string;
  notes: string | null;
  metadata: { elementKind?: string; refs?: unknown; notes?: string } | null;
  updatedAt: number;
}

/** inputId prefix of a file already in the server's generated storage; sent as { filename } instead of an upload ref. */
export const SAVED_FILE = "generated:";

const MIME: Readonly<Record<string, string>> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const fileUrl = (path: string) => "/generated/" + path.split("/").map(encodeURIComponent).join("/");

/** A saved file as a form input: every form sends it like an upload, and the client turns it into its path. */
export function savedFileInput(path: string): UploadedInput {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return { inputId: SAVED_FILE + path, url: fileUrl(path), mimeType: MIME[ext] ?? "image/png", bytes: 0 };
}

/** The wire form of one input: an upload ref, or the path of a saved file. */
export function wireRef(inputId: string): { ref: string } | { filename: string } {
  return inputId.startsWith(SAVED_FILE) ? { filename: inputId.slice(SAVED_FILE.length) } : { ref: inputId };
}

/** An element's images as inputs in one role, at most max of them. */
export function elementInputs(element: Element, role: MediaInputRole, max: number): { role: MediaInputRole; upload: UploadedInput; name: string }[] {
  return element.images.slice(0, Math.max(0, max)).map((image, i) => ({ role, upload: savedFileInput(image.path), name: element.images.length > 1 ? element.name + " " + (i + 1) : element.name }));
}

export function toElement(asset: WireAsset): Element | null {
  const kind = ELEMENT_KINDS.find((value) => value === asset.metadata?.elementKind);
  const refs = Array.isArray(asset.metadata?.refs) ? asset.metadata.refs.filter((ref): ref is string => typeof ref === "string" && ref.length > 0) : [];
  if (asset.kind !== "element" || !kind || refs.length === 0) return null;
  const notes = asset.notes ?? asset.metadata?.notes;
  return {
    id: asset.id, name: asset.name, kind,
    images: refs.map((path) => ({ path, url: fileUrl(path) })),
    ...(notes ? { notes } : {}),
    updatedAt: new Date(asset.updatedAt).toISOString(),
  };
}

const enc = encodeURIComponent;
const metadata = (name: string, kind: ElementKind, paths: readonly string[]) => ({ elementKind: kind, name, refs: paths });

export function elementsApi(http: Http) {
  const one = (wire: { asset: WireAsset }): Element => {
    const element = toElement(wire.asset);
    if (!element) throw new Error("The server returned an element this client cannot read");
    return element;
  };
  return {
    /** Every element, newest first, or those of one kind. */
    list: async (kind?: ElementKind): Promise<Element[]> => {
      const wire = await http.request<{ assets: WireAsset[] }>("GET", "/api/assets", { query: { kind: "element", limit: "200", ...(kind ? { elementKind: kind } : {}) } });
      return wire.assets.flatMap((asset) => toElement(asset) ?? []);
    },
    /** From an image the person uploaded: the server keeps its own copy. */
    fromUpload: async (input: { inputId: string; name: string; kind: ElementKind }): Promise<Element> =>
      one(await http.request("POST", "/api/assets/promote-element", { body: { inputRef: input.inputId, name: input.name, elementKind: input.kind } })),
    /** From 1 to 6 saved results, by their history ids (the file paths). */
    fromResults: async (input: { paths: readonly string[]; name: string; kind: ElementKind }): Promise<Element> =>
      one(await http.request("POST", "/api/assets", { body: { kind: "element", name: input.name, metadata: metadata(input.name, input.kind, input.paths) } })),
    /** Renames, re-kinds or changes the images of an element; what is not given stays. */
    update: async (element: Element, patch: { name?: string; kind?: ElementKind; paths?: readonly string[] }): Promise<Element> => {
      const name = patch.name ?? element.name;
      return one(await http.request("PATCH", "/api/assets/" + enc(element.id), {
        body: { name, metadata: metadata(name, patch.kind ?? element.kind, patch.paths ?? element.images.map((image) => image.path)) },
      }));
    },
    remove: (id: string) => http.request<unknown>("DELETE", "/api/assets/" + enc(id)).then(() => undefined),
  };
}
