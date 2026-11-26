import { messages, useT } from "../../i18n.ts";


const M = messages(
  {
    "label": "How it works",
    "video": "Make a video from a frame or a sentence",
    "image": "Make an image from a sentence",
    "lead": "Every model here runs on your own API key at the provider's price. Nothing is billed by ima2.",
    "step1": "Add a frame",
    "body1": "Start from a prompt, or drop an image to use as the first frame.",
    "step2": "Pick a preset",
    "body2": "Presets fill in camera moves and settings. You can edit everything they set.",
    "step3": "Generate",
    "body3": "ima2 runs the model with your own key and saves the result to Assets.",
  },
  {
    "label": "사용 방법",
    "video": "프레임이나 문장으로 영상을 만들어요",
    "image": "문장으로 이미지를 만들어요",
    "lead": "모델은 내 API 키와 제공사의 가격으로 사용해요. ima2가 따로 청구하지 않아요.",
    "step1": "프레임 추가",
    "body1": "프롬프트를 작성하거나 첫 프레임으로 사용할 이미지를 추가해 주세요.",
    "step2": "프리셋 선택",
    "body2": "프리셋이 카메라 움직임과 설정을 채워요. 모든 설정을 바꿀 수 있어요.",
    "step3": "생성",
    "body3": "ima2가 내 키로 모델을 사용하고 결과를 에셋에 저장해요.",
  },
);

export function HowItWorks({ kind }: { kind: "image" | "video" }) {
  const t = useT(M);
  return (
    <section className="how" aria-label={t("label")}>
      <h1>{t(kind === "video" ? "video" : "image")}</h1>
      <p className="how-lead">
        {t("lead")}
      </p>
      <ol className="how-steps">
        {(["step1", "step2", "step3"] as const).map((step, index) => (
          <li key={step}>
            <span className="how-num" aria-hidden>
              {index + 1}
            </span>
            <h2>{t(step)}</h2>
            <p>{t((["body1", "body2", "body3"] as const)[index])}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
