import type { Express, Request, Response } from "express";
import { dismissStarPrompt, getStarStatus, starRepository, type StarDeps } from "../lib/githubStar.js";
import { isLoopbackPeer } from "../lib/localAccessPolicy.js";

/**
 * Star routes act with the host user's GitHub login, so they answer only to
 * this computer. The global access guard already refuses cross-site browser
 * requests (lib/localAccessPolicy.ts checkBrowserRequest); the peer check here
 * keeps LAN clients from starring as the host. A same-host reverse proxy set up
 * through server.publicOrigins arrives from loopback and is the operator's own
 * exposure choice.
 */
export function createGithubStarHandlers(deps?: StarDeps) {
  const localOnly = (req: Request, res: Response): boolean => {
    if (isLoopbackPeer(req.socket?.remoteAddress)) return true;
    res.status(403).json({ ok: false, code: "LOCAL_ONLY" });
    return false;
  };

  return {
    async status(req: Request, res: Response) {
      if (!localOnly(req, res)) return;
      res.json(await getStarStatus(deps));
    },
    async star(req: Request, res: Response) {
      if (!localOnly(req, res)) return;
      const result = await starRepository(deps);
      if (result.ok) {
        res.json({ ok: true, state: "starred" });
        return;
      }
      if (result.code === "gh_unauthenticated") res.status(409).json({ ok: false, code: "GH_UNAUTHENTICATED" });
      else res.status(502).json({ ok: false, code: "GH_FAILED" });
    },
    async dismiss(req: Request, res: Response) {
      if (!localOnly(req, res)) return;
      // Unwritable state only means the prompt may ask again next launch.
      await dismissStarPrompt(deps).catch(() => {});
      res.json({ ok: true });
    },
  };
}

export function registerGithubRoutes(app: Express) {
  const handlers = createGithubStarHandlers();
  app.get("/api/github/star", handlers.status);
  app.post("/api/github/star", handlers.star);
  app.post("/api/github/star/dismiss", handlers.dismiss);
}
