import { ulid } from "ulid";
import { getRoleTemplate } from "./cardNewsRoleTemplateStore.js";
import { getImageTemplate } from "./cardNewsTemplateStore.js";
import { buildCardNewsPlannerMessages } from "./cardNewsPlannerPrompt.js";
import { requestCardNewsPlannerJson } from "./cardNewsPlannerClient.js";
import { repairPlannerOutput, validatePlannerOutput } from "./cardNewsPlannerSchema.js";
import { waitForOAuthReady } from "./oauthProxy.js";
import type { RouteRuntimeContext } from "./runtimeContext.js";

import { errInfo } from "./errInfo.js";

interface RoleEntry {
  role: string;
  required: boolean;
  promptHint: string;
  preferredSlots: string[];
}

interface RoleTemplate {
  id: string;
  name: string;
  defaultCount: number;
  roles: RoleEntry[];
}

interface CardNewsBriefInput {
  setId?: string | undefined;
  topic?: string | undefined;
  title?: string | undefined;
  audience?: string | undefined;
  goal?: string | undefined;
  contentBrief?: string | undefined;
  imageTemplateId?: string | undefined;
  roleTemplateId?: string | undefined;
  size?: string | undefined;
}

interface BriefForBody {
  audience?: string | undefined;
  goal?: string | undefined;
  content?: string | undefined;
}

interface PlannerCardOutput {
  role: string;
  headline: string;
  body: string;
  visualPrompt: string;
  textFields?: unknown | undefined;
  references?: unknown[] | undefined;
  order?: number | undefined;
}

interface PlannerOutput {
  title: string;
  topic: string;
  audience?: string | undefined;
  goal?: string | undefined;
  cards: PlannerCardOutput[];
}

function compactText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function detectBriefLanguage(input: CardNewsBriefInput): "ko" | "en" | "und" {
  const text = [input.topic, input.audience, input.goal, input.contentBrief].filter(Boolean).join(" ");
  if (/[가-힣]/.test(text)) return "ko";
  if (/[A-Za-z]/.test(text)) return "en";
  return "und";
}

function fallbackLabel(role: string, lang: string): string {
  const ko: Record<string, string> = {
    cta: "다음 행동",
    problem: "왜 중요한가",
    insight: "핵심 인사이트",
    example: "예시로 보기",
    data: "숫자로 확인",
    summary: "요약",
  };
  const en: Record<string, string> = {
    cta: "Next action",
    problem: "Why it matters",
    insight: "Key insight",
    example: "Example",
    data: "By the numbers",
    summary: "Summary",
  };
  if (lang === "ko") return ko[role] || role;
  if (lang === "en") return en[role] || role;
  return "";
}

function headlineFor(role: string, topic: string, lang: string): string {
  const label = compactText(topic, "Card news");
  if (role === "cover" || role === "hook") return label;
  return fallbackLabel(role, lang) || label;
}

function bodyFor(role: string, brief: BriefForBody, lang: string): string {
  const content = compactText(brief.content, "");
  if (content) return content;
  const target = compactText(brief.audience, lang === "ko" ? "독자" : "reader");
  const goal = compactText(brief.goal, lang === "ko" ? "핵심 메시지" : "the key message");
  if (lang === "ko") {
    if (role === "cta") return `${target}가 바로 실행할 수 있는 다음 단계를 제안합니다.`;
    if (role === "problem") return `${target}가 겪는 문제를 짧고 분명하게 보여줍니다.`;
    if (role === "insight") return `${goal}을 이해하기 쉬운 한 문장으로 정리합니다.`;
    return `${goal}을 카드 역할에 맞춰 전달합니다.`;
  }
  if (role === "cta") return `Suggest a next step ${target} can take immediately.`;
  if (role === "problem") return `Show the problem ${target} faces in a concise way.`;
  if (role === "insight") return `Explain ${goal} in one clear sentence.`;
  return `Present ${goal} for this card.`;
}

function normalizeTextFields(fields: unknown): unknown[] {
  return Array.isArray(fields) ? fields : [];
}

