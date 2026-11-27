import { useState } from "react";
import { useI18n } from "../../i18n";
import { getGalleryItemKey } from "../../lib/galleryNavigation";
import { isAudioItem } from "../../lib/audioMedia";
import { useAppStore } from "../../store/useAppStore";
import type { GenerateItem } from "../../types";

const VIDEO_EXTENSION = /\.(mp4|webm|mov)(?:$|[?#])/i;

function recentMediaSource(item: GenerateItem): string | undefined {
  const isVideo = item.mediaType === "video"
    || VIDEO_EXTENSION.test(item.filename ?? "")
    || VIDEO_EXTENSION.test(item.url ?? item.image);
  if (isVideo) return item.thumb;
  return item.thumb || item.url || item.image || undefined;
}

function RecentMedia({ item, featured }: { item: GenerateItem; featured: boolean }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const source = recentMediaSource(item);
  const prompt = (
    item.userPrompt?.trim()
    || item.prompt?.trim()
    || t("home.untitledResult")
  ).slice(0, 60);
  const alt = t("home.recentResultAlt", { prompt });

  if (isAudioItem(item)) {
    return <div className="home-recent-card__fallback home-recent-card__fallback--audio" role="img" aria-label={alt}><span aria-hidden="true">♪</span>{prompt}</div>;
  }
  if (!source || failed) {
    return (
      <div className="home-recent-card__fallback" role="img" aria-label={alt}>
        {t("home.mediaUnavailable")}
      </div>
    );
  }

  return (
    <img
      src={source}
      alt={alt}
      loading={featured ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function HomeRecentRow() {
  const history = useAppStore((state) => state.history);
  const { t } = useI18n();
  const recent = history.slice(0, 5);

  if (recent.length === 0) {
    return <p className="home-recent-empty" role="status">{t("history.emptyRecent")}</p>;
  }

  return (
    <div className="home-recent-row" role="list" aria-label={t("home.recentTitle")}>
      {recent.map((item, index) => {
        const featured = index === 0;
        return (
          <figure
            key={getGalleryItemKey(item)}
            className={`home-recent-card${featured ? " is-featured" : ""}`}
            role="listitem"
          >
            <RecentMedia item={item} featured={featured} />
          </figure>
        );
      })}
    </div>
  );
}
