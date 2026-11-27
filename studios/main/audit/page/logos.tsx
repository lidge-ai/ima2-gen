import { createRoot } from "react-dom/client";
import type { VendorManifest } from "@ima2/studio-kit";
import { VendorLogo, vendorDisplayName } from "../../src/ui/VendorLogo.tsx";
import "../../src/styles/base.css";
import "../../src/styles/shell.css";
import "../../src/styles/panel.css";
import "../../src/styles/models.css";
import "./logos.css";

/**
 * Dev-only audit page (served by Vite at /audit/logos.html, never built): every manifest
 * vendor in every slot the studio shows logos in, with the real component and styles.
 * It reads the manifest itself so the same page renders older versions of VendorLogo.
 */
const manifest = Object.values(
  import.meta.glob<VendorManifest>("../../../kit/assets/vendors/manifest.json", { eager: true, import: "default" }),
)[0];

function Row({ id }: { id: string }) {
  return (
    <tr data-vendor={id}>
      <th scope="row">
        {vendorDisplayName(id)}
        <code>{id}</code>
      </th>
      <td data-slot="chip">
        <button type="button" className="chip chip-logo">
          <VendorLogo id={id} size={18} withName />
        </button>
      </td>
      <td data-slot="chip-pressed">
        <button type="button" className="chip chip-logo" aria-pressed="true">
          <VendorLogo id={id} size={18} withName />
        </button>
      </td>
      <td data-slot="route">
        <ul className="route-lines">
          <li className="route-line">
            <VendorLogo id={id} size={18} />
            <span className="route-line-name">
              <span className="route-line-label">{vendorDisplayName(id)}</span>
              <span className="tag">Direct</span>
            </span>
            <span className="route-line-price">from $0.05/s</span>
            <span className="key-state is-off">No key</span>
          </li>
        </ul>
      </td>
      <td data-slot="card">
        <div className="model-card-head">
          <VendorLogo id={id} size={32} />
          <div>
            <h3>Model name</h3>
            <p className="model-card-maker">{vendorDisplayName(id)} · Text to video</p>
          </div>
        </div>
      </td>
      <td data-slot="picker">
        <VendorLogo id={id} size={30} />
      </td>
      <td data-slot="keys">
        <VendorLogo id={id} size={20} withName />
      </td>
      <td data-slot="inline">
        <VendorLogo id={id} size={14} />
      </td>
      <td data-slot="wordmark">
        <VendorLogo id={id} shape="full" size={24} />
      </td>
    </tr>
  );
}

function Sheet() {
  return (
    <table className="logo-sheet">
      <thead>
        <tr>
          {["Vendor", "Chip 18", "Chip pressed", "Route row 18", "Card head 32", "Picker 30", "Keys 20", "Inline 14", "Wordmark 24"].map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(manifest?.vendors ?? []).map(({ id }) => (
          <Row key={id} id={id} />
        ))}
      </tbody>
    </table>
  );
}

createRoot(document.getElementById("root")!).render(<Sheet />);

