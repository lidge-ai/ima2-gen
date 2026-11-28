import { useEffect } from "react";
import type { CatalogModel, WorkflowShotsSpec } from "@ima2/studio-kit";
import { messages, useT } from "../../i18n.ts";
import { CameraMoveMenu } from "../../ui/CameraMoveMenu.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { SettingTile } from "../../ui/SettingTile.tsx";
import type { WorkflowForm } from "../workflow/useWorkflow.ts";
import { fitLength, MIN_SHOT_SEC, moved, newCut, shotLengths, totalSec, type Cut } from "./cutList.ts";

export const CM = messages(
  {
    list: "Shots", shot: "Shot {n}", placeholder: "What happens in this shot", length: "Length", lengthOf: "Shot {n} length", lengthSec: "Shot {n} length (seconds)", seconds: "{n} s",
    up: "Move shot {n} up", down: "Move shot {n} down", remove: "Remove shot {n}", add: "Add shot",
    sum: "{count} shots · {total} s of {max} s", full: "A cut list has at most {max} shots.",
    over: "The shots add up to {total} s. The most is {max} s; shorten or remove a shot.",
    lead: "Each shot is made as its own clip, in this order, and the clips are joined. A scene, if you write one, is added to every shot.",
    lengths: "{model} makes shots of {list} seconds.", anyLength: "Whole seconds, at least {min}. The longest one shot can be depends on the model.",
  },
  {
    list: "컷 목록", shot: "컷 {n}", placeholder: "이 컷에서 일어나는 일", length: "길이", lengthOf: "컷 {n} 길이", lengthSec: "컷 {n} 길이(초)", seconds: "{n}초",
    up: "컷 {n} 위로 옮기기", down: "컷 {n} 아래로 옮기기", remove: "컷 {n} 삭제", add: "컷 추가",
    sum: "컷 {count}개 · {max}초 중 {total}초", full: "컷은 최대 {max}개까지 넣을 수 있어요.",
    over: "컷 길이를 합치면 {total}초예요. 최대 {max}초라서 컷을 줄이거나 지워 주세요.",
    lead: "컷마다 영상을 따로 만들어 이 순서대로 이어 붙여요. 장면을 적으면 모든 컷에 함께 들어가요.",
    lengths: "{model} 모델은 한 컷을 {list}초 길이로 만들어요.", anyLength: "초 단위 정수로 {min}초 이상이에요. 한 컷의 최대 길이는 모델마다 달라요.",
  },
);

interface Props {
  form: WorkflowForm;
  spec: WorkflowShotsSpec;
  /** The model that renders the shots: it decides which lengths a shot can have. */
  model: CatalogModel | undefined;
}

function Length({ cut, index, listed, max, onChange }: { cut: Cut; index: number; listed: readonly number[] | null; max: number; onChange: (seconds: number) => void }) {
  const t = useT(CM);
  if (listed)
    return (
      <SettingTile
        caption={t("length")}
        accessibleLabel={t("lengthOf", { n: index + 1 }) + ": " + t("seconds", { n: cut.durationSec })}
        chipText={(label) => t("length") + ": " + label}
        variant="chip"
        menuPlacement="bottom"
        value={cut.durationSec}
        options={listed.map((seconds) => ({ value: seconds, label: t("seconds", { n: seconds }) }))}
        onChange={onChange}
      />
    );
  return (
    <label className="cut-seconds">
      <span>{t("length")}</span>
      <input
        type="number" inputMode="numeric" aria-label={t("lengthSec", { n: index + 1 })} min={MIN_SHOT_SEC} max={max} step={1} value={cut.durationSec}
        onChange={(e) => onChange(Math.max(1, Math.round(Number(e.target.value)) || 0))}
      />
    </label>
  );
}

/** The cut list: shots in order, each with its own prompt and length. Shown instead of one length for the whole clip. */
export function CutList({ form, spec, model }: Props) {
  const t = useT(CM);
  const { cuts, setCuts } = form;
  const listed = shotLengths(model);
  const key = listed?.join(",") ?? "";
  // A length the chosen model does not make moves to the nearest one it does, as the server would round it.
  useEffect(() => {
    setCuts((old) => (old.every((cut) => fitLength(cut.durationSec, listed) === cut.durationSec) ? old : old.map((cut) => ({ ...cut, durationSec: fitLength(cut.durationSec, listed) }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listed is rebuilt every render; key is its content
  }, [key, setCuts]);
  const patch = (id: number, change: Partial<Cut>) => setCuts((old) => old.map((cut) => (cut.id === id ? { ...cut, ...change } : cut)));
  const total = totalSec(cuts);
  return (
    <section className="cut-list" aria-label={t("list")}>
      <p className="form-hint">{t("lead")} {listed ? t("lengths", { model: model?.label ?? "", list: listed.join(", ") }) : t("anyLength", { min: MIN_SHOT_SEC })}</p>
      <ol>
        {cuts.map((cut, index) => (
          <li key={cut.id} className="cut">
            <div className="cut-head">
              <span className="cut-name">{t("shot", { n: index + 1 })}</span>
              <Length cut={cut} index={index} listed={listed} max={spec.maxTotalSec} onChange={(durationSec) => patch(cut.id, { durationSec })} />
              <span className="cut-tools">
                <button type="button" className="cut-tool cut-up" aria-label={t("up", { n: index + 1 })} disabled={index === 0} onClick={() => setCuts((old) => moved(old, index, -1))}>
                  <Icon name="chevron" size={16} />
                </button>
                <button type="button" className="cut-tool" aria-label={t("down", { n: index + 1 })} disabled={index === cuts.length - 1} onClick={() => setCuts((old) => moved(old, index, 1))}>
                  <Icon name="chevron" size={16} />
                </button>
                <button type="button" className="cut-tool" aria-label={t("remove", { n: index + 1 })} disabled={cuts.length <= spec.min} onClick={() => setCuts((old) => old.filter((entry) => entry.id !== cut.id))}>
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </div>
            <textarea
              id={"cut-" + cut.id} aria-label={t("shot", { n: index + 1 })} rows={2} maxLength={spec.promptMaxLength} placeholder={t("placeholder")}
              value={cut.prompt} onChange={(e) => patch(cut.id, { prompt: e.target.value })}
            />
            <div className="director-moves">
              <CameraMoveMenu value={cut.prompt} onChange={(prompt) => patch(cut.id, { prompt })} field={() => document.getElementById("cut-" + cut.id) as HTMLTextAreaElement | null} />
            </div>
          </li>
        ))}
      </ol>
      <div className="cut-foot">
        <button type="button" className="chip" disabled={cuts.length >= spec.max} onClick={() => setCuts((old) => [...old, newCut(fitLength(5, listed))])}>
          <Icon name="plus" size={13} /> {t("add")}
        </button>
        <span className="cut-sum" role="status">{t("sum", { count: cuts.length, total, max: spec.maxTotalSec })}</span>
      </div>
      {cuts.length >= spec.max ? <p className="form-hint">{t("full", { max: spec.max })}</p> : null}
      {total > spec.maxTotalSec ? <p className="form-error" role="alert">{t("over", { total, max: spec.maxTotalSec })}</p> : null}
    </section>
  );
}
