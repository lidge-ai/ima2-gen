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
    "audio": "Make speech, music and sound",
    "audioStep1": "Pick what to make",
    "audioBody1": "A voice reading your text, music or a sound effect from a description, or sound made to fit a clip.",
    "audioStep2": "Write it",
    "audioBody2": "Type the script or describe the sound. For speech, choose a voice from the provider's own list.",
    "audioStep3": "Generate",
    "audioBody3": "ima2 runs the model with your own key and saves the result to Assets.",
    "edit": "Change, extend or sharpen a clip",
    "editStep1": "Pick a tool",
    "editBody1": "Change reworks the clip from a description, Extend continues it, Upscale makes it larger and sharper.",
    "editStep2": "Add the video",
    "editBody2": "Upload a clip, or send one over from a result. Each model shows only the settings it takes.",
    "editStep3": "Generate",
    "editBody3": "ima2 runs the model with your own key and saves the result to Assets.",
    "speak": "Make a face or a clip speak",
    "speakStep1": "Add the face",
    "speakBody1": "A photo with one clear face, or a video of the person speaking.",
    "speakStep2": "Add the audio",
    "speakBody2": "Upload the line to speak. The audio's length becomes the video's length, and the price follows it.",
    "speakStep3": "Generate",
    "speakBody3": "ima2 runs the model with your own key and saves the result to Assets.",
  },
  {
    "label": "사용 방법",
    "video": "프레임이나 문장으로 영상을 만들어요",
    "image": "문장으로 이미지를 만들어요",
    "lead": "모델은 내 API 키와 제공업체의 가격으로 사용해요. ima2가 따로 청구하지 않아요.",
    "step1": "프레임 추가",
    "body1": "프롬프트를 작성하거나 첫 프레임으로 사용할 이미지를 추가해 주세요.",
    "step2": "프리셋 선택",
    "body2": "프리셋이 카메라 움직임과 설정을 채워요. 모든 설정을 바꿀 수 있어요.",
    "step3": "생성",
    "body3": "ima2가 내 키로 모델을 사용하고 결과를 에셋에 저장해요.",
    "audio": "음성, 음악, 효과음을 만들어요",
    "audioStep1": "만들 것 고르기",
    "audioBody1": "내 글을 읽는 목소리, 설명으로 만드는 음악이나 효과음, 영상에 맞춘 소리 중에서 골라요.",
    "audioStep2": "내용 쓰기",
    "audioBody2": "대본을 쓰거나 소리를 설명해 주세요. 음성은 제공업체의 목소리 목록에서 목소리를 골라요.",
    "audioStep3": "생성",
    "audioBody3": "ima2가 내 키로 모델을 사용하고 결과를 에셋에 저장해요.",
    "edit": "영상을 바꾸거나, 늘리거나, 선명하게 만들어요",
    "editStep1": "도구 고르기",
    "editBody1": "바꾸기는 설명대로 영상을 다시 만들고, 연장은 뒤를 이어 만들고, 업스케일은 더 크고 선명하게 만들어요.",
    "editStep2": "영상 추가",
    "editBody2": "영상을 올리거나 결과에서 바로 보내 주세요. 모델마다 받을 수 있는 설정만 보여요.",
    "editStep3": "생성",
    "editBody3": "ima2가 내 키로 모델을 사용하고 결과를 에셋에 저장해요.",
    "speak": "얼굴이나 영상 속 인물이 말하게 해요",
    "speakStep1": "얼굴 추가",
    "speakBody1": "얼굴 하나가 또렷한 사진이나, 말하는 사람이 나오는 영상을 추가해 주세요.",
    "speakStep2": "오디오 추가",
    "speakBody2": "말할 내용을 담은 오디오를 추가해 주세요. 오디오 길이가 영상 길이가 되고, 가격도 길이에 따라 정해져요.",
    "speakStep3": "생성",
    "speakBody3": "ima2가 내 키로 모델을 사용하고 결과를 에셋에 저장해요.",
  },
);

const STEPS = {
  plain: [["step1", "body1"], ["step2", "body2"], ["step3", "body3"]],
  speak: [["speakStep1", "speakBody1"], ["speakStep2", "speakBody2"], ["speakStep3", "speakBody3"]],
  edit: [["editStep1", "editBody1"], ["editStep2", "editBody2"], ["editStep3", "editBody3"]],
  audio: [["audioStep1", "audioBody1"], ["audioStep2", "audioBody2"], ["audioStep3", "audioBody3"]],
} as const;

export function HowItWorks({ kind }: { kind: "image" | "video" | "speak" | "audio" | "edit" }) {
  const t = useT(M);
  return (
    <section className="how" aria-label={t("label")}>
      <h1>{t(kind)}</h1>
      <p className="how-lead">
        {t("lead")}
      </p>
      <ol className="how-steps">
        {STEPS[kind === "image" || kind === "video" ? "plain" : kind].map(([step, body], index) => (
          <li key={step}>
            <span className="how-num" aria-hidden>
              {index + 1}
            </span>
            <h2>{t(step)}</h2>
            <p>{t(body)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
