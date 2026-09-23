/** Same ASCII naming as the server's templateFileName (lib/nodeTemplateFile.ts). */
export function nodeTemplateFileName(name: string): string {
  const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[Đđ]/g, "d")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 80).replace(/-+$/g, "");
  return `${slug || "template"}.ima2-template.json`;
}
