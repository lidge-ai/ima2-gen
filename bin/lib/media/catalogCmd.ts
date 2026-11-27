import { out } from "../output.js";
import type { Dict } from "./common.js";

export function printModels(data: Dict): void {
  for (const model of data.models as Dict[]) {
    out(`${model.id}  ${model.kind}  ${model.vendor}`);
    for (const route of model.routes as Dict[]) {
      const prices = (route.pricing as Dict[] ?? []).filter((p) => typeof p.usd === "number").sort((a, b) => Number(a.usd) - Number(b.usd));
      const price = prices[0];
      const key = route.keyless ? "not needed" : route.hasKey ? "yes" : "no";
      const cost = route.route === "local" ? "runs locally, no provider charge" : price ? `$${price.usd}/${price.unit}${price.variant ? ` (${price.variant})` : ""}` : "price unknown";
      out(`  ${route.adapter} ${route.route} key:${key} ${cost}`);
    }
  }
}
