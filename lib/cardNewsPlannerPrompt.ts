interface PlannerRoleTemplate {
  id?: string | undefined;
  roles?: Array<{ role?: string | undefined; promptHint?: string | undefined; preferredSlots?: unknown[] | undefined }> | undefined;
}

interface PlannerImageTemplate {
  id?: string | undefined;
  name?: string | undefined;
  stylePrompt?: string | undefined;
  recommendedOutputSizes?: unknown[] | undefined;
  slots?: unknown[] | undefined;
  palette?: unknown[] | undefined;
}

export interface CardNewsPlannerInput {
  topic?: string | undefined;
  audience?: string | undefined;
  goal?: string | undefined;
  contentBrief?: string | undefined;
  size?: string | undefined;
  roleTemplate?: PlannerRoleTemplate | null | undefined;
  imageTemplate?: PlannerImageTemplate | null | undefined;
}

export function buildCardNewsPlannerMessages(input: CardNewsPlannerInput = {}) {
  const roleTemplate: PlannerRoleTemplate = input.roleTemplate || {};
  const imageTemplate: PlannerImageTemplate = input.imageTemplate || {};
  return [
    {
      role: "developer",
      content: [
        "You are a Card News planning assistant.",
        "Return JSON only. Do not call image tools. Do not generate images.",
        "Keep the selected card count and role order exactly.",
        "Preserve the user's original language for headline, body, textFields, and visualPrompt.",
        "Do not translate to English unless explicitly requested.",
        "If the user mixes languages, preserve the mix.",
        "If the user provides exact text, preserve it exactly.",
        "Role names such as cover/problem/cta are structural labels, not visible design text.",
        "Keep headline and body as UI/manifest text.",
        "Only textFields[].text with renderMode=\"in-image\" is intended to appear inside the image.",
        "When visible text needs a specific language, textFields[].text must contain the exact words in that language/script.",
        "Do not translate, romanize, summarize, or replace visible text.",
        "Create textFields only for text that should be readable inside the image.",
        "Prefer template slot ids and placements when assigning textFields.",
        "Use headline textFields for hook/cover cards, body or caption textFields for explanation cards, and cta textFields only for action cards.",
        "Never put structural role labels such as CTA, cover, problem, insight, or example into textFields unless the user explicitly requested that exact visible wording.",
        "Placement examples: top-right badge, top-center headline, center-left supporting caption, bottom-center CTA.",
        "Make visualPrompt describe scene, layout, style, spatial composition, and text-box placement only.",
        "Do not duplicate visible text in visualPrompt except to reference a text box position.",
        "visualPrompt may mention a text box location, but the exact readable copy must live only in textFields[].text.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        topic: input.topic || "",
        audience: input.audience || "",
        goal: input.goal || "",
        contentBrief: input.contentBrief || "",
        size: input.size || "2048x2048",
        imageTemplate: {
          id: imageTemplate.id,
          name: imageTemplate.name,
          stylePrompt: imageTemplate.stylePrompt,
          recommendedOutputSizes: imageTemplate.recommendedOutputSizes || [],
          slots: imageTemplate.slots || [],
          palette: imageTemplate.palette || [],
        },
        roleTemplate: {
          id: roleTemplate.id,
          roles: (roleTemplate.roles || []).map((role) => ({
            role: role.role,
            promptHint: role.promptHint,
            preferredSlots: role.preferredSlots || [],
          })),
        },
        textFieldPolicy: {
          visibleTextSource: "textFields[].text",
          renderableMode: "in-image",
          structuralRoleLabelsAreNotVisibleText: true,
        },
      }),
    },
  ];
}
