import { useMemo } from "react";
import { useModalFocus } from "../hooks/useModalFocus";
import { useI18n } from "../i18n";
import type { GenerateItem } from "../types";

type Field = {
  label: string;
  value: string;
  copyValue?: string;
  pre?: boolean;
  compact?: boolean;
};

type Section = {
  title: string;
  fields: Field[];
  compact?: boolean;
};

const PROVIDER_LABELS: Record<string, string> = {
  oauth: "GPT OAuth / Codex login",
  api: "GPT API key",
  grok: "Grok OAuth",
  "grok-api": "Grok API key",
  agy: "Antigravity Gemini CLI",
  "gemini-api": "Gemini API / Vertex",
  atlascloud: "Atlas Cloud API",
  "88api": "88API",
  minimax: "MiniMax API",
  nai: "NovelAI API",
};

function present(value: unknown): value is string | number | boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "boolean";
}

function stringify(value: unknown): string | null {
  if (!present(value)) return null;
  return String(value);
}

function formatDate(ts: unknown, locale: string): string | null {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ts));
}

function formatSize(size: string | null | undefined): string | null {
  if (!size) return null;
  return size.replace("x", "×");
}

function formatJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function addField(fields: Field[], label: string, value: unknown, options: Pick<Field, "copyValue" | "pre" | "compact"> = {}) {
  const text = stringify(value);
  if (!text) return;
  fields.push({ label, value: text, ...options });
}

function addPositiveField(fields: Field[], label: string, value: unknown, options: Pick<Field, "copyValue" | "pre" | "compact"> = {}) {
  if (typeof value !== "number" || value <= 0) return;
  addField(fields, label, value, options);
}

function addJsonField(fields: Field[], label: string, value: unknown) {
  const text = formatJson(value);
  if (!text || text === "{}" || text === "[]") return;
  fields.push({ label, value: text, copyValue: text, pre: true });
}

function sequenceSummary(item: GenerateItem): string | null {
  if (!item.sequenceId) return null;
  const parts = [
    item.sequenceIndex != null && item.sequenceTotalReturned != null
      ? `${item.sequenceIndex + 1}/${item.sequenceTotalReturned}`
      : null,
    item.sequenceTotalRequested != null ? `requested ${item.sequenceTotalRequested}` : null,
    item.sequenceStatus ?? null,
  ].filter(Boolean);
  return parts.length ? `${item.sequenceId} (${parts.join(", ")})` : item.sequenceId;
}

function providerLabel(provider: string | null | undefined): string | null {
  if (!provider) return null;
  return PROVIDER_LABELS[provider] ?? provider;
}

