const STEPS = [
  { title: "Add a frame", body: "Start from a prompt, or drop an image to use as the first frame." },
  { title: "Pick a preset", body: "Presets fill in camera moves and settings. You can edit everything they set." },
  { title: "Generate", body: "ima2 runs the model with your own key and saves the result to Assets." },
];

export function HowItWorks({ kind }: { kind: "image" | "video" }) {
  return (
    <section className="how" aria-label="How it works">
      <h1>{kind === "video" ? "Make a video from a frame or a sentence" : "Make an image from a sentence"}</h1>
      <p className="how-lead">
        Every model here runs on your own API key at the provider's price. Nothing is billed by ima2.
      </p>
      <ol className="how-steps">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="how-num" aria-hidden>
              {index + 1}
            </span>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
