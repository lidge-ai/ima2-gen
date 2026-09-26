---
created: 2026-04-23
updated: 2026-09-22
tags: [ima2-gen, devlog, roadmap]
aliases: [ima2 active plan, image_gen current roadmap, ima2 개발계획]
---

# ima2-gen 현재 계획 허브

`_plan`은 앞으로 구현하거나 검증할 일이 남은 항목만 둔다. 구현 근거와
테스트가 확인된 항목은 `_fin`으로 이동한다. 완료 여부는 폴더 위치만이 아니라
현재 코드, 테스트, GitHub issue 상태, closeout 증거를 같이 본다.

## Naming Standard

`_plan/` 직속 active 폴더는 다음 두 패턴 중 하나를 따른다.

- `YYMMDD_issue<NN>-<kebab-slug>`: 단일 GitHub 이슈가 canonical scope일 때.
- `YYMMDD_<kebab-slug>`: 단일 이슈가 없는 연구, triage, 다중 이슈 map일 때.

Deferred / 미래 항목은 `_plan/` 직속이 아니라 `_plan/_future/`에 둔다.

## 현재 Active Lane

| 경로 | 상태 |
|---|---|
| `260926_pr325_merge_release/` | PR #325(desktop 통합 타이틀바) 리뷰·다듬기 → dev 스쿼시 머지 → post-merge CI → dev→main 프로모션 → v3.23.0 릴리스(npm/GitHub/desktop/pages). 000 로드맵, 010~030 단계 문서. |
| `260922_macos_arm64_release/` | 데스크톱 배포 1~4단계. Apple Silicon 전용 DMG/ZIP, fail-closed 서명·공증, packaged darwin/arm64 updater와 사용자 승인 설치, exact asset/checksum Draft 및 `desktop-production` 승인 후 공개 workflow를 구현. Environment 설정, 실제 tagged notarization과 두 버전 live update는 후속 범위. |
| `260917_issue_pr_triage_release/` | 2026-09-17 기준 열린 이슈/PR 전수 정리와 v3.16.1 릴리스. 이슈 #244(grok 서브커맨드 `--help` 부작용) 수정, dependabot #242/#243 판정, PR #229 판정, #150 재triage. 진행 문서는 000~050. |
| `260908_xai_imagine_spec_resync/` | v3.15.1로 배포 완료. xAI ref2v 상한 7->14, 모델별 ref2v 길이, 연장 1-15s, 이미지 편집 5장, 날짜 별칭, 오디오 단독 ref2v를 서버·UI·CLI·문서에 반영. GUI에 보이스 선택과 영상 편집 버튼 추가. 남은 것: 컴포저 드롭에서 편집으로 들어가는 흐름(결과 카드로 대체 가능). 배포 기록은 070_release_v3151.md. |

2026-09-17: `260909_grok_native_oauth/`는 v3.16.0 배포가 끝나 `_fin/`으로 옮겼다.

## 일정이 있는 후속 항목

| 항목 | 기한 | 내용 | 근거 |
|---|---|---|---|
| `grok-imagine-image-quality` 폐기 대응 | **2026-11-02** | 폐기 후 요청은 `grok-imagine-image-2.0` + `quality: low`로 서빙된다. `lib/grokImageAdapter.ts`가 세 곳에서 이 모델을 기본 폴백으로 쓴다. 지금 바꾸면 기존 결과물과 단가가 조용히 달라지므로 제품 결정이 필요하다. | `260908_xai_imagine_spec_resync/060_execution_outcome.md` |

## 열린 이슈

| 이슈 | 상태 | 사유 |
|---|---|---|
| #150 Provider Adapter v1 RFC | **OPEN** | 2026-09-17 재확인 (`main` `22e7c1ab`). 수용 조건 6개 중 1개 충족, 3개 부분, 2개 미충족. `ADAPTER_FACTORIES` 7/10 lane (api, grok-api, gemini-api, minimax, atlascloud, comfy, nai — oauth/grok/agy는 null), 어댑터 멤버 `generateImage`/`editImage`는 `adapters/types.ts:51-52` 선언만 있고 구현·호출 0건, `rg -c 'provider === ' ui/src/` 31파일 76줄, `packages/` 미존재. 8-31 이후 `lib/providers/` 12커밋 중 7개가 RFC 진척. 근거 코멘트를 이슈에 기록. |

## 외부 차단으로 미완료인 항목

여기 있는 것들은 코드를 더 써서 해결되지 않는다. 외부 승인이나 제공자 상태
회복이 선행 조건이다.

