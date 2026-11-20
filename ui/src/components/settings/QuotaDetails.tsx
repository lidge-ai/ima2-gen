import { useState } from "react";
import type { ReactNode } from "react";

export interface QuotaDetailsState { open: boolean; toggle(): void }

/** Detail panels start folded; the open state lasts only while this view stays mounted. */
export function useQuotaDetails(): QuotaDetailsState {
  const [open, setOpen] = useState(false);
  return { open, toggle: () => setOpen(!open) };
}

/**
 * Header button with a one-line summary. The body stays mounted while hidden so its
 * account-bound reads and polling keep the summary current.
 */
export function quotaDetails(id: string, state: QuotaDetailsState, title: ReactNode, summary: ReactNode, body: ReactNode) {
  return <section className="quota-details">
    <button type="button" className="quota-details__toggle" aria-expanded={state.open} aria-controls={id} onClick={state.toggle}>
      <span className="quota-details__chevron" aria-hidden="true">{state.open ? "▾" : "▸"}</span>
      <span className="quota-details__title">{title}</span>
      <span className="quota-details__summary">{summary}</span>
    </button>
    <div id={id} className="quota-details__body" hidden={!state.open}>{body}</div>
  </section>;
}
