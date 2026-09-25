import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { selectCurrentSessionId, useAppStore } from "../store/useAppStore";
import type { GenerateItem } from "../types";
import {
  getHistoryGrouped,
  getStorageStatus,
  openGeneratedDir,
  type StorageStatus,
} from "../lib/api";
import { dateBucket } from "../lib/galleryUtils";
import { getGalleryItemKey, isGalleryVisibleItem, uniqueGalleryItems } from "../lib/galleryNavigation";
import { useI18n } from "../i18n";
import { useModalFocus } from "../hooks/useModalFocus";
import { useCardNewsActions } from "./gallery/useCardNewsActions";
import { GalleryFilterTabs } from "./gallery/GalleryFilterTabs";
import { CardNewsGalleryTile } from "./CardNewsGalleryTile";
import { GalleryImageTile } from "./GalleryImageTile";
import { GalleryDateGrid } from "./gallery/GalleryDateGrid";
import { GalleryLoadControls } from "./gallery/GalleryLoadControls";
import { GallerySessionGroups, type GallerySessionGroup } from "./gallery/GallerySessionGroups";
import { GalleryStorageBar } from "./gallery/GalleryStorageBar";

const STORAGE_NOTICE_DISMISSED_KEY = "ima2.storageNoticeDismissed.0.09.23";

function useLazyGalleryTiles(root: HTMLDivElement | null) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const entered = entries.filter((entry) => entry.isIntersecting);
      if (entered.length === 0) return;
      setVisibleKeys((current) => {
        const next = new Set(current);
        for (const entry of entered) {
          const key = (entry.target as HTMLElement).dataset.galleryLazyKey;
          if (key) next.add(key);
        }
        return next;
      });
    }, { root, rootMargin: "200% 0px" });
    observerRef.current = observer;
    for (const node of nodesRef.current.values()) observer.observe(node);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [root]);

  const register = useCallback((key: string, node: HTMLElement | null) => {
    const previous = nodesRef.current.get(key);
    if (previous && previous !== node) observerRef.current?.unobserve(previous);
    if (node) {
      nodesRef.current.set(key, node);
      observerRef.current?.observe(node);
    } else {
      nodesRef.current.delete(key);
    }
  }, []);

  return { visibleKeys, register, supported: typeof IntersectionObserver !== "undefined" };
}

