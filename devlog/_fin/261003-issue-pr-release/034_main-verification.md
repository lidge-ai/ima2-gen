# Main integration review

Main inspected the actual picker state transitions, pure prompt builder, media sorter, caller exposure and Korean1280/320 captures. The Node exposure defect was fixed with a hook-safe visibility guard; the real node→classic transition preserves chips and selection without generation. Gibbs independently accepted the correction and reviewed the implementation/evidence, with no remaining blockers.

The first canonical suite found only the new dynamic translation expression missing from the repository's finite resolver registry. tests/i18n-dictionary-contract.test.ts now names the exact SoundIntentPicker call signature and six literal keys. No wildcard, skip or known-missing exception was added; all four dictionaries remain checked. Focused i18n/preset tests:10 pass. Independent review confirmed the registration matches production keys and does not weaken the gate.

The file-map additions use full repository-relative UI paths so the existing line-count checker actually observes them; SoundIntentPicker is66 newline-split lines. Rendered evidence stays outside the PR branch; immutable pr-assets screenshots will be embedded in the PR description. Final canonical and clean-head browser receipts are run after this checkpoint, and hosted checks remain required before merge.
