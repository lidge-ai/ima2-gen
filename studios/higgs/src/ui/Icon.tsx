import brandMark from "../assets/brand-mark.svg?raw";
/** Hand-drawn 24px stroke icons for the studio. No third-party icon set. */
const PATHS: Record<string, string> = {
  explore: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3.5 5.5-2 5-5 2 2-5 5-2Z",
  image: "M4 5h16v14H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01",
  video: "M3.5 6.5h12v11h-12zM15.5 10.5l5-3v9l-5-3",
  remix: "M4 7h11l-3-3M20 17H9l3 3M17 4l3 3-3 3M7 20l-3-3 3-3",
  director: "M4 9h16v10H4zM4 9l3-5h3L7 9M10 9l3-5h3l-3 5M16 9l3-5",
  presets: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  assets: "M4 7l3-3h10l3 3v12H4zM4 7h16M9 11h6",
  key: "M14.5 9.5a4 4 0 1 1-1.2-2.8M13.3 6.7 21 14.4V18h-3v-2h-2v-2h-2",
  chevron: "M8 10l4 4 4-4",
  close: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v4h16v-4",
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",
  stop: "M7 7h10v10H7z",
  play: "M8 5l11 7-11 7z",
  check: "M5 12.5 10 17l9-10",
  alert: "M12 4 2.5 20h19L12 4Zm0 6v4m0 3h.01",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  sparkle: "M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3",
  audio: "M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z",
  menu: "M4 7h16M4 12h16M4 17h16",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4",
  ratio: "M5 7h14v10H5z",
  clock: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4v4l3 2",
  layers: "M12 4 3 9l9 5 9-5-9-5ZM3 14l9 5 9-5",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  external: "M14 5h5v5M19 5l-8 8M18 14v5H5V6h5",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, title }: { name: IconName; size?: number; title?: string }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo" role="img" aria-label="ima2 studio">
      <span className="logo-mark" aria-hidden dangerouslySetInnerHTML={{ __html: brandMark }} />
      <span className="logo-word" aria-hidden>ima2</span>
      <span className="logo-sub" aria-hidden>studio</span>
    </span>
  );
}
