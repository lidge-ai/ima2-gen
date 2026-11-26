import type { CSSProperties } from "react";
import { pickLogo, vendorId, vendorMonogram, vendorName, type VendorManifest } from "@ima2/studio-kit";

// Optional at build time: the manifest and files arrive from studios/kit/assets/vendors.
const manifests = import.meta.glob<VendorManifest>("../../../kit/assets/vendors/manifest.json", {
  eager: true,
  import: "default",
});
const urls = import.meta.glob<string>("../../../kit/assets/vendors/*.{svg,png,jpg,webp}", {
  eager: true,
  query: "?url",
  import: "default",
});
const manifest = Object.values(manifests)[0];

export function vendorDisplayName(id: string): string {
  return vendorName(id, manifest);
}

function urlFor(file: string): string | undefined {
  return urls["../../../kit/assets/vendors/" + file];
}

interface Props {
  /** Vendor or provider id; aliases like "bfl" resolve to the vendor. */
  id: string;
  /** "mark" for a square symbol slot, "full" for a wordmark slot. */
  shape?: "mark" | "full";
  /** Box height in px; a mark slot is square. */
  size?: number;
  /** Also print the name next to the logo. */
  withName?: boolean;
  className?: string;
}

/** Wordmarks may be at most this many times wider than tall before they are scaled down. */
const MAX_WORDMARK_RATIO = 6;

function Name({ name, show }: { name: string; show: boolean }) {
  return show ? <span className="vendor-logo-name">{name}</span> : null;
}

/**
 * The vendor's official logo from the kit manifest, unaltered, inside a box of fixed
 * size that the file cannot outgrow. A square slot shows only a real symbol; a vendor
 * without one gets a monogram tile, and a wordmark slot without a file shows the name.
 */
export function VendorLogo({ id, shape = "mark", size = 20, withName = false, className }: Props) {
  const name = vendorDisplayName(id);
  const pick = pickLogo(manifest, id, { background: "dark", shape });
  const url = pick ? urlFor(pick.file.file) : undefined;
  const base = "vendor-logo vendor-" + vendorId(id) + " is-" + shape + (className ? " " + className : "");
  const box: CSSProperties = { height: size, ...(shape === "mark" ? { width: size } : {}) };
  const label = withName ? undefined : name;
  if (!url || !pick) {
    if (shape === "full")
      return (
        <span className={base + " is-text"} title={name}>
          {name}
        </span>
      );
    return (
      <span className={base + " is-monogram"} title={name}>
        {/* The letter is drawn by CSS (attr), so it never joins the text of a row like "via fal". */}
        <span
          className="vendor-logo-box"
          data-monogram={vendorMonogram(name)}
          style={{ ...box, fontSize: Math.max(9, Math.round(size * 0.5)) }}
          role={label ? "img" : undefined}
          aria-label={label}
        />
        <Name name={name} show={withName} />
      </span>
    );
  }
  const { file } = pick;
  // White ink sits on a dark tile, every other file on a light one; app icons bring their own.
  const plate = file.tile ? "plate-tile" : file.variant === "dark" ? "plate-dark" : "plate-light";
  const ratio = file.width && file.height ? file.width / file.height : 3;
  const maxWidth = shape === "mark" ? size : Math.round(size * Math.min(ratio, MAX_WORDMARK_RATIO));
  const inset = Math.max(1, Math.round(size * 0.12));
  const padding = file.tile ? 0 : shape === "mark" ? inset : inset + "px " + inset * 2 + "px";
  return (
    <span className={base + " " + plate} title={name}>
      <span className="vendor-logo-box" style={{ ...box, maxWidth, padding }}>
        <img src={url} alt={label ?? ""} loading="lazy" decoding="async" />
      </span>
      <Name name={name} show={withName} />
    </span>
  );
}
