import { WebContentsView } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const TITLEBAR_PAGE = join(desktopDir, "pages", "titlebar.html");

export const TITLEBAR_HEIGHT = 38;

/**
 * Splits a BrowserWindow into a fixed title strip (own page, draggable) and a
 * content view below it, so the served ima2 UI is never covered.
 */
export function mountTitlebarLayout(win, webPreferences) {
  const bar = new WebContentsView({ webPreferences });
  const content = new WebContentsView({ webPreferences });
  win.contentView.addChildView(bar);
  win.contentView.addChildView(content);

  const layout = () => {
    const { width, height } = win.getContentBounds();
    bar.setBounds({ x: 0, y: 0, width, height: TITLEBAR_HEIGHT });
    content.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width, height: Math.max(0, height - TITLEBAR_HEIGHT) });
  };
  layout();
  win.on("resize", layout);
  win.on("enter-full-screen", layout);
  win.on("leave-full-screen", layout);
  void bar.webContents.loadFile(TITLEBAR_PAGE);
  return { bar, content, layout };
}
