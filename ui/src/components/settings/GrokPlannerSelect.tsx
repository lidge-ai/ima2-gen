import { fetchApi } from "../../lib/api-core";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { Select } from "../controls";

interface PlannerConfig {
  model: string;
  options: string[];
}

export function GrokPlannerSelect() {
  const { t } = useI18n();
  const [config, setConfig] = useState<PlannerConfig | null>(null);

  useEffect(() => {
    fetchApi("/api/config/grok-planner")
      .then((r) => r.json() as Promise<PlannerConfig>)
      .then(setConfig)
      .catch(() => { /* best-effort: without planner config the row stays hidden */ });
  }, []);

  const onChange = async (model: string) => {
    try {
      await fetchApi("/api/config/grok-planner", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      setConfig((prev) => prev ? { ...prev, model } : null);
    } catch (err) { console.warn("[settings] grok planner update failed:", err); }
  };

  if (!config) return null;

  return (
    <article className="settings-row">
      <div className="settings-row__copy">
        <h4>{t("settings.grokPlanner.title")}</h4>
        <p>{t("settings.grokPlanner.body")}</p>
      </div>
      <div className="settings-row__control">
        <Select
          items={config.options.map((model) => ({ value: model, label: model }))}
          value={config.model}
          onChange={(model) => void onChange(model)}
          ariaLabel={t("settings.grokPlanner.title")}
        />
      </div>
    </article>
  );
}
