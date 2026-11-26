import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { ShowcaseItem, WorkflowDef } from "@ima2/studio-kit";
import { messages, useLocale, useT } from "../i18n.ts";
import { href, navigate } from "../router.ts";
import { useStudio } from "../studio/context.tsx";
import { handOff } from "../studio/handoff.ts";
import { Icon } from "./Icon.tsx";
import { ModelName } from "./ModelName.tsx";
import { SUBSCRIPTIONS, showcaseNeeds, type Need } from "./showcaseNeeds.ts";
import "../styles/showcase.css";

const M = messages(
  {
    title: "Made with ima2",
    lead: "Finished clips and the settings behind them. Open one to make your own.",
    make: "Make one like this",
    compare: "Compare with source",
    source: "Source",
    result: "Result",
    cost: "About {usd} when it was made",
    noPrice: "Price not published",
    included: "Included in the {plans} subscription",
    needs: "Needs:",
    ready: "Ready:",
    readyAll: "Ready to make:",
    signInName: "{name} sign-in",
    signIn: "Uses your {plans} sign-in",
    unavailable: "This workflow is not on this server",
    play: "Play {title}",
    details: "Details for {title}",
    all: "All {count} clips",
  },
  {
    title: "ima2로 만든 영상",
    lead: "완성된 영상과 그 설정이에요. 열어서 같은 방식으로 만들어 보세요.",
    make: "이 영상처럼 만들기",
    compare: "원본과 비교",
    source: "원본",
    result: "결과",
    cost: "만들 때 약 {usd}",
    noPrice: "가격 비공개",
    included: "{plans} 구독에 포함",
    needs: "필요:",
    ready: "준비됨:",
    readyAll: "바로 만들 수 있어요:",
    signInName: "{name} 로그인",
    signIn: "{plans} 로그인으로 실행",
    unavailable: "이 서버에 없는 워크플로예요",
    play: "{title} 재생",
    details: "{title} 자세히 보기",
    all: "영상 {count}개 모두 보기",
  },
);


function split(item: ShowcaseItem) {
  const plans = item.keys.filter((k) => k in SUBSCRIPTIONS).map((k) => SUBSCRIPTIONS[k]!);
  return { plans: plans.join(" · "), keys: item.keys.filter((k) => !(k in SUBSCRIPTIONS)) };
}

/** Autoplay only where it costs nothing the person did not choose: on screen, motion allowed, data not saved. */
function autoplayAllowed(): boolean {
  if (typeof window === "undefined") return false;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  return !reduced && !saveData && window.innerWidth > 600;
}

function Clip({ src, poster, label, active }: { src: string; poster?: string; label: string; active: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  // Runs on mount too: the compare toggle swaps which clips are mounted, and a fresh element with
  // preload="none" never loads or plays unless it is told to (it sat at 0:00, or blank, before).
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (!active) {
      video.pause();
      return;
    }
    if (video.readyState === 0) video.load();
    void video.play().catch(() => undefined);
  }, [active, src]);
  return (
    <video
      key={src}
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload={poster ? "none" : "metadata"}
      aria-label={label}
    />
  );
}

/** Plays while on screen (autoplay allowed) or while hovered or focused. */
function useActive(ref: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(false);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  const auto = autoplayAllowed();
  return { active: hover || (auto && visible), bind: { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false), onFocus: () => setHover(true), onBlur: () => setHover(false) } };
}

export function resolveWorkflow(item: ShowcaseItem, workflows: readonly WorkflowDef[]): WorkflowDef | undefined {
  const id = item.workflow ?? "";
  const ids = [id, id.replace(/-open$/, ""), id + "-open"];
  return ids.map((x) => workflows.find((w) => w.id === x)).find(Boolean);
}

function NeedsLine({ item, workflow }: { item: ShowcaseItem; workflow: WorkflowDef | undefined }) {
  const t = useT(M);
  const keys = useStudio((s) => s.keys);
  const catalog = useStudio((s) => s.catalog);
  const needs = showcaseNeeds(item, workflow, catalog, keys);
  const name = (n: Need) => (n.signIn ? t("signInName", { name: n.label }) : n.label);
  const ready = needs.filter((n) => n.ready === true);
  const missing = needs.filter((n) => n.ready === false);
  const unknown = needs.filter((n) => n.ready === null);
  if (!needs.length) return null;
  return (
    <>
      {ready.length ? (
        <p className="showcase-keys is-ready">
          {t(missing.length ? "ready" : "readyAll")} {ready.map(name).join(", ")}
        </p>
      ) : null}
      {missing.length ? (
        <p className="showcase-keys">
          {t("needs")}{" "}
          {missing.map((n, i) => (
            <span key={n.id}>
              {i ? ", " : ""}
              {n.href ? <a href={n.href}>{name(n)}</a> : name(n)}
            </span>
          ))}
        </p>
      ) : null}
      {unknown.length ? <p className="showcase-keys">{t("signIn", { plans: unknown.map((n) => n.label).join(" · ") })}</p> : null}
    </>
  );
}

function costText(item: ShowcaseItem, t: (key: keyof typeof M.en, vars?: Record<string, string>) => string): string {
  const usd = item.estimate?.usd;
  if (usd === null || usd === undefined) return t("noPrice");
  const plans = split(item).plans;
  if (usd === 0 && plans) return t("included", { plans });
  return t("cost", { usd: "$" + usd.toFixed(2) });
}

