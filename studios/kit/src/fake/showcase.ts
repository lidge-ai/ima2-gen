import { fixture } from "./media.ts";
import type { Jobs } from "./jobs.ts";

/**
 * Two showcase entries backed by the fake video fixtures, registered under /generated so the
 * fake server serves them like results. FAKE_SHOWCASE=0 returns an empty list (the hidden state).
 */
export function fakeShowcase(jobs: Jobs): { items: unknown[] } {
  if (process.env.FAKE_SHOWCASE === "0") return { items: [] };
  const clip = (name: string, prompt: string, ratio: string) => {
    if (!jobs.files.has(name)) jobs.files.set(name, fixture("video", prompt, ratio));
    return "/generated/" + name;
  };
  return {
    items: [
      {
        id: "showcase-swap",
        title: { en: "Swap the dancer", ko: "춤추는 사람 바꾸기" },
        workflow: "remix-object-swap",
        values: { target: "the dancer", prompt: "a knight in silver armour" },
        result: clip("showcase-swap-result.mp4", "showcase swap result", "9:16"),
        source: clip("showcase-swap-source.mp4", "showcase swap source", "9:16"),
        models: ["bytedance/seedance-2.5"],
        keys: ["byteplus"],
        estimate: { usd: 0.76, basis: "5 s × $0.15/s (BytePlus 720p)" },
        durationSec: 5,
      },
      {
        id: "showcase-motion",
        title: { en: "Move like the clip", ko: "영상처럼 움직이기" },
        workflow: "remix-motion-transfer",
        values: { prompt: "a paper boat on a canal" },
        result: clip("showcase-motion-result.mp4", "showcase motion result", "16:9"),
        source: clip("showcase-motion-source.mp4", "showcase motion source", "16:9"),
        models: ["kling/kling-3"],
        keys: ["fal"],
        estimate: { usd: null, basis: "price not published" },
        durationSec: 5,
      },
    ],
  };
}
