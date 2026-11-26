import { useEffect, useRef, useState, type RefObject } from "react";
import type { ShowcaseItem, WorkflowDef } from "@ima2/studio-kit";
import { messages, useLocale, useT } from "../i18n.ts";
import { href, navigate } from "../router.ts";
import { useStudio } from "../studio/context.tsx";
import { handOff } from "../studio/handoff.ts";
import { Icon } from "./Icon.tsx";
import { ModelName } from "./ModelName.tsx";
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
    needs: "Needs a key:",
    ready: "Your keys can run this",
    unavailable: "This workflow is not on this server",
    play: "Play {title}",
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
    needs: "필요한 키:",
    ready: "내 키로 바로 만들 수 있어요",
    unavailable: "이 서버에 없는 워크플로예요",
    play: "{title} 재생",
  },
);

/** Autoplay only where it costs nothing the person did not choose: on screen, motion allowed, data not saved. */
function autoplayAllowed(): boolean {
  if (typeof window === "undefined") return false;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  return !reduced && !saveData && window.innerWidth > 600;
}

function Clip({ src, poster, label, active }: { src: string; poster?: string; label: string; active: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (active) void video.play().catch(() => undefined);
    else video.pause();
  }, [active]);
  return (
    <video
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

function KeysLine({ item }: { item: ShowcaseItem }) {
  const t = useT(M);
  const keys = useStudio((s) => s.keys);
  const providers = useStudio((s) => s.catalog?.providers ?? []);
  const missing = item.keys.filter((vocab) => !keys.some((k) => k.keyVocabulary === vocab && k.configured));
  if (!item.keys.length) return null;
  if (!missing.length) return <p className="showcase-keys is-ready">{t("ready")}</p>;
  return (
    <p className="showcase-keys">
      {t("needs")}{" "}
      {missing.map((vocab, i) => (
        <span key={vocab}>
          {i ? ", " : ""}
          <a href={href("keys", { focus: vocab })}>{providers.find((p) => p.keyVocabulary === vocab)?.label ?? vocab}</a>
        </span>
      ))}
    </p>
  );
}

function Tile({ item }: { item: ShowcaseItem }) {
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
  const usd = item.estimate?.usd;
  return (
    <article className="showcase-tile" ref={ref} aria-label={title} {...bind}>
      <div className={"showcase-media" + (compare && !item.compare && item.source ? " is-compare" : "")}>
        {compare && item.compare ? (
          <Clip src={item.compare} label={t("compare")} active={active} />
        ) : compare && item.source ? (
          <>
            <figure>
              <Clip src={item.source} label={t("source")} active={active} />
              <figcaption>{t("source")}</figcaption>
            </figure>
            <figure>
              <Clip src={item.result} label={t("result")} active={active} />
              <figcaption>{t("result")}</figcaption>
            </figure>
          </>
        ) : (
          <Clip src={item.result} poster={item.poster} label={t("play", { title })} active={active} />
        )}
      </div>
      <div className="showcase-body">
        <h3>{title}</h3>
        <p className="showcase-models">
          {item.models.slice(0, 2).map((id) => (
            <ModelName key={id} id={id} />
          ))}
        </p>
        <p className="showcase-cost" title={item.estimate?.basis}>
          {usd === null || usd === undefined ? t("noPrice") : t("cost", { usd: "$" + usd.toFixed(2) })}
        </p>
        <KeysLine item={item} />
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
    </article>
  );
}

/** Showcase grid; renders nothing when the server has no showcase items. */
export function Showcase({ heading = true }: { heading?: boolean }) {
  const t = useT(M);
  const items = useStudio((s) => s.showcase);
  if (!items.length) return null;
  return (
    <section className="showcase" aria-labelledby={heading ? "showcase-title" : undefined} aria-label={heading ? undefined : t("title")}>
      {heading ? (
        <div className="section-head showcase-head">
          <div>
            <h2 id="showcase-title">{t("title")}</h2>
            <p className="muted">{t("lead")}</p>
          </div>
        </div>
      ) : null}
      <div className={"showcase-grid" + (items.length <= 2 ? " is-few" : "")}>
        {items.map((item) => (
          <Tile key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

