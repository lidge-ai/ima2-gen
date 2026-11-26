import { messages, useT } from "../i18n.ts";
import { useReducedMotion } from "../ui/MediaView.tsx";
import { PRESETS } from "../data/presets.ts";
import { href } from "../router.ts";
import { useStudio } from "../studio/context.tsx";
import { Feed } from "../ui/Feed.tsx";
import { Showcase } from "../ui/Showcase.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { VendorLogo } from "../ui/VendorLogo.tsx";
import "../styles/models.css";

const M = messages(
  { video: "Video", image: "Image", remix: "Remix", director: "Director", videoBody: "Text or a first frame to a clip, with camera presets.", imageBody: "Generate or edit stills with any image model.", remixBody: "Keep a clip's motion and recast, swap or restyle it.", directorBody: "Cast, locations and multi-shot scenes from a script.", addKey: "Add your first API key.", keyBody: "Models run on your own provider account at their published price.", moreMakers: "+{n} more", makers: "Models from", prices: "Models and prices", tools: "Tools", cameras: "Camera presets", allPresets: "All presets", empty: "Nothing yet. Results from every tool show up here.", makeVideo: "Make a video", recent: "Your recent work", assets: "Assets" },
  { video: "영상", image: "이미지", remix: "리믹스", director: "디렉터", videoBody: "텍스트나 첫 프레임으로 카메라 프리셋을 적용한 영상을 만들어요.", imageBody: "이미지 모델로 사진을 만들거나 편집해요.", remixBody: "영상의 움직임을 유지하며 인물이나 스타일을 바꿔요.", directorBody: "대본으로 인물, 장소와 여러 장면을 만들어요.", addKey: "첫 API 키를 추가해 주세요.", keyBody: "모델은 내 제공업체 계정과 해당 업체의 가격으로 실행돼요.", moreMakers: "외 {n}곳", makers: "제작사", prices: "모델과 가격", tools: "도구", cameras: "카메라 프리셋", allPresets: "전체 프리셋", empty: "아직 결과가 없어요. 모든 도구의 결과가 여기에 나타나요.", makeVideo: "영상 만들기", recent: "최근 작업", assets: "에셋" },
);

const TOOLS: { path: string; icon: IconName; title: keyof typeof M.en; body: keyof typeof M.en; sample: string; video: boolean }[] = [
  {
    path: "video",
    icon: "video",
    title: "video",
    body: "videoBody",
    sample: "samples/slow-push.mp4",
    video: true,
  },
  {
    path: "image",
    icon: "image",
    title: "image",
    body: "imageBody",
    sample: "samples/editorial.jpg",
    video: false,
  },
  {
    path: "remix",
    icon: "remix",
    title: "remix",
    body: "remixBody",
    sample: "samples/orbit.mp4",
    video: true,
  },
  {
    path: "director",
    icon: "director",
    title: "director",
    body: "directorBody",
    sample: "samples/rain-neon.mp4",
    video: true,
  },
];

function KeyBanner() {
  const t = useT(M);
  const keys = useStudio((s) => s.keys);
  const loaded = useStudio((s) => s.catalog !== null);
  if (!loaded || keys.some((k) => k.configured)) return null;
  return (
    <a className="banner" href={href("keys")}>
      <Icon name="key" />
      <span>
        <strong>{t("addKey")}</strong> {t("keyBody")}
      </span>
      <Icon name="arrowRight" />
    </a>
  );
}

/** Every maker in the catalog, each linking to its models and prices. */
function MakerStrip() {
  const t = useT(M);
  const vendors = useStudio((s) => [...new Set((s.catalog?.models ?? []).map((m) => m.vendor))].sort());
  if (vendors.length === 0) return null;
  // A short row on Home; every maker and price is one link away on Models.
  const shown = vendors.slice(0, 10);
  return (
    <section className="home-section" aria-labelledby="home-makers">
      <SectionHead id="home-makers" title={t("makers")} link="models" linkText={t("prices")} />
      <div className="maker-strip">
        {shown.map((v) => (
          <a key={v} href={href("models/" + v)}>
            <VendorLogo id={v} size={18} withName />
          </a>
        ))}
        {vendors.length > shown.length ? (
          <a href={href("models")} className="maker-more">
            {t("moreMakers", { n: vendors.length - shown.length })}
          </a>
        ) : null}
      </div>
    </section>
  );
}

function ToolRow() {
  const t = useT(M);
  const reduce = useReducedMotion();
  return (
    <section className="tool-row" aria-label={t("tools")}>
      {TOOLS.map((tool) => (
        <a key={tool.path} className="tool-card" href={href(tool.path)}>
          {tool.video ? (
            <video key={String(reduce)} src={tool.sample} muted loop={!reduce} autoPlay={!reduce} playsInline aria-hidden />
          ) : (
            <img src={tool.sample} alt="" />
          )}
          <span className="tool-card-text">
            <span className="tool-card-title">
              <Icon name={tool.icon} size={16} /> {t(tool.title)}
            </span>
            <span className="tool-card-body">{t(tool.body)}</span>
          </span>
        </a>
      ))}
    </section>
  );
}

function SectionHead({ id, title, link, linkText }: { id: string; title: string; link: string; linkText: string }) {
  return (
    <div className="section-head">
      <h2 id={id}>{title}</h2>
      <a className="muted-link" href={href(link)}>
        {linkText} <Icon name="arrowRight" size={13} />
      </a>
    </div>
  );
}

function PresetRail() {
  const t = useT(M);
  const reduce = useReducedMotion();
  const presets = PRESETS.filter((p) => p.kind === "video").slice(0, 6);
  return (
    <section className="home-section" aria-labelledby="home-presets">
      <SectionHead id="home-presets" title={t("cameras")} link="presets" linkText={t("allPresets")} />
      <div className="rail">
        {presets.map((p) => (
          <a key={p.id} className="rail-card" href={href("video", { preset: p.id })}>
            <video key={String(reduce)} src={p.sample} muted loop={!reduce} autoPlay={!reduce} playsInline aria-hidden />
            <span>{p.label}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function RecentWork() {
  const t = useT(M);
  const empty = (
    <div className="empty">
      <p>{t("empty")}</p>
      <a className="btn" href={href("video")}>
        <Icon name="sparkle" size={15} /> {t("makeVideo")}
      </a>
    </div>
  );
  return (
    <section className="home-section" aria-labelledby="home-recent">
      <SectionHead id="home-recent" title={t("recent")} link="assets" linkText={t("assets")} />
      <Feed empty={empty} />
    </section>
  );
}

export function HomePage() {
  return (
    <div className="home">
      <KeyBanner />
      <Showcase limit={8} />
      <ToolRow />
      <RecentWork />
      <PresetRail />
      <MakerStrip />
    </div>
  );
}
