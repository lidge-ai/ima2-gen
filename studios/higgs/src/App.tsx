import { useRef, useState } from "react";
import { Popover } from "./ui/Popover.tsx";
import { useStudio } from "./studio/context.tsx";
import { useRoute, type Route } from "./router.ts";
import { Icon, Logo, type IconName } from "./ui/Icon.tsx";
import { LOCALES, messages, setLocale, useLocale, useT } from "./i18n.ts";
import { HomePage } from "./pages/HomePage.tsx";
import { ImagePage } from "./pages/ImagePage.tsx";
import { VideoPage } from "./pages/VideoPage.tsx";
import { PresetsPage } from "./pages/PresetsPage.tsx";
import { RemixPage } from "./pages/remix/RemixPage.tsx";
import { DirectorPage } from "./pages/director/DirectorPage.tsx";
import { AssetsPage } from "./pages/assets/AssetsPage.tsx";
import { KeysPage } from "./pages/keys/KeysPage.tsx";
import { ModelsPage } from "./pages/models/ModelsPage.tsx";

const M = messages(
  {
    home: "Home",
    image: "Image",
    video: "Video",
    remix: "Remix",
    director: "Director",
    models: "Models",
    presets: "Presets",
    assets: "Assets",
    keys: "Keys",
    create: "Create",
    main: "Main",
    brand: "ima2 studio home",
    apiKeys: "API keys",
    addKey: "Add API key",
    connecting: "Connecting",
    reconnecting: "Reconnecting",
    closed: "Offline",
    language: "Language",
  },
  {
    home: "홈",
    image: "이미지",
    video: "영상",
    remix: "리믹스",
    director: "디렉터",
    models: "모델",
    presets: "프리셋",
    assets: "에셋",
    keys: "키",
    create: "만들기",
    main: "주 메뉴",
    brand: "ima2 스튜디오 홈",
    apiKeys: "API 키",
    addKey: "API 키 추가",
    connecting: "연결 중",
    reconnecting: "다시 연결 중",
    closed: "연결 끊김",
    language: "언어",
  },
);
type Key = keyof typeof M.en;

const NAV: { path: string; label: Key; icon: IconName; match: (r: Route) => boolean }[] = [
  { path: "", label: "home", icon: "explore", match: (r) => r.page === "explore" },
  { path: "image", label: "image", icon: "image", match: (r) => r.page === "create" && r.kind === "image" },
  { path: "video", label: "video", icon: "video", match: (r) => r.page === "create" && r.kind === "video" },
  { path: "remix", label: "remix", icon: "remix", match: (r) => r.page === "remix" },
  { path: "director", label: "director", icon: "director", match: (r) => r.page === "director" },
  { path: "models", label: "models", icon: "layers", match: (r) => r.page === "models" },
  { path: "presets", label: "presets", icon: "presets", match: (r) => r.page === "presets" },
  { path: "assets", label: "assets", icon: "assets", match: (r) => r.page === "assets" },
];

/** Says something only when live updates are not flowing; a working connection needs no badge. */
function StreamStatus() {
  const t = useT(M);
  const stream = useStudio((s) => s.stream);
  const text = stream === "open" ? null : t(stream);
  return (
    <span className={"stream-status is-" + stream} role="status">
      {text ? (
        <>
          <span className="stream-dot" aria-hidden="true" />
          {text}
        </>
      ) : null}
    </span>
  );
}

function KeysButton({ route }: { route: Route }) {
  const t = useT(M);
  const loaded = useStudio((s) => s.catalog !== null);
  const keyed = useStudio((s) => s.keys.filter((k) => k.configured).length);
  return (
    <a className="btn" href="#/keys" aria-current={route.page === "keys" ? "page" : undefined}>
      <Icon name="key" size={15} />
      {loaded && keyed === 0 ? (
        t("addKey")
      ) : (
        <>
          {t("apiKeys")}{" "}
          {keyed > 0 ? <span className="key-count">{keyed}</span> : null}
        </>
      )}
    </a>
  );
}

/** Two languages, so one button names the other one. */
function LanguageSwitch() {
  const t = useT(M);
  const locale = useLocale();
  const next = LOCALES.find((l) => l.id !== locale)!;
  return (
    <button
      type="button"
      className="btn btn-ghost lang-switch"
      lang={next.id}
      aria-label={t("language") + ": " + next.label}
      onClick={() => setLocale(next.id)}
    >
      {next.label}
    </button>
  );
}

function TopBar({ route }: { route: Route }) {
  const t = useT(M);
  return (
    <header className="topbar">
      <a className="brand" href="#/" aria-label={t("brand")}>
        <Logo />
      </a>
      <nav className="nav" aria-label={t("main")}>
        {NAV.map((item) => (
          <a key={item.path} href={"#/" + item.path} aria-current={item.match(route) ? "page" : undefined}>
            {t(item.label)}
          </a>
        ))}
      </nav>
      <div className="topbar-right">
        <StreamStatus />
        <LanguageSwitch />
        <KeysButton route={route} />
      </div>
    </header>
  );
}

function BottomBar({ route }: { route: Route }) {
  const t = useT(M);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const item = (path: string, label: Key, icon: IconName, current: boolean) => (
    <a href={"#/" + path} aria-current={current ? "page" : undefined}>
      <Icon name={icon} size={20} />
      {t(label)}
    </a>
  );
  return (
    <nav className="bottombar" aria-label={t("main")}>
      {item("", "home", "explore", route.page === "explore")}
      {item("remix", "remix", "remix", route.page === "remix")}
      <button ref={trigger} type="button" className="bottom-create" aria-label={t("create")}
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="create-pill"><Icon name="sparkle" size={20} /></span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label={t("create")} anchor={trigger} placement="top" className="mobile-create-menu">
        {NAV.filter((entry) => ["image", "video", "remix", "director", "models", "presets"].includes(entry.path)).map((entry) => (
          <a key={entry.path} href={"#/" + entry.path} aria-current={entry.match(route) ? "page" : undefined} onClick={() => setOpen(false)}>
            <Icon name={entry.icon} size={18} /> {t(entry.label)}
          </a>
        ))}
      </Popover>
      {item("assets", "assets", "assets", route.page === "assets")}
      {item("keys", "keys", "key", route.page === "keys")}
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
    case "models":
      return <ModelsPage {...route} />;
    case "keys":
      return <KeysPage {...route} />;
    default:
      return <HomePage />;
  }
}

export function App() {
  const route = useRoute();
  // Subscribing here re-renders the tree on a language change, so plain label helpers
  // (tr) pick it up too, without remounting and losing what the user typed.
  useLocale();
  return (
    <div className="app">
      <TopBar route={route} />
      <div className="page">
        <Page route={route} />
      </div>
      <BottomBar route={route} />
    </div>
  );
}

