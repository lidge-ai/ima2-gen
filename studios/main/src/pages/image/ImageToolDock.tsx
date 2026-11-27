import { useRef, useState, type ReactNode } from "react";
import type { Catalog, ImageTask } from "@ima2/studio-kit";
import { messages, useT } from "../../i18n.ts";
import { useStudioApi } from "../../studio/context.tsx";
import { routePrice } from "../../ui/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { KeyNotice } from "../../ui/KeyNotice.tsx";
import { ModelPicker } from "../../ui/ModelPicker.tsx";
import { SettingTile } from "../../ui/SettingTile.tsx";
import type { SlotValue } from "../../ui/UploadSlot.tsx";
import { Count } from "../create/ImageDock.tsx";
import { resolutionLabel } from "../create/ParamControls.tsx";
import { modelsFor, takes } from "./imageState.ts";
import type { useImageTool } from "./useImageTool.ts";

const M = messages(
  {
    title: "Image tool",
    "image-to-imageHelp": "Describe a change. Add more images for the model to draw from.",
    "image-upscaleHelp": "The same image, larger and sharper.",
    "image-vectorizeHelp": "The image redrawn as an SVG.",
    "image-segmentHelp": "The image split into separate layers or cut-outs.",
    "image-to-imagePrompt": "Describe the change", "image-upscalePrompt": "Describe what to keep or sharpen",
    "image-vectorizePrompt": "Describe the drawing", "image-segmentPrompt": "Name what to separate",
    prompt: "Prompt", images: "Images", add: "Add an image", file: "Image file", remove: "Remove {name}", full: "This model takes no more images here",
    count: "{n} of {max}", resolution: "Size", aspect: "Aspect ratio", quality: "Quality",
    route: "Run through", automatic: "Automatic", direct: "direct", aggregator: "aggregator", local: "this computer, no provider charge", noKey: "no key", via: "via {label}",
    generate: "Generate", sending: "Sending", nokey: "Add a key to generate.", uploadError: "Upload failed. Try again.",
    notHere: "{model} has no route this tool can run yet, so another model is selected.",
  },
  {
    title: "이미지 도구",
    "image-to-imageHelp": "바꿀 내용을 적어 주세요. 참고할 이미지를 더 넣을 수 있어요.",
    "image-upscaleHelp": "같은 이미지를 더 크고 선명하게 만들어요.",
    "image-vectorizeHelp": "이미지를 SVG로 다시 그려요.",
    "image-segmentHelp": "이미지를 레이어나 조각으로 나눠요.",
    "image-to-imagePrompt": "바꾸고 싶은 내용을 적어 주세요", "image-upscalePrompt": "살리거나 선명하게 할 부분을 적어 주세요",
    "image-vectorizePrompt": "그림을 설명해 주세요", "image-segmentPrompt": "나눌 대상을 적어 주세요",
    prompt: "프롬프트", images: "이미지", add: "이미지 추가", file: "이미지 파일", remove: "{name} 삭제", full: "이 모델은 여기서 이미지를 더 받지 않아요",
    count: "{n}/{max}", resolution: "크기", aspect: "화면 비율", quality: "품질",
    route: "실행 경로", automatic: "자동", direct: "직접", aggregator: "어그리게이터", local: "이 컴퓨터에서 실행, 요금 없음", noKey: "키 없음", via: "{label} 경유",
    generate: "생성", sending: "요청 중", nokey: "생성하려면 키를 추가해 주세요.", uploadError: "업로드하지 못했어요. 다시 시도해 주세요.",
    notHere: "{model} 모델은 아직 이 도구로 실행할 수 있는 경로가 없어 다른 모델을 골랐어요.",
  },
);

type Tool = ReturnType<typeof useImageTool>;

