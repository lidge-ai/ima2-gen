import { useStudio } from "./studio/context.tsx";
import { useRoute, type Route } from "./router.ts";
import { Icon, Logo, type IconName } from "./ui/Icon.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { ImagePage } from "./pages/ImagePage.tsx";
import { VideoPage } from "./pages/VideoPage.tsx";
import { PresetsPage } from "./pages/PresetsPage.tsx";
import { RemixPage } from "./pages/remix/RemixPage.tsx";
import { DirectorPage } from "./pages/director/DirectorPage.tsx";
import { AssetsPage } from "./pages/assets/AssetsPage.tsx";
import { KeysPage } from "./pages/keys/KeysPage.tsx";

const NAV: { path: string; label: string; icon: IconName; match: (r: Route) => boolean }[] = [
  { path: "", label: "Home", icon: "explore", match: (r) => r.page === "explore" },
  { path: "image", label: "Image", icon: "image", match: (r) => r.page === "create" && r.kind === "image" },
  { path: "video", label: "Video", icon: "video", match: (r) => r.page === "create" && r.kind === "video" },
  { path: "remix", label: "Remix", icon: "remix", match: (r) => r.page === "remix" },
  { path: "director", label: "Director", icon: "director", match: (r) => r.page === "director" },
  { path: "presets", label: "Presets", icon: "presets", match: (r) => r.page === "presets" },
  { path: "assets", label: "Assets", icon: "assets", match: (r) => r.page === "assets" },
];

function TopBar({ route }: { route: Route }) {
  const stream = useStudio((s) => s.stream);
  const keyed = useStudio((s) => s.keys.filter((k) => k.configured).length);
  return (
    <header className="topbar">
      <a className="brand" href="#/" aria-label="ima2 studio home"><Logo /></a>
      <nav className="nav" aria-label="Main">
        {NAV.map((item) => (
          <a key={item.label} href={"#/" + item.path} aria-current={item.match(route) ? "page" : undefined}>{item.label}</a>
        ))}
      </nav>
      <div className="topbar-right">
        <span className={"stream-dot is-" + stream} role="status" aria-label={"Live updates: " + stream} title={"Live updates: " + stream} />
        <a className="btn" href="#/keys" aria-current={route.page === "keys" ? "page" : undefined}>
          <Icon name="key" size={15} /> API keys <span className="key-count">{keyed}</span>
        </a>
      </div>
    </header>
  );
}

function BottomBar({ route }: { route: Route }) {
  const item = (path: string, label: string, icon: IconName, current: boolean) => (
    <a href={"#/" + path} aria-current={current ? "page" : undefined}><Icon name={icon} size={20} />{label}</a>
  );
  return (
    <nav className="bottombar" aria-label="Main">
      {item("", "Home", "explore", route.page === "explore")}
      {item("remix", "Remix", "remix", route.page === "remix")}
      <a className="bottom-create" href="#/video" aria-current={route.page === "create" ? "page" : undefined} aria-label="Create">
        <span className="create-pill"><Icon name="sparkle" size={20} /></span>
      </a>
      {item("assets", "Assets", "assets", route.page === "assets")}
      {item("keys", "Keys", "key", route.page === "keys")}
    </nav>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case "create":
      return route.kind === "video" ? <VideoPage key="video" {...route} /> : <ImagePage key="image" {...route} />;
    case "remix":
      return <RemixPage {...route} />;
    case "director":
      return <DirectorPage {...route} />;
    case "presets":
      return <PresetsPage {...route} />;
    case "assets":
      return <AssetsPage {...route} />;
    case "keys":
      return <KeysPage {...route} />;
    default:
      return <HomePage />;
  }
}

export function App() {
  const route = useRoute();
  return (
    <div className="app">
      <TopBar route={route} />
      <div className="page"><Page route={route} /></div>
      <BottomBar route={route} />
    </div>
  );
}
