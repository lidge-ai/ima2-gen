import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MAX_REF2V_REFERENCES, MAX_REFERENCE_AUDIOS, MAX_VIDEO_DURATION } from "../lib/imageModels.js";

// devlog/_plan/260820_grok15_multi_reference_video/080_skill_15_first_class.md
//
// The packaged skill is what an agent reads before choosing a model, so a stale sentence
// there costs a wrong decision on every run. It drifted badly once already: it kept
// saying 1.5 could not take reference images for a whole release after that became false,
// and a contract test was pinning that claim in place.
//
// Prose cannot be verified wholesale, but the numbers can: these tie the figures the
// skill quotes to the constants the server actually enforces.

function skill(): string {
  return readFileSync(new URL("../skills/ima2/SKILL.md", import.meta.url), "utf8");
}

test("the skill quotes the reference ceiling the server enforces", () => {
  assert.equal(MAX_REF2V_REFERENCES, 14);
  assert.match(skill(), /1-14 refs/, "the skill must state the real reference range");
});

test("the skill names the model each reference-to-video ceiling belongs to", () => {
  // A bare "15s" row reads as a mode-wide rule, which is how the invented 10s clamp
  // got written in the first place. The ceiling is per model now, so the skill has to
  // say which model it is talking about or an agent will apply the wrong one.
  const text = skill();
  assert.match(text, /15 seconds on\s+`grok-imagine-video-1\.5` and 10 seconds on `grok-imagine-video`/);
});

test("the skill quotes the voice ceiling the server enforces", () => {
  assert.equal(MAX_REFERENCE_AUDIOS, 3);
  assert.match(skill(), /up to 3/, "the skill must state the real preset-voice ceiling");
});

test("the skill does not re-impose a shorter reference-to-video ceiling", () => {
  assert.equal(MAX_VIDEO_DURATION, 15);
  const text = skill();
  assert.doesNotMatch(
    text,
    /reference-to-video \| 10s/,
    "the 10s reference ceiling was removed in v3.8.0; the skill must not teach it",
  );
  assert.match(text, /reference-to-video \| 15s/);
});

test("the skill presents 1.5 as the model to reach for first", () => {
  // Capability lives on 1.5; base exists for the two operations 1.5 refuses. An agent
  // reading this should not have to weigh the two on every request.
  const text = skill();
  assert.match(text, /Model choice: reach for 1\.5 first/);
  assert.match(text, /1\.5 for generating, base for editing and extending/);
});

test("the skill records that no request falls back to another model", () => {
  // A retry on another model could spend on a model the user did not choose (plan G4).
  assert.match(skill(), /ima2 never retries on another model/);
});
