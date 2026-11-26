import { PRESETS } from "../data/presets.ts";
import { href } from "../router.ts";
import { useStudio } from "../studio/context.tsx";
import { Feed } from "../ui/Feed.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";

const TOOLS: { path: string; icon: IconName; title: string; body: string; sample: string; video: boolean }[] = [
  { path: "video", icon: "video", title: "Video", body: "Text or a first frame to a clip, with camera presets.", sample: "samples/slow-push.mp4", video: true },
  { path: "image", icon: "image", title: "Image", body: "Generate or edit stills with any image model.", sample: "samples/editorial.jpg", video: false },
  { path: "remix", icon: "remix", title: "Remix", body: "Keep a clip's motion and recast, swap or restyle it.", sample: "samples/orbit.mp4", video: true },
  { path: "director", icon: "director", title: "Director", body: "Cast, locations and multi-shot scenes from a script.", sample: "samples/rain-neon.mp4", video: true },
];

function KeyBanner() {
  const keys = useStudio((s) => s.keys);
  const loaded = useStudio((s) => s.catalog !== null);
  if (!loaded || keys.some((k) => k.configured)) return null;
  return (
    <a className="banner" href={href("keys")}>
      <Icon name="key" />
      <span><strong>Add your first API key.</strong> Models run on your own provider account at their published price.</span>
      <Icon name="arrowRight" />
    </a>
  );
}

export function HomePage() {
  const presets = PRESETS.filter((p) => p.kind === "video").slice(0, 6);
  return (
    <div className="home">
      <KeyBanner />
      <section className="tool-row" aria-label="Tools">
        {TOOLS.map((tool) => (
          <a key={tool.path} className="tool-card" href={href(tool.path)}>
            {tool.video
              ? <video src={tool.sample} muted loop autoPlay playsInline aria-hidden />
              : <img src={tool.sample} alt="" />}
            <span className="tool-card-text">
              <span className="tool-card-title"><Icon name={tool.icon} size={16} /> {tool.title}</span>
              <span className="tool-card-body">{tool.body}</span>
            </span>
          </a>
        ))}
      </section>
      <section className="home-section" aria-labelledby="home-presets">
        <div className="section-head">
          <h2 id="home-presets">Camera presets</h2>
          <a className="muted-link" href={href("presets")}>All presets <Icon name="arrowRight" size={13} /></a>
        </div>
        <div className="rail">
          {presets.map((p) => (
            <a key={p.id} className="rail-card" href={href("video", { preset: p.id })}>
              <video src={p.sample} muted loop autoPlay playsInline aria-hidden />
              <span>{p.label}</span>
            </a>
          ))}
        </div>
      </section>
      <section className="home-section" aria-labelledby="home-recent">
        <div className="section-head">
          <h2 id="home-recent">Your recent work</h2>
          <a className="muted-link" href={href("assets")}>Assets <Icon name="arrowRight" size={13} /></a>
        </div>
        <Feed empty={<div className="empty"><p>Nothing yet. Results from every tool show up here.</p><a className="btn" href={href("video")}><Icon name="sparkle" size={15} /> Make a video</a></div>} />
      </section>
    </div>
  );
}
