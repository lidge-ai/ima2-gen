import { PRESETS } from "../data/presets.ts";
import { href } from "../router.ts";
import { useStudio } from "../studio/context.tsx";
import { Feed } from "../ui/Feed.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { VendorLogo } from "../ui/VendorLogo.tsx";
import "../styles/models.css";

const TOOLS: { path: string; icon: IconName; title: string; body: string; sample: string; video: boolean }[] = [
  {
    path: "video",
    icon: "video",
    title: "Video",
    body: "Text or a first frame to a clip, with camera presets.",
    sample: "samples/slow-push.mp4",
    video: true,
  },
  {
    path: "image",
    icon: "image",
    title: "Image",
    body: "Generate or edit stills with any image model.",
    sample: "samples/editorial.jpg",
    video: false,
  },
  {
    path: "remix",
    icon: "remix",
    title: "Remix",
    body: "Keep a clip's motion and recast, swap or restyle it.",
    sample: "samples/orbit.mp4",
    video: true,
  },
  {
    path: "director",
    icon: "director",
    title: "Director",
    body: "Cast, locations and multi-shot scenes from a script.",
    sample: "samples/rain-neon.mp4",
    video: true,
  },
];

function KeyBanner() {
  const keys = useStudio((s) => s.keys);
  const loaded = useStudio((s) => s.catalog !== null);
  if (!loaded || keys.some((k) => k.configured)) return null;
  return (
    <a className="banner" href={href("keys")}>
      <Icon name="key" />
      <span>
        <strong>Add your first API key.</strong> Models run on your own provider account at their published price.
      </span>
      <Icon name="arrowRight" />
    </a>
  );
}

/** Every maker in the catalog, each linking to its models and prices. */
function MakerStrip() {
  const vendors = useStudio((s) => [...new Set((s.catalog?.models ?? []).map((m) => m.vendor))].sort());
  if (vendors.length === 0) return null;
  return (
    <section className="home-section" aria-labelledby="home-makers">
      <SectionHead id="home-makers" title="Models from" link="models" linkText="Models and prices" />
      <div className="maker-strip">
        {vendors.map((v) => (
          <a key={v} href={href("models/" + v)}>
            <VendorLogo id={v} size={18} withName />
          </a>
        ))}
      </div>
    </section>
  );
}

function ToolRow() {
  return (
    <section className="tool-row" aria-label="Tools">
      {TOOLS.map((tool) => (
        <a key={tool.path} className="tool-card" href={href(tool.path)}>
          {tool.video ? (
            <video src={tool.sample} muted loop autoPlay playsInline aria-hidden />
          ) : (
            <img src={tool.sample} alt="" />
          )}
          <span className="tool-card-text">
            <span className="tool-card-title">
              <Icon name={tool.icon} size={16} /> {tool.title}
            </span>
            <span className="tool-card-body">{tool.body}</span>
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
  const presets = PRESETS.filter((p) => p.kind === "video").slice(0, 6);
  return (
    <section className="home-section" aria-labelledby="home-presets">
      <SectionHead id="home-presets" title="Camera presets" link="presets" linkText="All presets" />
      <div className="rail">
        {presets.map((p) => (
          <a key={p.id} className="rail-card" href={href("video", { preset: p.id })}>
            <video src={p.sample} muted loop autoPlay playsInline aria-hidden />
            <span>{p.label}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function RecentWork() {
  const empty = (
    <div className="empty">
      <p>Nothing yet. Results from every tool show up here.</p>
      <a className="btn" href={href("video")}>
        <Icon name="sparkle" size={15} /> Make a video
      </a>
    </div>
  );
  return (
    <section className="home-section" aria-labelledby="home-recent">
      <SectionHead id="home-recent" title="Your recent work" link="assets" linkText="Assets" />
      <Feed empty={empty} />
    </section>
  );
}

export function HomePage() {
  return (
    <div className="home">
      <KeyBanner />
      <ToolRow />
      <MakerStrip />
      <PresetRail />
      <RecentWork />
    </div>
  );
}