function Tile({ item, hide = "" }: { item: ShowcaseItem; hide?: string }) {
  const t = useT(M);
  const locale = useLocale();
  const workflows = useStudio((s) => s.workflows);
  const ref = useRef<HTMLElement>(null);
  const { active, bind } = useActive(ref);
  const [compare, setCompare] = useState(false);
  const title = (locale === "ko" && item.title.ko) || item.title.en;
  const workflow = resolveWorkflow(item, workflows);
  const make = () => {
    if (!workflow) return;
    if (item.source) handOff({ url: item.source, mimeType: "video/mp4", name: item.id + "-source.mp4", target: "remix", ...(item.values ? { values: item.values } : {}) });
    navigate("remix/" + workflow.id);
  };
  // Details sit over the clip: open while hovered or while focus is inside (keyboard), toggled by
  // tapping the clip on touch screens, and Escape hides them until the pointer or focus leaves.
  const [open, setOpen] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const detailsId = useId();
  const [pointer, setPointer] = useState(false);
  // Hover content must close without moving the pointer (WCAG 1.4.13): while the pointer is over
  // the tile, Escape anywhere hides the details until the pointer leaves.
  useEffect(() => {
    if (!pointer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setQuiet(true);
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pointer]);
  const cls = ["showcase-tile", hide, open ? "is-open" : "", quiet ? "is-quiet" : "", compare ? "is-comparing" : ""].filter(Boolean).join(" ");
  return (
    <article
      className={cls}
      ref={ref}
      aria-label={title}
      {...bind}
      onMouseEnter={() => {
        bind.onMouseEnter();
        setPointer(true);
      }}
      onMouseLeave={() => {
        bind.onMouseLeave();
        setPointer(false);
        setQuiet(false);
      }}
      onBlur={(event) => {
        bind.onBlur();
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setQuiet(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || pointer) return;
        setQuiet(true);
        setOpen(false);
      }}
    >
      <div className={"showcase-media" + (compare && !item.compare && item.source ? " is-compare" : "")}>
        {compare && item.compare ? (
          <Clip src={item.compare} label={t("compare")} active={active || compare} />
        ) : compare && item.source ? (
          <>
            <figure>
              <Clip src={item.source} label={t("source")} active={active || compare} />
              <figcaption>{t("source")}</figcaption>
            </figure>
            <figure>
              <Clip src={item.result} label={t("result")} active={active || compare} />
              <figcaption>{t("result")}</figcaption>
            </figure>
          </>
        ) : (
          <Clip src={item.result} poster={item.poster} label={t("play", { title })} active={active} />
        )}
        <button
          type="button"
          className="showcase-peek"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => {
            setQuiet(false);
            setOpen(!open);
          }}
        >
          <span className="visually-hidden">{t("details", { title })}</span>
        </button>
      </div>
      <div className="showcase-body">
        <h3>{title}</h3>
        <div className="showcase-details" id={detailsId}>
          <div className="showcase-details-inner">
            <p className="showcase-models">
              {item.models.slice(0, 2).map((id) => (
                <ModelName key={id} id={id} />
              ))}
            </p>
            <p className="showcase-cost" title={item.estimate?.basis}>
              {costText(item, t)}
            </p>
            <NeedsLine item={item} workflow={workflow} />
            <div className="showcase-actions">
              <button type="button" className="btn btn-primary" onClick={make} disabled={!workflow} title={workflow ? undefined : t("unavailable")}>
                <Icon name="remix" size={15} /> {t("make")}
              </button>
              {item.source || item.compare ? (
                <button type="button" className="btn" aria-pressed={compare} onClick={() => setCompare(!compare)}>
                  {t("compare")}
                </button>
              ) : null}
            </div>
            {!workflow ? <p className="showcase-keys">{t("unavailable")}</p> : null}
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Classes that hide a tile where it would start a partial row at that width: Home shows one row
 * (4 desktop, 3 tablet) or 2 x 2 on phones. Fewer clips than one row all show.
 */
function rowCuts(count: number, index: number): string {
  const keep = (cols: number, max: number) => (count < cols ? count : Math.floor(Math.min(count, max) / cols) * cols);
  return [index >= keep(4, 4) ? "hide-4" : "", index >= keep(3, 3) ? "hide-3" : "", index >= keep(2, 4) ? "hide-2" : ""].filter(Boolean).join(" ");
}

/** Showcase grid; renders nothing when the server has no showcase items. With a limit, links to the full gallery. */
export function Showcase({ heading = true, limit }: { heading?: boolean; limit?: number }) {
  const t = useT(M);
  const all = useStudio((s) => s.showcase);
  if (!all.length) return null;
  const items = limit ? all.slice(0, limit) : all;
  return (
    <section className="showcase" aria-labelledby={heading ? "showcase-title" : undefined} aria-label={heading ? undefined : t("title")}>
      {heading ? (
        <div className="section-head showcase-head">
          <div>
            <h2 id="showcase-title">{t("title")}</h2>
            <p className="muted">{t("lead")}</p>
          </div>
          {limit && all.length > 3 ? (
            <a className="muted-link" href={href("remix")}>
              {t("all", { count: all.length })} <Icon name="arrowRight" size={13} />
            </a>
          ) : null}
        </div>
      ) : null}
      <div className={"showcase-grid" + (limit ? " is-capped" : "")}>
        {items.map((item, index) => (
          <Tile key={item.id} item={item} hide={limit ? rowCuts(items.length, index) : ""} />
        ))}
      </div>
    </section>
  );
}