/** The images the tool works on: thumbnails with a remove button each, and an add button until the route's limit. */
function Tray({ tool, max }: { tool: Tool; max: number }) {
  const t = useT(M);
  const studio = useStudioApi();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { images } = tool.state;
  const full = images.length >= max;
  const take = async (files: readonly File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setFailed(false);
    try {
      const added: SlotValue[] = [];
      for (const file of files) added.push({ role: "source-image", upload: await studio.upload(file), name: file.name });
      tool.addImages(added);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dock-tray" role="group" aria-label={t("images")}>
      {images.map((image) => (
        <span key={image.upload.inputId} className="dock-attachment">
          <img src={image.upload.url} alt={image.name} />
          <button type="button" aria-label={t("remove", { name: image.name })} onClick={() => tool.removeImage(image.upload.inputId)}>
            <Icon name="close" size={12} />
          </button>
        </span>
      ))}
      <button type="button" className="dock-icon" aria-label={t("add")} disabled={full || busy} title={full ? t("full") : t("add")} onClick={() => input.current?.click()}>
        <Icon name={busy ? "clock" : "plus"} size={16} />
      </button>
      <span className="dock-tray-count" aria-live="polite">{t("count", { n: images.length, max })}</span>
      {failed ? <span className="form-error" role="alert">{t("uploadError")}</span> : null}
      <input
        ref={input} type="file" accept="image/*" multiple={max > 1} hidden aria-label={t("file")}
        onChange={(e) => { void take([...(e.target.files ?? [])]); e.target.value = ""; }}
      />
    </div>
  );
}

function Settings({ catalog, tool }: { catalog: Catalog; tool: Tool }) {
  const t = useT(M);
  const { state, form } = tool;
  const routes = tool.routes.map((route) => ({
    value: route.providerId, label: route.label,
    meta: route.route === "local" ? t("local") : [t(route.route), routePrice(route), ...(route.keyConfigured ? [] : [t("noKey")])].join(" · "),
  }));
  return (
    <div className="dock-chips">
      <ModelPicker variant="chip" models={modelsFor(catalog, state.tool)} kind="image" tasks={[state.tool]} value={state.model} onChange={tool.pickModel} />
      {form && form.resolutions.length > 0 && state.resolution ? (
        <SettingTile variant="chip" icon="layers" caption={t("resolution")} value={state.resolution}
          options={form.resolutions.map((value) => ({ value, label: resolutionLabel(value) }))} onChange={(resolution) => tool.set({ resolution })} />
      ) : null}
      {form && form.aspectRatios.length > 0 && state.aspectRatio ? (
        <SettingTile variant="chip" icon="ratio" caption={t("aspect")} value={state.aspectRatio}
          options={form.aspectRatios.map((value) => ({ value, label: value }))} onChange={(aspectRatio) => tool.set({ aspectRatio })} />
      ) : null}
      {form && form.qualities.length > 0 && state.quality ? (
        <SettingTile variant="chip" caption={t("quality")} value={state.quality}
          options={form.qualities.map((value) => ({ value, label: value }))} onChange={(quality) => tool.set({ quality })} />
      ) : null}
      {routes.length > 1 ? (
        <SettingTile variant="chip" caption={t("route")} chipText={(label) => t("via", { label })} value={state.provider}
          options={[{ value: "", label: t("automatic") }, ...routes]} onChange={tool.pickRoute} />
      ) : null}
      {form && takes(form, "count") ? <Count value={state.count} onChange={(count) => tool.set({ count })} /> : null}
    </div>
  );
}

interface Props {
  catalog: Catalog;
  tool: Tool;
  /** The tool tabs, shared with the create form. */
  tabs: ReactNode;
  /** A model opened by its link that this tool cannot run. */
  unrunnable?: string | undefined;
  notice?: string | undefined;
}

/** The dock for a tool that works on images: its images, a prompt when the route takes one, and only the settings the route takes. */
export function ImageToolDock({ catalog, tool, tabs, unrunnable, notice }: Props) {
  const t = useT(M);
  const { state, form, choice } = tool;
  const task: ImageTask = state.tool;
  const hint = tool.blocked ?? (choice.kind === "needs-key" ? t("nokey") : null);
  return (
    <form className="dock" aria-label={t("title")} onSubmit={(e) => { e.preventDefault(); void tool.submit(); }}>
      {choice.kind === "needs-key" ? <KeyNotice routes={choice.candidates} providers={catalog.providers} /> : null}
      {tool.error ? <p className="form-error" role="alert">{tool.error}</p> : null}
      {notice ? <p className="form-error" role="alert">{notice}</p> : null}
      {unrunnable ? <p className="form-hint" role="status">{t("notHere", { model: unrunnable })}</p> : null}
      {!tool.canSend && !tool.sending && hint ? <p className="form-hint">{hint}</p> : null}
      {tabs}
      <div className="dock-main">
        <div className="dock-fields">
          <p className="dock-help">{t((task + "Help") as "image-upscaleHelp")}</p>
          <Tray tool={tool} max={form?.max ?? 1} />
          {form && takes(form, "prompt") ? (
            <>
              <label className="visually-hidden" htmlFor="image-tool-prompt">{t("prompt")}</label>
              <textarea
                id="image-tool-prompt" rows={2} value={state.prompt} placeholder={t((task + "Prompt") as "image-upscalePrompt")}
                onChange={(e) => tool.set({ prompt: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit(); }}
              />
            </>
          ) : null}
          <Settings catalog={catalog} tool={tool} />
        </div>
        <button className="btn btn-primary dock-generate" type="submit" disabled={!tool.canSend} title={tool.blocked ?? undefined}>
          <span>{tool.sending ? t("sending") : t("generate")}</span>
          <span className="btn-cost" title={tool.cost.title || undefined}>{tool.cost.text}</span>
        </button>
      </div>
    </form>
  );
}
