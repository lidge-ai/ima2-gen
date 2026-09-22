import { useAppStore } from "../store/useAppStore";
import { estimateCost } from "../lib/cost";
import { useI18n } from "../i18n";

export function CostEstimate() {
  const { t } = useI18n();
  const provider = useAppStore((s) => s.provider);
  const quality = useAppStore((s) => s.quality);
  const multimode = useAppStore((s) => s.multimode);
  const multimodeMaxImages = useAppStore((s) => s.multimodeMaxImages);
  const getResolvedSize = useAppStore((s) => s.getResolvedSize);
  const size = getResolvedSize();

  const imageModel = useAppStore((s) => s.imageModel);
  const imageToolModel = useAppStore((s) => s.imageToolModel);
  const free = provider === "oauth" || provider === "grok" || provider === "agy";
  const cost = estimateCost(quality, size, provider, imageModel);
  const label = provider === "api" && imageToolModel
    ? t("imageToolModel.costUnavailable")
    : free
    ? t("cost.free")
    : multimode
      ? t("cost.multimodeApprox", { amount: (cost * multimodeMaxImages).toFixed(3), count: multimodeMaxImages })
      : t("cost.approx", { amount: cost.toFixed(3) });
  const color = free ? "var(--green)" : undefined;

  return (
    <div className="cost-estimate">
      <span>{t("cost.label")}</span>
      <span className="price" style={color ? { color } : undefined}>
        {label}
      </span>
    </div>
  );
}
