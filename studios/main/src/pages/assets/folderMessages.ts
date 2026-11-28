import { messages } from "../../i18n.ts";

/** Words shared by every place folders show: the Assets toolbar, the folder list, and a result's folder menu. */
export const FM = messages(
  {
    folder: "Folder", allFolders: "All results", none: "None", edit: "Edit folders…",
    title: "Folders", lead: "Group results. A result is in one folder at a time; deleting a folder keeps what was in it.",
    name: "Folder name", newName: "New folder name", namePlaceholder: "e.g. Spring campaign", create: "Create folder", creating: "Creating",
    empty: "No folders yet.", rename: "Rename", save: "Save", cancel: "Cancel", remove: "Delete",
    confirmRemove: "Delete the folder {name}? Its results stay in Assets.", confirm: "Delete folder", keep: "Keep it",
    close: "Close", loading: "Loading folders", failed: "Could not load folders: {error}", retry: "Retry", actionFailed: "That did not work: {error}",
    renaming: "Rename {name}", list: "Folder list",
    newFolder: "New folder…", createAndFile: "Create and move", moved: "Moved to {name}.", takenOut: "Taken out of its folder.",
    emptyFolder: "This folder is empty.", emptyFolderBody: "Open a result and choose a folder to put it here.", seeAll: "See all results",
  },
  {
    folder: "폴더", allFolders: "모든 결과", none: "없음", edit: "폴더 편집…",
    title: "폴더", lead: "결과를 묶어 두세요. 결과는 한 번에 한 폴더에만 들어가고, 폴더를 지워도 안에 있던 결과는 남아요.",
    name: "폴더 이름", newName: "새 폴더 이름", namePlaceholder: "예: 봄 캠페인", create: "폴더 만들기", creating: "만드는 중",
    empty: "아직 폴더가 없어요.", rename: "이름 바꾸기", save: "저장", cancel: "취소", remove: "삭제",
    confirmRemove: "{name} 폴더를 삭제할까요? 안의 결과는 에셋에 남아요.", confirm: "폴더 삭제", keep: "그대로 두기",
    close: "닫기", loading: "폴더를 불러오는 중이에요", failed: "폴더를 불러오지 못했어요: {error}", retry: "다시 시도", actionFailed: "작업에 실패했어요: {error}",
    renaming: "{name} 이름 바꾸기", list: "폴더 목록",
    newFolder: "새 폴더…", createAndFile: "만들고 옮기기", moved: "{name} 폴더로 옮겼어요.", takenOut: "폴더에서 뺐어요.",
    emptyFolder: "이 폴더는 비어 있어요.", emptyFolderBody: "결과를 열고 폴더를 골라 여기에 넣어 주세요.", seeAll: "모든 결과 보기",
  },
);
