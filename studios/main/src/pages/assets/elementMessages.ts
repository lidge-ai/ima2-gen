import { messages } from "../../i18n.ts";

/** Words shared by every place elements show: the Assets tab, the picker in a form, and saving a result. */
export const EM = messages(
  {
    character: "Character", product: "Product", style: "Style", scene: "Scene",
    allKinds: "All", kinds: "Element kinds", kind: "Kind", name: "Name",
    lead: "Save a character, product, style or scene once and use it again as a reference in any form that takes one.",
    newTitle: "New element", image: "Image", choose: "Choose an image", change: "Choose another image", namePlaceholder: "e.g. Red ceramic mug",
    save: "Save element", saving: "Saving", needImage: "Choose an image.", needName: "Give it a name.",
    loading: "Loading elements", failed: "Could not load elements: {error}", retry: "Retry",
    actionFailed: "That did not work: {error}",
    empty: "No elements yet", emptyBody: "Add an image above, or open a result and choose Save as element.",
    emptyKind: "No elements of this kind yet.",
    list: "Elements", images: "{n} images", edit: "Edit", editing: "Edit {name}", done: "Save", cancel: "Cancel",
    remove: "Delete", confirmRemove: "Delete {name}?", confirm: "Delete it", keep: "Keep it",
    pick: "From elements", pickTitle: "Choose an element", pickLead: "Its images are added as references.", close: "Close",
    pickEmpty: "No elements yet. Make one in Assets, or save a result as an element.", openAssets: "Open elements",
    use: "Use {name}",
    saveAs: "Save as element", saved: "Saved to elements.", seeAll: "See elements",
  },
  {
    character: "인물", product: "제품", style: "스타일", scene: "장소",
    allKinds: "전체", kinds: "요소 종류", kind: "종류", name: "이름",
    lead: "인물, 제품, 스타일, 장소를 한 번 저장해 두면 레퍼런스를 받는 모든 폼에서 다시 쓸 수 있어요.",
    newTitle: "새 요소", image: "이미지", choose: "이미지 고르기", change: "다른 이미지 고르기", namePlaceholder: "예: 빨간 도자기 머그",
    save: "요소 저장", saving: "저장 중", needImage: "이미지를 골라 주세요.", needName: "이름을 적어 주세요.",
    loading: "요소를 불러오는 중이에요", failed: "요소를 불러오지 못했어요: {error}", retry: "다시 시도",
    actionFailed: "작업에 실패했어요: {error}",
    empty: "아직 요소가 없어요", emptyBody: "위에서 이미지를 추가하거나, 결과를 열어 요소로 저장을 눌러 주세요.",
    emptyKind: "이 종류의 요소가 아직 없어요.",
    list: "요소", images: "이미지 {n}장", edit: "수정", editing: "{name} 수정", done: "저장", cancel: "취소",
    remove: "삭제", confirmRemove: "{name} 요소를 삭제할까요?", confirm: "삭제", keep: "그대로 두기",
    pick: "요소에서 고르기", pickTitle: "요소 고르기", pickLead: "요소의 이미지가 레퍼런스로 추가돼요.", close: "닫기",
    pickEmpty: "아직 요소가 없어요. 에셋에서 만들거나 결과를 요소로 저장해 주세요.", openAssets: "요소 열기",
    use: "{name} 사용",
    saveAs: "요소로 저장", saved: "요소에 저장했어요.", seeAll: "요소 보기",
  },
);