function normalizePrompt(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function addDistinctPrompt(fields: Field[], seen: Set<string>, label: string, value: unknown) {
  const text = stringify(value);
  if (!text) return;
  const normalized = normalizePrompt(text);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  fields.push({ label, value: text, copyValue: text, pre: true });
}

function usageNumber(usage: GenerateItem["usage"], key: string): number | null {
  const value = usage?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function usageDetailNumber(usage: GenerateItem["usage"], parentKey: string, key: string): number | null {
  const parent = usage?.[parentKey];
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) return null;
  const value = (parent as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compactFieldClass(field: Field): string {
  const classes = ["metadata-modal__row"];
  if (field.pre) classes.push("metadata-modal__row--pre");
  if (field.compact) classes.push("metadata-modal__row--compact");
  return classes.join(" ");
}

export function ResultMetadataModal({
  item,
  onClose,
  onCopy,
}: {
  item: GenerateItem;
  onClose: () => void;
  onCopy: (value: string) => void;
}) {
  const { t, locale } = useI18n();
  const containerRef = useModalFocus<HTMLElement>(true, onClose);
  const rawJson = useMemo(() => JSON.stringify(item, null, 2), [item]);
  const latestContinuity = item.videoContinuity?.entries?.[item.videoContinuity.entries.length - 1] ?? null;
  const provider = providerLabel(item.provider);
  const summaryFacts = [
    [provider, item.model].filter(Boolean).join(" · "),
    formatSize(item.size),
    item.elapsed != null ? `${item.elapsed}s` : null,
    item.usage?.total_tokens != null ? `${item.usage.total_tokens} ${t("metadata.fields.tokens").toLowerCase()}` : null,
  ].filter((value): value is string => Boolean(value));

  const sections: Section[] = [];

  const providerFields: Field[] = [];
  addField(providerFields, t("metadata.fields.provider"), provider, { compact: true });
  addField(providerFields, t("metadata.fields.model"), item.model, { compact: true });
  addField(providerFields, t("metadata.fields.providerUrl"), item.providerUrl, {
    copyValue: item.providerUrl ?? undefined,
  });
  addField(providerFields, t("metadata.fields.requestId"), item.requestId, {
    copyValue: item.requestId ?? undefined,
  });
  if (providerFields.length) sections.push({ title: t("metadata.sections.provider"), fields: providerFields, compact: true });

  const settingsFields: Field[] = [];
  addField(settingsFields, t("metadata.fields.quality"), item.quality, { compact: true });
  addField(settingsFields, t("metadata.fields.size"), formatSize(item.size), { compact: true });
  addField(settingsFields, t("metadata.fields.format"), item.format, { compact: true });
  addField(settingsFields, t("metadata.fields.moderation"), item.moderation, { compact: true });
  addField(settingsFields, t("metadata.fields.reasoning"), item.reasoningEffort, { compact: true });
  addField(settingsFields, t("metadata.fields.promptMode"), item.promptMode, { compact: true });
  addField(settingsFields, t("metadata.fields.kind"), item.kind, { compact: true });
  addField(settingsFields, t("metadata.fields.mediaType"), item.mediaType, { compact: true });
  if (settingsFields.length) sections.push({ title: t("metadata.sections.settings"), fields: settingsFields, compact: true });

  const usageFields: Field[] = [];
  addField(usageFields, t("metadata.fields.elapsed"), item.elapsed != null ? `${item.elapsed}s` : null, { compact: true });
  addField(usageFields, t("metadata.fields.totalTokens"), item.usage?.total_tokens, { compact: true });
  addField(usageFields, t("metadata.fields.inputTokens"), usageNumber(item.usage, "input_tokens"), { compact: true });
  addPositiveField(usageFields, t("metadata.fields.cachedTokens"), usageDetailNumber(item.usage, "input_tokens_details", "cached_tokens"), { compact: true });
  addField(usageFields, t("metadata.fields.outputTokens"), usageNumber(item.usage, "output_tokens"), { compact: true });
  addPositiveField(usageFields, t("metadata.fields.reasoningTokens"), usageDetailNumber(item.usage, "output_tokens_details", "reasoning_tokens"), { compact: true });
  addPositiveField(usageFields, t("metadata.fields.webSearchCalls"), item.webSearchCalls, { compact: true });
  if (item.usage?.grok_cost_usd_ticks != null) {
    addField(usageFields, t("metadata.fields.grokCostTicks"), item.usage.grok_cost_usd_ticks, { compact: true });
  }
  if (usageFields.length) sections.push({ title: t("metadata.sections.usage"), fields: usageFields, compact: true });

  const lineageFields: Field[] = [];
  addField(lineageFields, t("metadata.fields.filename"), item.filename, {
    copyValue: item.filename,
  });
  addField(lineageFields, t("metadata.fields.createdAt"), formatDate(item.createdAt, locale));
  addField(lineageFields, t("metadata.fields.sessionId"), item.sessionId);
  addField(lineageFields, t("metadata.fields.nodeId"), item.nodeId);
  addField(lineageFields, t("metadata.fields.parentNodeId"), item.parentNodeId);
  addField(lineageFields, t("metadata.fields.clientNodeId"), item.clientNodeId);
  addField(lineageFields, t("metadata.fields.refsCount"), item.refsCount);
  addField(lineageFields, t("metadata.fields.sequence"), sequenceSummary(item));
  addField(lineageFields, t("metadata.fields.setId"), item.setId);
  addField(lineageFields, t("metadata.fields.cardId"), item.cardId);
  if (lineageFields.length) sections.push({ title: t("metadata.sections.lineage"), fields: lineageFields });

  const videoFields: Field[] = [];
  addField(videoFields, t("metadata.fields.videoDuration"), item.video?.duration ? `${item.video.duration}s` : null);
  addField(videoFields, t("metadata.fields.videoResolution"), item.video?.resolution);
  addField(videoFields, t("metadata.fields.videoAspectRatio"), item.video?.aspectRatio);
  addField(videoFields, t("metadata.fields.videoRequestedModel"), item.video?.requestedModel);
  addField(videoFields, t("metadata.fields.videoEffectiveModel"), item.video?.effectiveModel);
  addField(videoFields, t("metadata.fields.videoModelFallback"), item.video?.modelFallback);
  addField(videoFields, t("metadata.fields.xaiVideoRequestId"), item.video?.xaiVideoRequestId, {
    copyValue: stringify(item.video?.xaiVideoRequestId) ?? undefined,
  });
  addField(videoFields, t("metadata.fields.sourceImageFilename"), item.video?.sourceImageFilename);
  if (videoFields.length) sections.push({ title: t("metadata.sections.video"), fields: videoFields });

  const continuityFields: Field[] = [];
  addField(continuityFields, t("metadata.fields.lineageId"), item.videoContinuity?.lineageId);
  addField(continuityFields, t("metadata.fields.parentFilename"), item.videoContinuity?.parentFilename);
  addField(continuityFields, t("metadata.fields.sourceFrame"), item.videoContinuity?.sourceFrame);
  addField(continuityFields, t("metadata.fields.continuityEntries"), item.videoContinuity?.entries?.length);
  addField(continuityFields, t("metadata.fields.latestContinuityPrompt"), latestContinuity?.revisedPrompt, {
    copyValue: latestContinuity?.revisedPrompt,
    pre: true,
  });
  if (continuityFields.length) sections.push({ title: t("metadata.sections.videoContinuity"), fields: continuityFields });

  const promptFields: Field[] = [];
  const seenPrompts = new Set<string>();
  addDistinctPrompt(promptFields, seenPrompts, t("metadata.fields.promptPrimary"), item.userPrompt ?? item.prompt);
  addDistinctPrompt(promptFields, seenPrompts, t("metadata.fields.revisedPrompt"), item.revisedPrompt);
  addDistinctPrompt(promptFields, seenPrompts, t("metadata.fields.prompt"), item.prompt);
  addDistinctPrompt(promptFields, seenPrompts, t("metadata.fields.composerPrompt"), item.composerPrompt);
  addJsonField(promptFields, t("metadata.fields.insertedPrompts"), item.composerInsertedPrompts);
  if (promptFields.length) sections.push({ title: t("metadata.sections.prompts"), fields: promptFields });

  return (
    <div className="modal-backdrop metadata-modal-backdrop" onClick={onClose}>
      <section ref={containerRef}
        className="modal metadata-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="metadata-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="metadata-modal__header">
          <div>
            <h3 id="metadata-modal-title">{t("metadata.title")}</h3>
            <p>{[item.mediaType ?? t("metadata.asset"), item.filename].filter(Boolean).join(" · ")}</p>
            {summaryFacts.length ? (
              <div className="metadata-modal__summary" aria-label={t("metadata.summary")}>
                {summaryFacts.map((fact) => (
                  <span key={fact}>{fact}</span>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="metadata-modal__close" onClick={onClose} aria-label={t("common.close")}>
            ×
          </button>
        </header>

        <div className="metadata-modal__body">
          {sections.map((section) => (
            <section className={section.compact ? "metadata-modal__section metadata-modal__section--compact" : "metadata-modal__section"} key={section.title}>
              <h4>{section.title}</h4>
              <dl>
                {section.fields.map((field) => (
                  <div className={compactFieldClass(field)} key={`${section.title}:${field.label}`}>
                    <dt>{field.label}</dt>
                    <dd>
                      {field.pre ? <pre>{field.value}</pre> : <span>{field.value}</span>}
                      {field.copyValue ? (
                        <button type="button" onClick={() => onCopy(field.copyValue!)} aria-label={t("metadata.copyField", { label: field.label })}>
                          {t("metadata.copy")}
                        </button>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          <details className="metadata-modal__raw">
            <summary>{t("metadata.rawJson")}</summary>
            <div className="metadata-modal__raw-actions">
              <button type="button" onClick={() => onCopy(rawJson)}>
                {t("metadata.copyRaw")}
              </button>
            </div>
            <pre>{rawJson}</pre>
          </details>
        </div>
      </section>
    </div>
  );
}
