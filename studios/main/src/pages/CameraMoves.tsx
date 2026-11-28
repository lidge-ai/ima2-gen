import { useState } from "react";
import { MOVE_GROUPS, moveGroupLabel, searchMoves, type MoveGroup } from "../data/cameraMoves.ts";
import { messages, useT } from "../i18n.ts";
import { href } from "../router.ts";
import { Icon } from "../ui/Icon.tsx";

const M = messages(
  { lead: "Camera moves are sentences for your prompt. Using one adds it to what you have written in the video form; it changes no other setting. How closely a move is followed depends on the model.", search: "Search camera moves", none: "No camera move matches. Change the search.", use: "Use in a video", useNamed: "Use {name} in a video", list: "Camera moves", groups: "Kind of move", all: "All", adds: "Adds" },
  { lead: "카메라 무브는 프롬프트에 넣는 문장이에요. 사용하면 영상 폼에 써 둔 내용 뒤에 더해지고 다른 설정은 바꾸지 않아요. 얼마나 따르는지는 모델마다 달라요.", search: "카메라 무브 검색", none: "맞는 카메라 무브가 없어요. 검색어를 바꿔 주세요.", use: "영상에 쓰기", useNamed: "{name} 영상에 쓰기", list: "카메라 무브", groups: "무브 종류", all: "전체", adds: "넣는 문장" },
);

/** The camera moves as text cards, grouped and searchable. No sample clips: a card is the name and the sentence it adds. */
export function CameraMoves() {
  const t = useT(M);
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<MoveGroup | null>(null);
  const found = searchMoves(query).filter((move) => !only || move.group === only);
  return (
    <section className="moves" aria-label={t("list")}>
      <p className="moves-lead">{t("lead")}</p>
      <label className="search-field moves-search">
        <Icon name="search" size={15} />
        <input type="search" value={query} placeholder={t("search")} aria-label={t("search")} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="chip-row" role="group" aria-label={t("groups")}>
        <button type="button" className="chip" aria-pressed={only === null} onClick={() => setOnly(null)}>{t("all")}</button>
        {MOVE_GROUPS.map((group) => (
          <button key={group} type="button" className="chip" aria-pressed={only === group} onClick={() => setOnly(group)}>{moveGroupLabel(group)}</button>
        ))}
      </div>
      {found.length === 0 ? <p className="empty-line" role="status">{t("none")}</p> : null}
      {MOVE_GROUPS.filter((group) => found.some((move) => move.group === group)).map((group) => (
        <section key={group} className="moves-group" aria-label={moveGroupLabel(group)}>
          <h2>{moveGroupLabel(group)}</h2>
          <div className="moves-grid">
            {found.filter((move) => move.group === group).map((move) => (
              <article key={move.id} className="move-card" aria-label={move.label}>
                <h3>{move.label}</h3>
                {/* The English sentence is what goes into the prompt, so it is labelled as that. */}
                <p className="move-adds">{t("adds")}</p>
                <p className="move-phrase" lang="en">{move.phrase}.</p>
                <a className="btn" href={href("video", { move: move.id })} aria-label={t("useNamed", { name: move.label })}>{t("use")}</a>
              </article>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
