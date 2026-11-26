import { useI18n } from "../../i18n";
import type { MediaRoute } from "../../lib/mediaCatalog";
import { formatUsd } from "../../lib/mediaFormat";
import type { MediaSelection } from "../../lib/mediaSelection";
import { unitPrice } from "./mediaLabels";
import { useMediaQuote, type QuoteView } from "./useMediaQuote";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** "$2.37", "from $0.67", "$0.011–$0.167", or null when the price list cannot say. */
export function quoteAmount(view: QuoteView, t: Translate): string | null {
  const { quote } = view;
  if (quote.state === "exact" && view.usd !== null) return formatUsd(view.usd);
  if (quote.state === "from" && view.usd !== null) return t("mediaPicker.from", { price: formatUsd(view.usd) });
  if (quote.state === "range") return formatUsd(quote.min) + "–" + formatUsd(quote.max);
  return null;
}

/** The estimate with what it is made of, so the number can be checked against the provider's price list. */
export function MediaEstimate({ route, selection }: { route: MediaRoute; selection: MediaSelection }) {
  const { t } = useI18n();
  const view = useMediaQuote(route, selection);
  const { quote } = view;
  const amount = quoteAmount(view, t);
  return (
    <div className="cost-estimate media-estimate" role="status">
      <span>{t("mediaPicker.estimate.label")}</span>
      <span className="price">{amount ?? (quote.state === "unpriced" ? t("mediaPicker.noPrice") : t("mediaPicker.estimate.unknown"))}</span>
      {quote.state === "exact" || quote.state === "from" ? (
        <small>{quote.unit === "second" ? t("mediaPicker.estimate.basisSeconds", { n: quote.quantity, price: unitPrice(quote.price, t) }) : unitPrice(quote.price, t)}
          {quote.price.variant ? " · " + quote.price.variant : ""}</small>
      ) : null}
      {quote.state === "range" ? <small>{t("mediaPicker.estimate.rangeNote")}</small> : null}
      {quote.state === "unpriced" ? <small>{t("mediaPicker.estimate.unpricedNote", { provider: route.label })}</small> : null}
    </div>
  );
}
