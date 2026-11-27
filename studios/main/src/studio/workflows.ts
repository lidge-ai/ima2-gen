import { useMemo } from "react";
import { localizeWorkflow, type WorkflowDef } from "@ima2/studio-kit";
import { useLocale } from "../i18n.ts";
import { useStudio } from "./context.tsx";

/** Workflows with their visible text in the current language (server i18n, English fallback). */
export function useWorkflows(): readonly WorkflowDef[] {
  const all = useStudio((s) => s.workflows);
  const locale = useLocale();
  return useMemo(() => all.map((def) => localizeWorkflow(def, locale)), [all, locale]);
}
