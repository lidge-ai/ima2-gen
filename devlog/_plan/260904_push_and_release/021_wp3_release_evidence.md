# wp3 — 푸시 + 배포 증거 (021)

## 최종 상태 — 모든 ref가 한 SHA를 공유

```
dev:     d2afe6b2aa7d006e2cd9765aa632714f96435db2
main:    d2afe6b2aa7d006e2cd9765aa632714f96435db2
preview: d2afe6b2aa7d006e2cd9765aa632714f96435db2
tag:     d2afe6b2aa7d006e2cd9765aa632714f96435db2  (v3.13.1)
npm gitHead: d2afe6b2aa7d006e2cd9765aa632714f96435db2
npm latest:  3.13.1
```

GitHub Release: https://github.com/lidge-ai/ima2-gen/releases/tag/v3.13.1

## 실행 순서 (실제로 한 것)

| # | 동작 | 결과 |
|---|---|---|
| 1 | `git push origin HEAD:refs/heads/dev` (force-with-lease로 이전 tip 고정) | 19a68d98..807b5ef0, fast-forward |
| 2 | push 트리거 CI 33884500477 | **success** (807b5ef0) |
| 3 | `git push origin 807b5ef0:refs/heads/main` (force-with-lease) | d39f9ea2..807b5ef0 |
| 4 | `gh workflow run release.yml --ref main -f bump=patch -f dry_run=false -f expected_sha=807b5ef0...` | run 33885127085 |
| 5 | 후보 CI 게이트 33885426518 | **success** |
| 6 | preview publish 33885929065 | **success**, npm preview 3.13.1-preview.260904.33885929065.1 |
| 7 | npm-stable 승인 #1 (tag 잡) | 승인 → 태그 v3.13.1 + main/dev 원자적 push |
| 8 | stable publish 33887515799 → npm-stable 승인 #2 | 승인 → **success** |
| 9 | release run 33885127085 | **success** |

강제 푸시 없음(두 push 모두 fast-forward를 force-with-lease로 보호). 히스토리 재작성 없음.

## 배포된 패키지 실물 검증

ref 조상 관계만으로는 "배포물에 수정이 들어갔다"를 증명하지 못한다. npm tarball을 실제로
받아서 풀었다.

```
npm pack ima2-gen@3.13.1
package/package.json version   -> 3.13.1
package/package.json overrides -> {"fast-uri":"3.1.7"}
```

번들된 UI에서 레인 게이트 리졸버를 확인:

```js
const Xv="comfy-video:",Wv="video:";
function QI(e){
  const{provider:a,imageModel:i,videoModel:o,comfyVideoWorkflow:l}=e;
  return a==="comfy" ? (l?`${Xv}${l}`:i)
       : (a==="grok"||a==="grok-api")&&o ? `${Wv}${o}` : i;
}
```

옛 코드였다면 provider 검사 없이 `comfyVideoWorkflow`를 먼저 반환했을 것이다.
배포된 번들은 게이트된 버전이다.

## 수락 기준 대조

| # | 기준 | 증거 |
|---|---|---|
| c-7 | audit 게이트 통과 + MCP 런타임 동작 | `no high+ vulnerabilities in root production dependencies`, ajv `$ref` 실행 검증, 배포 tarball에 3.1.7 핀 포함 |
| c-8 | action pin Windows 경로 | 25/25 통과, `path.win32` 재현. 네이티브 Windows는 릴리스 경로가 아니며(ci.yml:161-162) 다음 예약 실행이 증거 |
| c-9 | 후보 SHA exact-head CI | 33885426518 success. 릴리스 워크플로 자신이 이 게이트를 통과해야 진행됨 |
| c-10 | dev/main/preview/태그 동일 SHA | 위 표, 전부 d2afe6b2 |
| c-11 | npm latest + gitHead 일치 | latest 3.13.1, gitHead d2afe6b2 |
| c-12 | UI 수정 커밋이 릴리스 SHA의 조상 | 30190da8 OK, 684af450 OK, 807b5ef0 OK (`git merge-base --is-ancestor`) |

## 계획 대비 정정

계획 000은 Windows action pin 결함을 "릴리스를 막는다"고 적었으나 **틀렸다**.
`ci.yml:161-162`가 Windows 잡을 `schedule` 전용으로 제한하며, 주석이 그 의도를 명시한다
("never on push, and never on the workflow_dispatch that release.yml uses for its
candidate gate"). dev 푸시 후 실제 CI를 관찰하다 발견했다 — Windows 잡은 실패가 아니라
**skipped**였다. 012 문서에 기록했다.

실제 차단 요인은 fast-uri 하나였고, `verify:release`가 `audit:gate`를 포함하기 때문이다
(`package.json:39`). 릴리스 워크플로의 "Verify the release candidate before promoting it"
단계가 실제로 통과한 것이 그 증거다.

## 릴리스 종료 결과 (실행 완료 후 확정)

| 항목 | 값 |
|---|---|
| release run 33885127085 | **success** |
| preview publish 33885929065 | **success** |
| stable publish 33887515799 | **success** |
| 승인 게이트 | npm-stable **2회** — tag 잡, 그리고 stable publish 잡 |
| GitHub Release | v3.13.1, 2026-09-04T14:41:27Z |
| npm latest | 3.13.1 (gitHead d2afe6b2) |

승인이 두 번인 것은 워크플로 설계대로다. `release.yml:181-188` 주석이 tag 잡에 게이트를
두는 이유를 설명하고("a declined or ignored approval leaves main, dev, and the tag exactly
where they were"), `release.yml:236-239` 주석이 stable publish 잡도 환경 게이트라 대기가
두 번째 승인을 포함한다고 명시한다.

자동 생성된 릴리스 노트가 이번 전달 범위를 정확히 담았다:

```
### Fixes
- ci: clear the fast-uri advisory and the Windows action-pin sweep
- ui: name a model selection this lane no longer lists
- ui: stop a stranded comfy selection from blanking the model label
```

`CHANGELOG.md`는 3.0.0 이후 갱신이 중단된 상태라 이번 릴리스에서 건드리지 않았다.
릴리스 노트는 커밋에서 생성되므로 사용자에게 보이는 기록은 이미 정확하다.

## 남은 정직한 미검증

Windows 네이티브 filesystem/symlink 동작. `ci.yml:161-162`가 Windows 잡을 `schedule`
전용으로 두므로 이번 릴리스 경로에서는 실행되지 않았고, 다음 예약 실행(매일 03:17 UTC)이
증거를 준다. 릴리스를 막지 않는 항목이라 완료를 보류할 이유는 아니다.