| 항목 | 사유 | 재개 조건 | 근거 문서 |
|---|---|---|---|
| MCP Tier 2 authenticated smoke | 실제 OAuth + 유료 `tools/call` + billing delta | 사용자 비용 승인 | `_fin/260715_subscription-mcp-providers/140_closeout.md` |
| MCP 100 provider expansion (Recraft, Magnific) | Tier 2 이후 순서 | Tier 2 완료 | 같은 문서 |
| Runway `edit_video` 라이브 full-flow | stage-2가 workspace limit 반환 | 제공자 한도 회복 | `_fin/260716_cli-entry-routing/070_closeout.md` |
| `bin/commands/editVideo.ts`, multishot CLI 플래그 | 라이브 검증 불가 상태에서 표면만 추가하면 확인 못 하는 코드가 남음 | 위와 동일 | 같은 문서 |
| Canvas provider-backed masked edit (#31) | 업스트림 마스크 계약 미검증. 추측 payload는 조용한 열화 위험 | 계약 문서화 또는 탐침 승인 | `_fin/260430_issue31-provider-masked-edit/` |

## Deferred (`_plan/_future/`)

| 유닛 | 사유 |
|---|---|
| `260715_icon_pipeline/` | 대응 GitHub 이슈 없음, 구현 0건 handoff |
| `260719_higgsfield-open-ledger.md` | 업스트림 이월 원장 |

이 둘은 숫자를 맞추려고 `_fin`으로 옮기지 않았다. 대응 이슈가 없고 구현 착수도
없어서, 옮기면 그건 정리가 아니라 은폐다.

## 2026-09-08 아카이브 기록

`_fin`으로 이동 (2개 유닛):

- `260908_post_314_cleanup/` — v3.15.0 (2026-09-08, `b96a11ed`)으로 완료. 리뷰 잔여물 정리(#221),
  dependabot 4건 머지 + main→dev 동기화(#223), #193 NAI 배터리 쿼타 레인(#224, 이슈 닫힘), #150
  어댑터 실행 훅(#225, 이슈는 잔여 2건으로 열어둠), dev→main 승격(#227), 릴리스·Pages·게시 아티팩트
  시각 검증. 영수증: `051_release_receipt.md`.
- `260905_production_readiness/` — v3.14.0 (2026-09-06, #219, `36aa6fce`)으로 완료.
  WP00–WP13 전부 닫힘: 프로바이더 실행 계약, 선택 일관성, 작업 수명주기, LAN 보안,
  진단, 설치기, 릴리스. 릴리스 후 확인된 잔여물은 `260908_post_314_cleanup/`이 맡는다.

## 2026-08-31 아카이브 기록

`_fin`으로 이동 (1개 유닛):

- `260831_dependabot_issue_triage/` — dependabot 4건 머지 + #150 유지 판정으로 완료.
  게이트 리터럴 SHA 재발(#162 -> #178)을 YAML AST 기반 핀 검사로 교체. 감사 6라운드.
  종료 시점에 열린 PR 0건, `origin/main` = `origin/dev` = `d950b605`, 릴리스 preflight 통과.

## 2026-08-26 아카이브 기록

`_fin`으로 이동 (17개 유닛):

- `260814_issue_pr_zeroing_release/` — v3.1.0으로 완료. 이슈/PR 제로화 + 릴리스
- `260814b_maturity_ops_measurement/` → `_fin/260814_maturity_ops_measurement/` — v3.2.0으로 완료. 성숙도 P0 실행
- `260815_home_hero_preset_removal/` — v3.3.0으로 완료. 홈 히어로 재구성 + 프리셋 제거
- `260815_open_issues_platform/` — v3.5.0으로 완료. 열린 이슈 6건 처분
- `260817_grok_video_planner_timeout/` — v3.6.0으로 완료. Grok 비디오 타임아웃 복원력
- `260818_platform_contracts_closeout/` — v3.6.0으로 완료. 플랫폼 계약 closeout
- `260819_kling_provider_feasibility/` — 조사 완료 (구현은 별도)
- `260819_log_detail_modal/` — v3.7.0으로 완료. 로그 상세 모달
- `260819c_grok_proxy_supervision/` → `_fin/260819_grok_proxy_supervision/` — superseded by 260909_grok_native_oauth (900_superseded.md)
- `260819b_release_speed/` → `_fin/260819_release_speed/` — v3.7.1로 완료. 릴리스 속도 69% 개선
- `260820_grok15_multi_reference_video/` — v3.8.0으로 완료. Grok 1.5 다중 참조 비디오
- `260821_260821d-release-train/` → `_fin/260821_release_train/` — v3.10.0으로 완료
- `260823_comfy_provider_lane/` — 완료. ComfyUI 프로바이더 레인 전체 구현
- `260823_minimax_h3/` — 완료. MiniMax H3 NVFP4 설치 + 실기 검증
- `260824_minimax_h3_pruned_nvfp4/` — 완료. lidge pruned NVFP4 + ima2 Comfy 비디오 연결
- `260825_comfy_video_provider_ux/` — 완료. Comfy 비디오 실행 + 12-lane provider UX
- `260825_issue_batch_170_173/` — 완료. 이슈 4건 수정 + PR 3건 처리
- `260825_novelai_negative_prompt_settings/` — 완료. NovelAI 네거티브 프롬프트 + 설정 패널

`260819c_grok_proxy_supervision/`은 WP2~WP4가 054c729f로 이미 구현되어 있었고("구현 미착수"는 오기), 260909_grok_native_oauth가 그 구현을 제거하여 `_fin/260819_grok_proxy_supervision/`으로 옮겼다(900_superseded.md).

## 이전 기록

2026-08-25까지의 아카이브 기록은 이전 버전 히스토리에 있다.
2026-07-25 archival sweep과 그 이전 이력은
`_fin/260725_devlog_archival/000_archival_record.md`에 있다.
