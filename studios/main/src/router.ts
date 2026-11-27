import { useEffect, useState } from "react";

export type Route =
  | { page: "explore" }
  | { page: "create"; kind: "image" | "video"; model?: string; preset?: string; mode?: string }
  | { page: "remix"; workflow?: string }
  | { page: "director"; workflow?: string }
  | { page: "presets"; tab?: string }
  | { page: "assets"; kind?: string }
  | { page: "keys"; focus?: string }
  | { page: "models"; vendor?: string };

export function parseHash(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const params = new URLSearchParams(query);
  const get = (name: string) => params.get(name) ?? undefined;
  const [head, sub] = path.split("/");
  switch (head) {
    case "image":
    case "video":
      return clean({ page: "create", kind: head, model: get("model"), preset: get("preset"), mode: head === "video" ? get("mode") : undefined });
    case "remix":
      return clean({ page: "remix", workflow: sub || get("workflow") });
    case "director":
      return clean({ page: "director", workflow: sub || get("workflow") });
    case "presets":
      return clean({ page: "presets", tab: sub });
    case "assets":
      return clean({ page: "assets", kind: sub });
    case "models":
      return clean({ page: "models", vendor: sub || get("vendor") });
    case "keys":
      return clean({ page: "keys", focus: get("focus") });
    default:
      return { page: "explore" };
  }
}

function clean<T extends object>(route: T): T {
  return Object.fromEntries(Object.entries(route).filter(([, v]) => v !== undefined)) as T;
}

export function href(path: string, query?: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value) params.set(key, value);
  const qs = params.toString();
  return "#/" + path.replace(/^\//, "") + (qs ? "?" + qs : "");
}

export function navigate(path: string, query?: Record<string, string | undefined>): void {
  window.location.hash = href(path, query);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
