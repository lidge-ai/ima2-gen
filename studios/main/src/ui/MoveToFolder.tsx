import { useState } from "react";
import type { HistoryItem } from "@ima2/studio-kit";
import { useT } from "../i18n.ts";
import { FM } from "../pages/assets/folderMessages.ts";
import { useStudioApi } from "../studio/context.tsx";
import { foldersChanged, useFolders } from "../studio/folders.ts";
import { SettingTile } from "./SettingTile.tsx";
import "../styles/assets.css";

const NEW = "\u0000new";

/** The folder a result is in, as a menu: another folder, none, or a new folder made on the spot. */
export function MoveToFolder({ item }: { item: HistoryItem }) {
  const t = useT(FM);
  const studio = useStudioApi();
  const { folders, error: loadError, reload } = useFolders();
  const [current, setCurrent] = useState<string>(item.folderId ?? "");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const file = async (folderId: string, label: string) => {
    setError("");
    setNote("");
    try {
      await studio.fileResult(item, folderId || null);
      setCurrent(folderId);
      setNote(folderId ? t("moved", { name: label }) : t("takenOut"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const createAndFile = async () => {
    if (!name.trim()) return;
    setError("");
    try {
      const folder = await studio.client.folders.create(name.trim());
      foldersChanged();
      setNaming(false);
      setName("");
      await file(folder.id, folder.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  // A server that does not report folders (an older one) gets no folder menu.
  if (item.folderId === undefined) return null;
  if (loadError) return <p role="alert" className="form-error move-folder">{t("failed", { error: loadError })} <button type="button" className="btn" onClick={reload}>{t("retry")}</button></p>;
  if (!folders) return null;
  // A result still marked with a folder that has since been deleted is in no folder.
  const shown = folders.some((folder) => folder.id === current) ? current : "";
  const options = [{ value: "", label: t("none") }, ...folders.map((folder) => ({ value: folder.id, label: folder.name })), { value: NEW, label: t("newFolder"), action: true }];
  return (
    <div className="move-folder">
      <SettingTile
        variant="chip" menuPlacement="bottom" caption={t("folder")} chipText={(label) => t("folder") + ": " + label}
        value={shown} options={options}
        onChange={(value) => { if (value === NEW) setNaming(true); else if (value !== shown) void file(value, folders.find((folder) => folder.id === value)?.name ?? ""); }}
      />
      {naming ? (
        <form className="move-folder-new" onSubmit={(e) => { e.preventDefault(); void createAndFile(); }}>
          <input autoFocus value={name} maxLength={80} placeholder={t("namePlaceholder")} aria-label={t("newName")} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn" disabled={!name.trim()}>{t("createAndFile")}</button>
          <button type="button" className="btn btn-ghost" onClick={() => setNaming(false)}>{t("cancel")}</button>
        </form>
      ) : null}
      {note ? <p role="status" className="form-hint">{note}</p> : null}
      {error ? <p role="alert" className="form-error">{t("actionFailed", { error })}</p> : null}
    </div>
  );
}
