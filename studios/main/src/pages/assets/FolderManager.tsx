import { useEffect, useRef, useState } from "react";
import type { Folder } from "@ima2/studio-kit";
import { useT } from "../../i18n.ts";
import { useStudioApi } from "../../studio/context.tsx";
import { foldersChanged, useFolders } from "../../studio/folders.ts";
import { FM } from "./folderMessages.ts";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function FolderRow({ folder, onRemoved }: { folder: Folder; onRemoved: (id: string) => void }) {
  const t = useT(FM);
  const studio = useStudioApi();
  const [mode, setMode] = useState<"view" | "rename" | "remove">("view");
  const [name, setName] = useState(folder.name);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setError("");
    try {
      await action();
      setMode("view");
      foldersChanged();
      after?.();
    } catch (err) {
      setError(message(err));
    }
  };
  return (
    <li className="folder-row">
      {mode === "rename" ? (
        <form className="folder-row-line" aria-label={t("renaming", { name: folder.name })} onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(() => studio.client.folders.rename(folder.id, name.trim())); }}>
          <input autoFocus value={name} maxLength={80} aria-label={t("name")} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn" disabled={!name.trim()}>{t("save")}</button>
          <button type="button" className="btn btn-ghost" onClick={() => { setName(folder.name); setMode("view"); }}>{t("cancel")}</button>
        </form>
      ) : mode === "remove" ? (
        <div className="folder-row-line" role="group" aria-label={t("confirmRemove", { name: folder.name })}>
          <span className="folder-row-ask">{t("confirmRemove", { name: folder.name })}</span>
          <button type="button" className="btn btn-danger" onClick={() => void run(() => studio.client.folders.remove(folder.id), () => onRemoved(folder.id))}>{t("confirm")}</button>
          <button type="button" className="btn btn-ghost" onClick={() => setMode("view")}>{t("keep")}</button>
        </div>
      ) : (
        <div className="folder-row-line">
          <span className="folder-row-name">{folder.name}</span>
          <button type="button" className="btn btn-ghost" onClick={() => setMode("rename")}>{t("rename")}</button>
          <button type="button" className="btn btn-ghost" onClick={() => setMode("remove")}>{t("remove")}</button>
        </div>
      )}
      {error ? <p className="form-error" role="alert">{t("actionFailed", { error })}</p> : null}
    </li>
  );
}

function NewFolder() {
  const t = useT(FM);
  const studio = useStudioApi();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await studio.client.folders.create(name.trim());
      setName("");
      foldersChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="folder-new" onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <input value={name} maxLength={80} placeholder={t("namePlaceholder")} aria-label={t("newName")} onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="btn" disabled={!name.trim() || busy}>{t(busy ? "creating" : "create")}</button>
      {error ? <p className="form-error" role="alert">{t("actionFailed", { error })}</p> : null}
    </form>
  );
}

/** A button that opens the folder list: make a folder, rename one, delete one (its results stay). */
export function FolderManager({ onRemoved }: { onRemoved: (id: string) => void }) {
  const t = useT(FM);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const { folders, error, loading, reload } = useFolders(open);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <>
      <button type="button" className="chip" onClick={() => setOpen(true)}>{t("edit")}</button>
      <dialog ref={dialog} className="folder-manager" aria-label={t("title")} onClose={() => setOpen(false)}>
        {open ? (
          <div className="folder-manager-body">
            <header>
              <h2>{t("title")}</h2>
              <p>{t("lead")}</p>
            </header>
            <NewFolder />
            {error ? <div role="alert">{t("failed", { error })} <button className="btn" type="button" onClick={reload}>{t("retry")}</button></div> : null}
            {loading ? <p role="status">{t("loading")}</p> : null}
            {folders && folders.length === 0 ? <p className="form-hint">{t("empty")}</p> : null}
            <ul className="folder-list" aria-label={t("list")}>
              {(folders ?? []).map((folder) => <FolderRow key={folder.id} folder={folder} onRemoved={onRemoved} />)}
            </ul>
            <div className="folder-manager-foot"><button type="button" className="btn" onClick={() => setOpen(false)}>{t("close")}</button></div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
