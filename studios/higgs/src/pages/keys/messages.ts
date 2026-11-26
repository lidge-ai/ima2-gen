import { messages } from "../../i18n.ts";

export const M = messages(
  {
    title: "API keys", intro: "Add keys to use models from your providers.", search: "Search providers",
    noMatch: "No providers match your search.", clearSearch: "Clear search", direct: "Direct from the model maker", aggregators: "Aggregators",
    loadError: "Could not load providers: {error}", retry: "Retry", loading: "Loading providers",
    apiKey: "API key", enterKey: "Enter a key", showKey: "Show key for {provider}", hideKey: "Hide key for {provider}",
    show: "Show", hide: "Hide", required: " (required)", save: "Save", remove: "Remove",
    envHint: "Environment keys must be removed from the environment.", savedResult: "Saved. The provider accepted the key.",
    removedResult: "Key removed", fromEnv: "From environment", saved: "Saved", notSet: "Not set",
    oneModel: "{count} model", models: "{count} models", getKey: "Get a key", newTab: " (opens in a new tab)",
  },
  {
    title: "API 키", intro: "제공업체의 모델을 사용하려면 키를 추가하세요.", search: "제공업체 검색",
    noMatch: "검색 결과가 없어요.", clearSearch: "검색어 지우기", direct: "모델 제공업체", aggregators: "통합 제공업체",
    loadError: "제공업체를 불러오지 못했어요: {error}", retry: "다시 시도", loading: "제공업체를 불러오는 중이에요",
    apiKey: "API 키", enterKey: "키 입력", showKey: "{provider} 키 표시", hideKey: "{provider} 키 숨기기",
    show: "표시", hide: "숨기기", required: " (필수)", save: "저장", remove: "삭제",
    envHint: "환경 변수에 설정된 키는 환경에서 삭제해야 해요.", savedResult: "저장했어요. 제공업체가 키를 확인했어요.",
    removedResult: "키를 삭제했어요", fromEnv: "환경 변수", saved: "저장됨", notSet: "설정 안 됨",
    oneModel: "모델 {count}개", models: "모델 {count}개", getKey: "키 발급", newTab: " (새 탭에서 열림)",
  },
);
