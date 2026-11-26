import { pickLogo, vendorId, vendorName, type VendorManifest } from "@ima2/studio-kit";

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
  /** "mark" for square icons, "full" for the wordmark. */
  shape?: "mark" | "full";
  size?: number;
  /** Also print the name next to the logo. */
  withName?: boolean;
  className?: string;
}

/**
 * The vendor's official logo from the kit manifest, unaltered. When no file was
 * obtained the vendor's name is shown as text instead of a drawn substitute.
 */
export function VendorLogo({ id, shape = "mark", size = 20, withName = false, className }: Props) {
  const name = vendorDisplayName(id);
  const pick = pickLogo(manifest, id, { background: "dark", shape });
  const url = pick ? urlFor(pick.file.file) : undefined;
  // Logos made for dark backgrounds sit on the page; every other official file sits on a light plate so it stays legible.
  const plate = pick?.file.variant === "dark" ? "plate-dark" : "plate-light";
  const cls = "vendor-logo vendor-" + vendorId(id) + " is-" + shape + " " + plate + (className ? " " + className : "");
  if (!url) {
    return (
      <span className={cls + " is-text"} title={name}>
        {shape === "mark" && !withName ? name.slice(0, 1) : name}
      </span>
    );
  }
  return (
    <span className={cls} title={name}>
      <span className="vendor-logo-plate" style={{ height: size, ...(shape === "mark" ? { width: size } : {}) }}>
        <img src={url} alt={withName ? "" : name} loading="lazy" decoding="async" />
      </span>
      {withName ? <span className="vendor-logo-name">{name}</span> : null}
    </span>
  );
}