function toCardNewsPlan(plannerOutput: PlannerOutput, input: CardNewsBriefInput, roleTemplate: RoleTemplate) {
  const topic = compactText(plannerOutput.topic, compactText(input.topic, input.title || "Untitled card news"));
  return {
    setId: input.setId || `cs_${ulid()}`,
    title: compactText(plannerOutput.title, topic),
    topic,
    imageTemplateId: input.imageTemplateId || "academy-lesson-square",
    roleTemplateId: roleTemplate.id,
    size: input.size || "2048x2048",
    generationStrategy: "parallel-template-i2i",
    cards: plannerOutput.cards.map((card, index) => ({
      id: `card_${index + 1}`,
      order: index + 1,
      role: card.role,
      headline: card.headline,
      body: card.body,
      visualPrompt: card.visualPrompt,
      textFields: normalizeTextFields(card.textFields),
      templateSlotAssignments: {
        title: "headline",
        body: "body",
        image: "visual",
      },
      references: card.references || [],
      locked: false,
      status: "draft",
    })),
  };
}

export function createDeterministicCardNewsDraft(input: CardNewsBriefInput = {}) {
  const roleTemplate = getRoleTemplate(input.roleTemplateId) as RoleTemplate;
  const topic = compactText(input.topic, input.title || "Untitled card news");
  const title = compactText(input.title, topic);
  const brief: BriefForBody = {
    audience: input.audience,
    goal: input.goal,
    content: input.contentBrief,
  };
  const lang = detectBriefLanguage(input);
  const output: PlannerOutput = {
    title,
    topic,
    audience: compactText(input.audience, ""),
    goal: compactText(input.goal, ""),
    cards: roleTemplate.roles.map((role, idx) => ({
      order: idx + 1,
      role: role.role,
      headline: headlineFor(role.role, topic, lang),
      body: bodyFor(role.role, brief, lang),
      visualPrompt: `${role.promptHint}, ${topic}`,
      textFields: [],
      references: [],
    })),
  };
  return toCardNewsPlan(output, input, roleTemplate);
}

type PlannerError = Error & { code?: string | undefined; status?: number | undefined };

function plannerError(message: string, code: string, status: number): PlannerError {
  const err = new Error(message) as PlannerError;
  err.code = code;
  err.status = status;
  return err;
}

export async function createCardNewsDraft(ctxOrInput: RouteRuntimeContext | CardNewsBriefInput = {} as CardNewsBriefInput, maybeInput: CardNewsBriefInput = {}) {
  const hasCtx = Boolean((ctxOrInput as RouteRuntimeContext | undefined)?.config);
  const ctx = hasCtx ? (ctxOrInput as RouteRuntimeContext) : null;
  const input = hasCtx ? maybeInput : (ctxOrInput as CardNewsBriefInput);
  const roleTemplate = getRoleTemplate(input.roleTemplateId) as RoleTemplate;

  if (!ctx) return createDeterministicCardNewsDraft(input);
  const planner = (ctx.config as { cardNewsPlanner?: { enabled?: boolean | undefined; model?: string | undefined; timeoutMs?: number | undefined; deterministicFallback?: boolean | undefined } } | undefined)?.cardNewsPlanner;
  if (!planner?.enabled) {
    return {
      plan: createDeterministicCardNewsDraft(input),
      planner: { mode: "deterministic-fallback", model: "none", repaired: false },
    };
  }

  const imageTemplate = await getImageTemplate(ctx, input.imageTemplateId || "academy-lesson-square");
  try {
    await waitForOAuthReady(ctx);
    const messages = buildCardNewsPlannerMessages({ ...input, roleTemplate, imageTemplate });
    const raw = await requestCardNewsPlannerJson({ messages }, {
      oauthUrl: (ctx as RouteRuntimeContext & { oauthUrl?: string | undefined }).oauthUrl,
      oauthTransport: (ctx as RouteRuntimeContext & { oauthTransport?: "native" | "proxy" | undefined }).oauthTransport,
      model: planner.model,
      timeoutMs: planner.timeoutMs,
    });
    let result = validatePlannerOutput(raw.output, roleTemplate);
    if (!result.ok) result = repairPlannerOutput(raw.output, { ...input, roleTemplate });
    if (!result.ok) throw plannerError("Planner schema invalid", "PLANNER_SCHEMA_INVALID", 422);
    return {
      plan: toCardNewsPlan(result.plan as PlannerOutput, input, roleTemplate),
      planner: { mode: raw.mode, model: raw.model, repaired: result.repaired },
    };
  } catch (e) {
    const err = errInfo(e);
    if (planner.deterministicFallback) {
      return {
        plan: createDeterministicCardNewsDraft(input),
        planner: {
          mode: "deterministic-fallback",
          model: planner.model,
          repaired: true,
        },
      };
    }
    if (err.code) throw err.raw;
    throw plannerError(err.message || "Planner unavailable", "PLANNER_UNAVAILABLE", 503);
  }
}