export function GalleryModal() {
  const { t, locale } = useI18n();
  const open = useAppStore((s) => s.galleryOpen);
  const close = useAppStore((s) => s.closeGallery);
  const history = useAppStore((s) => s.history);
  const selectHistory = useAppStore((s) => s.selectHistory);
  const currentImage = useAppStore((s) => s.currentImage);
  const trashHistoryItem = useAppStore((s) => s.trashHistoryItem);
  const showToast = useAppStore((s) => s.showToast);
  const toggleGalleryFavorite = useAppStore((s) => s.toggleGalleryFavorite);
  const galleryScope = useAppStore((s) => s.galleryScope);
  const setGalleryScope = useAppStore((s) => s.setGalleryScope);
  const historyNextCursor = useAppStore((s) => s.historyNextCursor);
  const historyLoadingOlder = useAppStore((s) => s.historyLoadingOlder);
  const favoriteHistoryNextCursor = useAppStore((s) => s.favoriteHistoryNextCursor);
  const favoriteHistoryLoadingOlder = useAppStore((s) => s.favoriteHistoryLoadingOlder);
  const loadOlderHistory = useAppStore((s) => s.loadOlderHistory);
  const loadFavoriteHistory = useAppStore((s) => s.loadFavoriteHistory);
  const loadOlderFavoriteHistory = useAppStore((s) => s.loadOlderFavoriteHistory);
  const currentSessionId = useAppStore(selectCurrentSessionId);

  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<"date" | "session">("date");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoritePending, setFavoritePending] = useState<Set<string>>(() => new Set());
  const favoritePendingRef = useRef(new Set<string>());
  const [sessionGroups, setSessionGroups] = useState<GallerySessionGroup[]>([]);
  const [loose, setLoose] = useState<GenerateItem[]>([]);
  const [sessionGroupsLoading, setSessionGroupsLoading] = useState(false);
  const [sessionGroupsError, setSessionGroupsError] = useState(false);
  const [sessionGroupsTruncated, setSessionGroupsTruncated] = useState(false);
  const [sessionGroupsRetry, setSessionGroupsRetry] = useState(0);
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);
  const [storageDismissed, setStorageDismissed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_NOTICE_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const scrollRef = useRef<HTMLDivElement | null>(null), itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const previousViewRef = useRef<{ open: boolean; selectedKey: string | null }>({
    open: false,
    selectedKey: null,
  });
  const galleryHistory = useMemo(() => uniqueGalleryItems(history.filter(isGalleryVisibleItem)), [history]);
  const setScrollNode = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollElement(node);
  }, []);
  const lazyTiles = useLazyGalleryTiles(scrollElement);

  // Escape, focus trapping and focus restore all live in useModalFocus; registering a
  // second Escape listener here would close the dialog twice.
  const dialogRef = useModalFocus<HTMLDivElement>(open, close);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await getStorageStatus();
        if (!cancelled) setStorageStatus(status);
      } catch {
        if (!cancelled) {
          setStorageStatus({
            generatedDirLabel: "~/.ima2/generated",
            generatedCount: 0,
            legacyCandidatesScanned: 0,
            legacySourcesFound: 0,
            legacyFilesFound: 0,
            state: "unknown",
            messageKind: "unknown",
            recoveryDocsPath: "docs/RECOVER_OLD_IMAGES.md",
            doctorCommand: "ima2 doctor",
            overrides: { generatedDir: false, configDir: false },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || groupBy !== "session") return;
    let cancelled = false;
    setSessionGroups([]);
    setLoose([]);
    setSessionGroupsLoading(true);
    setSessionGroupsError(false);
    setSessionGroupsTruncated(false);
    void (async () => {
      try {
        const page = await getHistoryGrouped({
          limit: 500,
          sessionId: galleryScope === "current-session" ? currentSessionId : undefined,
        });
        if (cancelled) return;
        setSessionGroupsTruncated(page.nextCursor !== null || page.total >= 500);
        const toItem = (h: (typeof page.loose)[number]): GenerateItem => {
          const k = h.kind;
          const narrowedKind: GenerateItem["kind"] =
            k === "classic" || k === "edit" || k === "generate" ||
            k === "card-news-card" || k === "card-news-set" ? k : null;
          const isVideo = h.mediaType === "video" || /\.(mp4|webm|mov)$/i.test(h.filename ?? "");
          return {
            image: h.url,
            url: h.url,
            filename: h.filename,
            thumb: h.thumb ?? (isVideo ? undefined : h.url),
            mediaType: h.mediaType,
            video: h.video ?? null,
            videoSeries: h.videoSeries ?? null,
            videoContinuity: h.videoContinuity ?? null,
            prompt: h.prompt ?? undefined,
            userPrompt: h.userPrompt ?? null,
            revisedPrompt: h.revisedPrompt ?? null,
            promptMode: h.promptMode ?? null,
            composerPrompt: h.composerPrompt ?? null,
            composerInsertedPrompts: h.composerInsertedPrompts ?? null,
            size: h.size ?? undefined,
            quality: h.quality ?? undefined,
            format: h.format,
            moderation: h.moderation ?? undefined,
            model: h.model ?? undefined,
            reasoningEffort: h.reasoningEffort as GenerateItem["reasoningEffort"],
            provider: h.provider,
            providerUrl: h.providerUrl ?? null,
            usage: h.usage as GenerateItem["usage"],
            elapsed: h.elapsed ?? undefined,
            createdAt: h.createdAt,
            sessionId: h.sessionId ?? null,
            nodeId: h.nodeId ?? null,
            parentNodeId: h.parentNodeId ?? null,
            clientNodeId: h.clientNodeId ?? null,
            requestId: h.requestId ?? null,
            kind: narrowedKind,
            setId: h.setId ?? null,
            cardId: h.cardId ?? null,
            cardOrder: h.cardOrder ?? null,
            headline: h.headline ?? null,
            body: h.body ?? null,
            cards: h.cards,
            refsCount: h.refsCount ?? 0,
            webSearchCalls: h.webSearchCalls ?? 0,
            sequenceId: h.sequenceId ?? null,
            sequenceIndex: h.sequenceIndex ?? null,
            sequenceTotalRequested: h.sequenceTotalRequested ?? null,
            sequenceTotalReturned: h.sequenceTotalReturned ?? null,
            sequenceStatus: h.sequenceStatus ?? null,
            isFavorite: h.isFavorite ?? false,
          };
        };
        setSessionGroups(
          page.sessions.map((s) => ({
            sessionId: s.sessionId,
            title: s.title ?? null,
            label: s.label ?? null,
            displayLabel: s.title || s.label || s.sessionId.slice(0, 8),
            items: uniqueGalleryItems(s.items.filter(isGalleryVisibleItem).map(toItem)),
          })).filter((group) => group.items.length > 0),
        );
        setLoose(uniqueGalleryItems(page.loose.filter(isGalleryVisibleItem).map(toItem)));
      } catch {
        if (!cancelled) setSessionGroupsError(true);
      } finally {
        if (!cancelled) setSessionGroupsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, groupBy, galleryScope, currentSessionId, sessionGroupsRetry]);

  useEffect(() => {
    if (!open || groupBy === "session" || !favoritesOnly) return;
    void loadFavoriteHistory();
  }, [open, groupBy, favoritesOnly, loadFavoriteHistory]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().normalize("NFC");
    return galleryHistory.filter((h) => {
      if (favoritesOnly && !h.isFavorite) return false;
      if (!q) return true;
      return (
        (h.prompt ?? "").toLowerCase().normalize("NFC").includes(q) ||
        (h.filename ?? "").toLowerCase().normalize("NFC").includes(q)
      );
    });
  }, [galleryHistory, query, favoritesOnly]);

  const visibleSessionGroups = useMemo(() => {
    if (!favoritesOnly) return sessionGroups;
    return sessionGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.isFavorite),
      }))
      .filter((group) => group.items.length > 0);
  }, [sessionGroups, favoritesOnly]);

  const visibleLoose = useMemo(() => {
    if (!favoritesOnly) return loose;
    return loose.filter((item) => item.isFavorite);
  }, [loose, favoritesOnly]);

  const dateGroups = useMemo(() => {
    const map = new Map<string, GenerateItem[]>();
    for (const item of filtered) {
      const key = dateBucket(item.createdAt, locale);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [filtered, locale]);
  const totalVisible = groupBy === "session"
    ? visibleSessionGroups.reduce((a, g) => a + g.items.length, 0) + visibleLoose.length
    : filtered.length;

  useLayoutEffect(() => {
    const selectedKey = currentImage ? getGalleryItemKey(currentImage) : null;
    if (!open) {
      previousViewRef.current = { open: false, selectedKey };
      return;
    }
    const previous = previousViewRef.current;
    const shouldCenterSelected = !previous.open || previous.selectedKey !== selectedKey;
    previousViewRef.current = { open: true, selectedKey };
    const selectedEl = selectedKey ? itemRefs.current[selectedKey] : null;
    if (shouldCenterSelected && selectedEl) {
      selectedEl.scrollIntoView({ block: "center" });
      return;
    }
    if (scrollRef.current) scrollRef.current.scrollTop = lastScrollTopRef.current;
  }, [open, currentImage?.filename, currentImage?.image, groupBy, totalVisible, dateGroups.length, visibleSessionGroups.length, visibleLoose.length]);

  async function handleDelete(item: GenerateItem, e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const deletedKey = getGalleryItemKey(item);
    await trashHistoryItem(item);
    delete itemRefs.current[deletedKey];
    window.requestAnimationFrame(() => scrollRef.current?.focus());
  }

  async function handleToggleFavorite(item: GenerateItem): Promise<void> {
    const filename = item.filename;
    if (!filename || favoritePendingRef.current.has(filename)) return;
    favoritePendingRef.current.add(filename);
    setFavoritePending(new Set(favoritePendingRef.current));
    try {
      const isFavorite = await toggleGalleryFavorite(item);
      if (isFavorite === null) return;
      setSessionGroups((groups) => groups.map((group) => ({
        ...group,
        items: group.items.map((entry) => entry.filename === filename
          ? { ...entry, isFavorite }
          : entry),
      })));
      setLoose((items) => items.map((entry) => entry.filename === filename
        ? { ...entry, isFavorite }
        : entry));
    } finally {
      favoritePendingRef.current.delete(filename);
      setFavoritePending(new Set(favoritePendingRef.current));
    }
  }

  async function handleOpenGeneratedDir() {
    try {
      await openGeneratedDir();
      showToast(t("toast.openGeneratedDirOpened"));
    } catch { showToast(t("toast.openGeneratedDirFailed"), true); }
  }

  const { handleOpenCardNewsSet, handleCopyCardNewsSetPath, handleDownloadCardNewsManifest } =
    useCardNewsActions(close, showToast, t);

  function dismissStorageNotice() {
    setStorageDismissed(true);
    try {
      localStorage.setItem(STORAGE_NOTICE_DISMISSED_KEY, "1");
    } catch {
      // Storage-disabled browsers can still hide it for the current session.
    }
  }

  if (!open) return null;

  const localizeBucket = (key: string): string => {
    if (key === "earlier" || key === "today" || key === "yesterday" || key === "thisWeek") {
      return t(`gallery.${key}`);
    }
    return key;
  };

  const renderTile = (item: GenerateItem, keyPrefix: string, _idx: number) => {
    const active = currentImage?.image === item.image;
    const itemKey = getGalleryItemKey(item);
    const setItemRef = (node: HTMLElement | null) => {
      itemRefs.current[itemKey] = node;
      lazyTiles.register(itemKey, node);
    };
    const shouldRender = lazyTiles.supported ? lazyTiles.visibleKeys.has(itemKey) : true;
    if (!shouldRender) {
      return (
        <div
          ref={setItemRef}
          key={`${keyPrefix}-${itemKey}`}
          className="gallery__tile-wrap"
          data-gallery-lazy-key={itemKey}
          style={{ aspectRatio: "1 / 1" }}
          aria-hidden="true"
        />
      );
    }
    if (item.kind === "card-news-set") {
      return (
        <div
          ref={setItemRef}
          key={`${keyPrefix}-${itemKey}`}
          className="gallery__tile-wrap gallery-card-news-set"
        >
          <CardNewsGalleryTile
            item={item}
            onOpen={(next) => void handleOpenCardNewsSet(next)}
            onCopyPath={handleCopyCardNewsSetPath}
            onDownloadManifest={handleDownloadCardNewsManifest}
          />
        </div>
      );
    }
    return (
      <GalleryImageTile
        key={`${keyPrefix}-${itemKey}`}
        item={item}
        active={active}
        itemRef={setItemRef}
        onSelect={(next) => {
          selectHistory(next);
          close();
        }}
        onDelete={handleDelete}
        onToggleFavorite={handleToggleFavorite}
        favoriteBusy={Boolean(item.filename && favoritePending.has(item.filename))}
        t={t}
      />
    );
  };

  const showSessions = groupBy === "session";
  const selectedKey = currentImage ? getGalleryItemKey(currentImage) : null;
  return (
    <div className="gallery-backdrop" onClick={close} role="presentation">
      <div
        ref={dialogRef}
        className="gallery"
        role="dialog"
        aria-modal="true"
        aria-label={t("gallery.ariaLabel")}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gallery__header">
          <div className="gallery__title-row">
            <div className="gallery__title">{t("gallery.title")}</div>
            <div className="gallery__meta">
              {t("gallery.total", { n: totalVisible })}
              {query || favoritesOnly ? t("gallery.totalFiltered", { n: galleryHistory.length }) : ""}
            </div>
            <GalleryFilterTabs
              className="gallery__favorite-filter"
              ariaLabel={t("gallery.favoriteFilterAria")}
              value={favoritesOnly ? "favorites" : "all"}
              onChange={(next) => setFavoritesOnly(next === "favorites")}
              tabs={[
                { value: "all", label: t("gallery.filterAll") },
                { value: "favorites", label: t("gallery.filterFavorites") },
              ]}
            />
            <GalleryFilterTabs
              className="gallery__group-toggle"
              ariaLabel={t("gallery.sortByAria")}
              value={groupBy}
              onChange={setGroupBy}
              tabs={[
                { value: "date", label: t("gallery.sortByDate") },
                { value: "session", label: t("gallery.sortBySession") },
              ]}
            />
            <GalleryFilterTabs
              className="gallery__scope"
              ariaLabel={t("gallery.scopeAria")}
              value={galleryScope}
              onChange={setGalleryScope}
              tabs={[
                { value: "current-session", label: t("gallery.scope.current"), disabled: !currentSessionId },
                { value: "all", label: t("gallery.scope.all") },
              ]}
            />
          </div>
          <input
            type="text"
            className="gallery__search"
            {...(showSessions ? {} : { "data-modal-initial-focus": true })}
            placeholder={showSessions ? t("gallery.searchDisabledPlaceholder") : t("gallery.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={showSessions}
          />
          <button
            type="button"
            className="gallery__close"
            onClick={close}
            aria-label={t("gallery.closeAria")}
            title={t("gallery.closeTitle")}
          >
            ×
          </button>
        </div>

        <GalleryStorageBar
          status={storageStatus}
          dismissed={storageDismissed}
          onOpenFolder={handleOpenGeneratedDir}
          onDismiss={dismissStorageNotice}
          t={t}
        />

        <div
          className="gallery__scroll"
          ref={setScrollNode}
          tabIndex={-1}
          onScroll={() => {
            lastScrollTopRef.current = scrollRef.current?.scrollTop ?? 0;
          }}
        >
          {showSessions ? (
            sessionGroupsLoading ? (
              <div className="gallery__empty" role="status" aria-live="polite">
                {t("gallery.sessionLoading")}
              </div>
            ) : sessionGroupsError ? (
              <div className="gallery__empty" role="alert">
                <span>{t("gallery.sessionLoadFailed")}</span>
                <button type="button" onClick={() => setSessionGroupsRetry((value) => value + 1)}>
                  {t("gallery.retry")}
                </button>
              </div>
            ) : <>
              {sessionGroupsTruncated ? (
                <div className="gallery__limit-notice" role="status">
                  {t("gallery.sessionLimitNotice", { count: 500 })}
                </div>
              ) : null}
              <GallerySessionGroups
                groups={visibleSessionGroups}
                loose={visibleLoose}
                favoritesOnly={favoritesOnly}
                galleryScope={galleryScope}
                setGalleryScope={setGalleryScope}
                renderTile={renderTile}
                t={t}
              />
              <GalleryLoadControls
                showSessions={showSessions}
                favoritesOnly={favoritesOnly}
                query={query}
                historyNextCursor={historyNextCursor}
                favoriteHistoryNextCursor={favoriteHistoryNextCursor}
                historyLoadingOlder={historyLoadingOlder}
                favoriteHistoryLoadingOlder={favoriteHistoryLoadingOlder}
                onLoadOlder={() => void loadOlderHistory()}
                onLoadOlderFavorites={() => void loadOlderFavoriteHistory()}
                t={t}
              />
            </>
          ) : filtered.length === 0 ? (
            <div className="gallery__empty">
              {galleryHistory.length === 0
                ? t("gallery.emptyAll")
                : favoritesOnly
                  ? t("gallery.emptyFavorites")
                : t("gallery.noResults")}
            </div>
          ) : (
            <>
              <GalleryDateGrid
                dateGroups={dateGroups}
                selectedKey={selectedKey}
                scrollElement={scrollElement}
                localizeBucket={localizeBucket}
                renderTile={renderTile}
              />
              <GalleryLoadControls
                showSessions={showSessions}
                favoritesOnly={favoritesOnly}
                query={query}
                historyNextCursor={historyNextCursor}
                favoriteHistoryNextCursor={favoriteHistoryNextCursor}
                historyLoadingOlder={historyLoadingOlder}
                favoriteHistoryLoadingOlder={favoriteHistoryLoadingOlder}
                onLoadOlder={() => void loadOlderHistory()}
                onLoadOlderFavorites={() => void loadOlderFavoriteHistory()}
                t={t}
              />
            </>
          )}
        </div>

      </div>
    </div>
  );
}
