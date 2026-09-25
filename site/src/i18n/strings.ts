export type Lang = 'en' | 'ko';

type Dict = Record<string, string>;

const en: Dict = {
  // Base / meta
  'meta.title': 'ima2-gen — Local AI Studio for Image + Video Generation',
  'meta.desc':
    'Generate images and videos locally with Classic, Node, Canvas, Grok Video, and GPT OAuth/API providers. No API key required.',
  'meta.og.title': 'ima2-gen — Generate, branch, animate',
  'meta.og.desc':
    'A local AI studio with image generation, Grok Video, Node-graph branching, and Canvas Mode. Install with npm or the desktop app for macOS, Windows and Linux.',

  // Header
  'header.brand.aria': 'ima2-gen home',
  'header.nav.aria': 'Section navigation',
  'header.nav.workflows': 'Workflows',
  'header.nav.branch': 'Branch',
  'header.nav.local': 'Local',
  'header.nav.install': 'Install',
  'header.nav.faq': 'FAQ',
  'header.nav.docs': 'Docs',
  'header.gh': 'GitHub ↗',

  // Hero
  'hero.eyebrow': 'Local AI studio · Image + Video',
  'hero.h1.line1': 'Branch the',
  'hero.h1.line2': 'images you',
  'hero.h1.em': 'love.',
  'hero.sub':
    "An AI studio for the way you actually iterate. Generate images in Classic, fan out in Node, create videos with Grok, and clean up in Canvas. Free ChatGPT + SuperGrok is all you need.",
  'hero.cta.cmd': 'npm install -g ima2-gen && ima2 serve',
  'hero.cross.lang': '한국어 README →',
  'hero.shot.alt':
    'ima2-gen video playback with gallery sidebar showing generated images and videos.',

  // Two Workflows
  'workflows.tag': '01 · Generate, branch, refine',
  'workflows.h.before': 'Two ways to make. ',
  'workflows.h.em': 'Canvas to refine.',
  'workflows.lede':
    "Classic for one strong frame or a multimode batch. Node for a tree of variations from a parent you locked in. Canvas for cleanup before the next prompt.",
  'workflows.classic.label': 'Classic',
  'workflows.classic.h': 'One prompt, one strong frame.',
  'workflows.classic.body':
    'Write, attach up to five references, generate one result or several multimode slots. Iterate until it lands. Continue from any result.',
  'workflows.classic.alt':
    'ima2-gen Classic mode with prompt composer, references, and a generated team portrait.',
  'workflows.node.label': 'Node',
  'workflows.node.h': 'One frame, ten directions.',
  'workflows.node.body':
    'Lock a parent. Fan out children — palette, framing, copy. Compare side by side. Running branches recover by request ID.',
  'workflows.node.alt':
    'ima2-gen Node mode with connected generated cards and per-node metadata.',

  // Studio capabilities
  'latest.tag': '02 · Studio capabilities',
  'latest.h.before': 'Video, batch, ',
  'latest.h.em': 'import.',
  'latest.lede':
    'Grok Video with storyboard continuity and keyframe copy, multimode candidate slots, Canvas Mode cleanup, and prompt-library imports from files, GitHub folders, and curated sources.',
  'latest.theme.label': 'Light & dark',
  'latest.theme.h': 'Two themes, honest contrast.',
  'latest.theme.body':
    'A token-based light mode with tinted neutrals joins the dark studio. Switch light, dark, or system in Settings — applied before first paint, AA contrast throughout.',
  'latest.theme.alt':
    'ima2-gen settings in light mode showing the light, dark, and system theme toggle.',
  'latest.multimode.label': 'Multimode',
  'latest.multimode.h': 'Four candidates from one prompt.',
  'latest.multimode.body':
    'Run a sequence from Classic mode, watch each slot progress, cancel when needed, and continue from the strongest result.',
  'latest.multimode.alt':
    'ima2-gen multimode sequence showing four generating slots and active job history.',
  'latest.canvas.label': 'Canvas Mode',
  'latest.canvas.h': 'Clean up the winning frame.',
  'latest.canvas.body':
    'Pan around a zoomed image, annotate with live hover feedback, clean backgrounds, and remove the background in one click with GPT transparency — the server verifies real pixel alpha before it tells you it worked.',
  'latest.canvas.alt':
    'ima2-gen Canvas Mode in light theme with the one-click GPT transparency flow and a transparent result.',
  'latest.import.label': 'Prompt import',
  'latest.import.h': 'Bring prompt packs in.',
  'latest.import.body':
    'Use the import dialog to drop files, preview GitHub folders, refresh curated sources, and review searched candidates before adding selected prompts to the library.',
  'latest.import.alt':
    'ima2-gen prompt import dialog for reviewing GitHub folders, curated sources, and searched prompt candidates before import.',
  'latest.skills.label': 'Agent skills',
  'latest.skills.h': 'Frontend & design skills built in.',
  'latest.skills.body':
    'Three packaged skills teach AI agents to build production frontends: core CLI prompting, frontend implementation (assets, motion, responsive, a11y, anti-slop), and design direction discovery (image-first ism workflow, UX states, product personalities). Run ima2 skill ls to discover them.',
  'latest.skills.alt':
    'ima2 skill ls output showing three available skills: core, front, and uiux.',
  'latest.video.label': 'Video',
  'latest.video.h': 'Text, image, or references to video.',
  'latest.video.body':
    'Generate short videos from text, a single image, or up to 14 references. Storyboard mode keeps character and scene continuity across clips; First/Mid/Last buttons copy keyframes from results.',
  'latest.video.alt':
    'ima2-gen video generation with progress percentage and in-flight queue.',

  // Why Branch
  'branch.tag': '03 · Branching as a workflow',
  'branch.h.before': 'A good frame is a ',
  'branch.h.em': 'starting point.',
  'branch.lede':
    'Locking the parent and fanning out children is how visual ideas actually develop. ima2-gen makes it the default.',
  'branch.shot.alt':
    'ima2-gen Node mode canvas with a parent node and child branches showing palette, framing, and copy variants.',
  'branch.scenarios.aria': 'Branching scenario steps',
  'branch.s1.strong': 'Generate a parent.',
  'branch.s1.body': 'A frame you actually want to keep.',
  'branch.s2.strong': 'Fan out children.',
  'branch.s2.body': 'Palette swap, tighter crop, alternate copy margin — three nodes, three runs.',
  'branch.s3.strong': 'Compare without loss.',
  'branch.s3.body': 'The parent stays. Children recover by request ID even after a refresh.',

  // Local & GPT OAuth
  'local.tag': '04 · Local & open',
  'local.h.before': 'Sign in. ',
  'local.h.em': 'Stay local.',
  'local.lede':
    "Start with your free ChatGPT login or a SuperGrok subscription. No API key needed. Generated images, videos, and sessions stay on your disk — not on someone else's.",
  'local.quote.before': 'If the settings page says ',
  'local.quote.strong': 'Configured but disabled',
  'local.quote.after': ', that means an API key exists in env/config but the current workspace is using GPT OAuth. Switch provider to API or Grok when you want those paths.',
  'local.meta': 'User-data folder · MIT licensed · Inspect, sync, version — your call.',
  'local.shot.alt':
    'ima2-gen Settings workspace showing GPT OAuth active and an API key configured but disabled.',

  // Install
  'install.tag': '05 · Get going',
  'install.h.before': 'One command. ',
  'install.h.em': 'Then iterate.',
  'install.lede': 'Install globally. Sign in with ChatGPT or Grok. Start creating.',
  'install.badge.npm': 'npm install',
  'install.badge.node': 'Node ≥22',
  'install.badge.mit': 'MIT',
  'install.links.aria': 'Project links',
  'install.link.repo': 'GitHub repository',
  'install.link.npm': 'npm package',
  'install.link.ko': '한국어 README',
  'install.link.ja': '日本語 README',
  'install.link.zh': '简体中文 README',
  'install.link.zhTw': '正體中文 README',
  'install.desktop.title': 'Desktop app',
  'install.desktop.note': 'macOS · Windows · Linux',
  'install.desktop.step1': 'Download the installer for your platform from the latest desktop release.',
  'install.desktop.step2': 'macOS: open the DMG and drag ima2 into Applications. Windows: run the setup .exe. Linux: chmod +x the AppImage and run it, or install the .deb.',
  'install.desktop.step3': 'Launch ima2 and sign in to a provider from the welcome screen.',
  'install.desktop.cta': 'Download the desktop app',
  'install.desktop.ctaFor': 'Download for {platform}',
  'install.desktop.detected': 'Detected {platform}. Version {version}.',
  'install.desktop.others': 'Other platforms',
  'install.desktop.soon': 'Coming soon',
  'install.desktop.all': 'All desktop releases',
  'install.desktop.other': 'On an Intel Mac? Use the install script or npm below.',
  'dl.platform.mac-arm64': 'macOS · Apple Silicon (.dmg)',
  'dl.platform.win-x64': 'Windows · x64 (.exe)',
  'dl.platform.win-arm64': 'Windows · ARM64 (.exe)',
  'dl.platform.linux-x64-appimage': 'Linux · x64 (.AppImage)',
  'dl.platform.linux-x64-deb': 'Linux · x64 (.deb)',
  'dl.platform.linux-arm64-appimage': 'Linux · ARM64 (.AppImage)',
  'dl.platform.linux-arm64-deb': 'Linux · ARM64 (.deb)',
  'dl.os.mac': 'Mac',
  'dl.os.win': 'Windows',
  'dl.os.linux': 'Linux',
  'banner.tag': 'New release',
  'banner.text': 'ima2 Desktop {version} is out',
  'banner.platforms': 'for {platforms}',
  'banner.download': 'Download',
  'banner.notes': 'Release notes',
  'banner.dismiss': 'Dismiss release banner',

  // FAQ — short list shown on landing
  'faq.tag': 'FAQ',
  'faq.more': 'See all FAQ →',
  'faq.q1': 'When should I use Node mode or Canvas Mode?',
  'faq.a1':
    'Use Node mode to compare several directions from a result you like. Use Canvas Mode when the frame is close but needs targeted cleanup, background work, annotation, or alpha/matte export.',
  'faq.q2': 'Where do my images live?',
  'faq.a2':
    'Locally. Generated images and session logs live in your user-data folder. Inspect, sync, version — your call. Image files are not uploaded to a separate remote store.',
  'faq.q3': 'Do I need an OpenAI API key?',
  'faq.a3':
    'No for the default GPT OAuth path. `ima2-gen` can also use an OpenAI API key or Grok through an xAI OAuth session when you explicitly choose those providers.',

  // FAQ — full detail page
  'faq.page.title': 'FAQ — ima2-gen',
  'faq.page.h': 'Frequently asked questions',
  'faq.page.lede': 'Install, run, branch — answered short.',
  'faq.ui.copy': 'Copy',
  'faq.ui.copied': 'Copied',
  'faq.cat.install': 'Install',
  'faq.cat.usage': 'Usage',
  'faq.cat.tech': 'Tech',

  'faq.install.q1': 'Can I run it through the Codex desktop app?',
  'faq.install.a1':
    'No — it runs through the `Codex CLI`. If the CLI is missing, `ima2-gen` prompts you to install it on first run, then opens a login window. Approve and you are good to go.',
  'faq.install.q2': 'How do I install ima2-gen?',
  'faq.install.a2':
    'Open Terminal (macOS / Linux) or PowerShell (Windows). Install globally with `npm install -g ima2-gen`, then run `ima2 serve`. Open `http://localhost:3333` in your browser.',
  'faq.install.q3': 'What is npm? Is there a one-click install?',
  'faq.install.a3':
    '`npm` is the Node.js package manager. If you do not have it, use the installer for your OS — it helps set up Node when needed, installs `ima2-gen`, and starts the server.',
  'faq.install.q4': 'Does it work on Windows / PowerShell?',
  'faq.install.a4':
    'Yes. Windows 10+ with `PowerShell 5.1` or `PowerShell 7` are supported. The public installer script is served from GitHub Pages and prints every command before running it.',

  'faq.usage.q1': 'How many images can I generate at once?',
  'faq.usage.a1':
    'A Classic run makes several candidates at once (quick picks 1, 2 or 4), and the server runs up to 24 jobs in parallel by default (IMA2_MAX_PARALLEL). Node mode runs each child node as its own request, so you can fan out as many branches as your quota allows.',
  'faq.usage.q2': 'Can I attach reference images?',
  'faq.usage.a2':
    'Up to five references per prompt. Drag, drop, or paste them into the composer. Large files are compressed before upload, so you do not have to pre-process them.',
  'faq.usage.q3': 'How does a Style sheet work?',
  'faq.usage.a3':
    'Save `medium`, `composition`, `mood`, `palette`, and `negative` cues into a sheet, then attach the sheet to any prompt. Style sheets persist across sessions, so you can reuse the same visual direction tomorrow.',
  'faq.usage.q4': 'What is multimode?',
  'faq.usage.a4':
    'Multimode starts several Classic candidates from one prompt and shows slot-by-slot progress. You can stop a run, inspect partial results, and continue from the best image.',
  'faq.usage.q5': 'Can I import prompts from GitHub?',
  'faq.usage.a5':
    'Yes. The prompt library can import local prompt packs, GitHub folders, curated sources, and GPT-image hint packs, then index them locally for search and ranking.',

  'faq.tech.q1': 'What data leaves my machine?',
  'faq.tech.a1':
    'The generation request goes to the selected provider: OpenAI through GPT OAuth/API, or xAI directly at api.x.ai for Grok. The result file and session log stay on your disk.',
  'faq.tech.q2': 'Does it work offline?',
  'faq.tech.a2':
    'Generation needs the selected provider network path, so an internet connection is required for that step. Browsing the local gallery, organizing sessions, and editing style sheets work offline.',
  'faq.tech.q3': 'Is it open source?',
  'faq.tech.a3':
    'Yes. `ima2-gen` is MIT licensed. The code lives on GitHub.',

  // Footer
  'footer.line1': 'ima2-gen · MIT licensed',
  'footer.line2': 'Branch the images you love.',
  'footer.line3': 'Built local. Documented in the open.',
  'footer.lang.aria': 'Language READMEs',

  // LangToggle
  'lang.aria': 'Language',
};

const ko: Dict = {
  // Base / meta
  'meta.title': 'ima2-gen — 로컬 AI 스튜디오, 이미지 + 영상 생성',
  'meta.desc':
    '무료 ChatGPT + SuperGrok으로 이미지와 영상을 만드는 로컬 AI 스튜디오. API 키 없이 시작.',
  'meta.og.title': 'ima2-gen — 만들고, 분기하고, 움직이게',
  'meta.og.desc':
    '이미지 생성, Grok Video, Node 분기, Canvas 정리를 갖춘 로컬 AI 스튜디오. npm이나 macOS·Windows·Linux 데스크톱 앱으로 설치하세요.',

  // Header
  'header.brand.aria': 'ima2-gen 홈',
  'header.nav.aria': '섹션 내비게이션',
  'header.nav.workflows': '워크플로',
  'header.nav.branch': '분기',
  'header.nav.local': '로컬',
  'header.nav.install': '설치',
  'header.nav.faq': 'FAQ',
  'header.nav.docs': '문서',
  'header.gh': 'GitHub ↗',

  // Hero
  'hero.eyebrow': '로컬 AI 스튜디오 · 이미지 + 영상',
  'hero.h1.line1': '마음에 든 한 장,',
  'hero.h1.line2': '거기서 바로',
  'hero.h1.em': '펼치기.',
  'hero.sub':
    '이미지 한 장으로 끝나지 않잖아요. Classic으로 만들고, Node로 방향을 나누고, Video로 움직이게 하고, Canvas로 마무리하세요. 무료 ChatGPT + SuperGrok이면 충분합니다.',
  'hero.cta.cmd': 'npm install -g ima2-gen && ima2 serve',
  'hero.cross.lang': 'English landing →',
  'hero.shot.alt':
    'ima2-gen 비디오 재생 화면 — 갤러리 사이드바에 생성된 이미지와 영상 목록.',

  // Two Workflows
  'workflows.tag': '01 · 생성, 분기, 정리',
  'workflows.h.before': '만드는 방식은 두 가지. ',
  'workflows.h.em': '마무리는 Canvas.',
  'workflows.lede':
    '빠르게 한 장을 만들거나 여러 후보를 동시에 보려면 Classic 또는 Multimode를 사용하세요. 마음에 든 결과에서 여러 방향으로 가지를 뻗고 싶다면 Node, 부분적인 보정이나 배경 정리는 Canvas Mode에서 이어갈 수 있습니다.',
  'workflows.classic.label': 'Classic',
  'workflows.classic.h': '빠르게 한 장을 완성할 때.',
  'workflows.classic.body':
    '프롬프트를 쓰고, 레퍼런스를 다섯 장까지 붙이고, 한 장 또는 multimode 후보 여러 장을 만드세요. 어떤 결과에서든 이어 만들 수 있습니다.',
  'workflows.classic.alt':
    'ima2-gen Classic 모드 — 프롬프트 컴포저, 레퍼런스, 생성된 인물 컷.',
  'workflows.node.label': 'Node',
  'workflows.node.h': '한 컷에서 여러 방향으로.',
  'workflows.node.body':
    '기준이 될 한 장을 고정하고, 색감·구도·카피를 노드별로 펼치세요. 실행 중인 branch는 request ID 기준으로 복구됩니다.',
  'workflows.node.alt':
    'ima2-gen Node 모드 — 연결된 카드들과 노드별 메타.',

  // Studio capabilities
  'latest.tag': '02 · 스튜디오 기능',
  'latest.h.before': '영상, 배치, ',
  'latest.h.em': '가져오기.',
  'latest.lede':
    '스토리보드 연속성과 키프레임 복사가 있는 Grok Video, multimode 후보 슬롯, Canvas 정리, 파일/GitHub/추천 소스에서 프롬프트를 가져오는 라이브러리.',
  'latest.theme.label': 'Light & dark',
  'latest.theme.h': '두 가지 테마, 정직한 대비.',
  'latest.theme.body':
    '틴티드 뉴트럴 기반 라이트 모드가 다크 스튜디오에 합류했습니다. 설정에서 라이트/다크/시스템을 고르면 첫 페인트 전에 적용되고, 전 화면 AA 대비를 지킵니다.',
  'latest.theme.alt':
    'ima2-gen 설정 라이트 모드 — 라이트/다크/시스템 테마 토글이 보이는 화면.',
  'latest.multimode.label': 'Multimode',
  'latest.multimode.h': '하나의 프롬프트에서 네 후보.',
  'latest.multimode.body':
    'Classic에서 시퀀스를 실행하고, 슬롯별 진행을 보면서 필요하면 취소하고, 가장 좋은 결과에서 바로 이어갈 수 있습니다.',
  'latest.multimode.alt':
    'ima2-gen multimode sequence — 네 개 생성 슬롯과 진행 중 작업 히스토리.',
  'latest.canvas.label': 'Canvas Mode',
  'latest.canvas.h': '마음에 든 컷을 정리하기.',
  'latest.canvas.body':
    '확대된 이미지를 이동하고, 호버 하이라이트로 주석을 다루고, GPT 투명화 버튼 한 번으로 배경을 제거합니다. 서버가 실제 픽셀 알파를 검증한 뒤에만 성공이라고 알려줍니다.',
  'latest.canvas.alt':
    'ima2-gen Canvas Mode 라이트 테마 — 원클릭 GPT 투명화와 투명 결과가 보이는 화면.',
  'latest.import.label': 'Prompt import',
  'latest.import.h': 'Prompt pack 가져오기.',
  'latest.import.body':
    '불러오기 다이얼로그에서 로컬 파일, GitHub 폴더, 추천 소스, 검색된 후보를 검토한 뒤 선택한 프롬프트만 라이브러리에 저장합니다.',
  'latest.import.alt':
    'ima2-gen 프롬프트 불러오기 다이얼로그 — GitHub 폴더, 추천 소스, 검색된 프롬프트 후보를 저장 전 검토하는 화면.',
  'latest.skills.label': 'Agent skills',
  'latest.skills.h': '프론트엔드 & 디자인 스킬 내장.',
  'latest.skills.body':
    'AI 에이전트에게 프로덕션급 프론트엔드 구축법을 가르치는 3개 패키징 스킬: 코어 CLI 프롬프팅, 프론트엔드 구현(에셋, 모션, 반응형, 접근성, 안티슬롭), 디자인 방향 탐색(이미지 우선 ism 워크플로, UX 상태, 프로덕트 퍼스널리티). ima2 skill ls로 확인하세요.',
  'latest.skills.alt':
    'ima2 skill ls 실행 결과 — core, front, uiux 3개 스킬이 표시된 화면.',
  'latest.video.label': 'Video',
  'latest.video.h': '텍스트, 이미지, 레퍼런스에서 영상으로.',
  'latest.video.body':
    '텍스트, 단일 이미지, 또는 최대 14장의 레퍼런스에서 짧은 영상을 만듭니다. 스토리보드 모드는 클립 간 인물·장면 연속성을 유지하고, First/Mid/Last 버튼으로 결과에서 키프레임을 복사합니다.',
  'latest.video.alt':
    'ima2-gen 비디오 생성 — 진행률 표시와 대기열.',

  // Why Branch
  'branch.tag': '03 · 분기, 그게 워크플로',
  'branch.h.before': '마음에 든 한 장이 ',
  'branch.h.em': '다음 작업의 시작.',
  'branch.lede':
    '원본은 그대로 두고, 색감·구도·카피만 바꿔 여러 방향을 비교하세요. ima2-gen은 이 흐름을 기본으로 만들었습니다.',
  'branch.shot.alt':
    'ima2-gen Node 모드 — 기준 노드 한 장과 색감·구도·카피 방향의 자식 노드들.',
  'branch.scenarios.aria': '분기 시나리오 단계',
  'branch.s1.strong': '먼저 기준이 될 한 장.',
  'branch.s1.body': '계속 가져가고 싶은 결과를 고르세요.',
  'branch.s2.strong': '거기서 방향을 펼치기.',
  'branch.s2.body':
    '색감은 살짝 다르게, 구도는 더 타이트하게, 카피 여백은 넓게. 방향마다 노드로 나눠 비교합니다.',
  'branch.s3.strong': '원본은 그대로, 결과는 나란히.',
  'branch.s3.body': '새로고침해도 요청 기록을 기준으로 결과를 다시 불러옵니다.',

  // Local & GPT OAuth
  'local.tag': '04 · 로컬 & 오픈',
  'local.h.before': '로그인 한 번, ',
  'local.h.em': '내 컴퓨터에 저장.',
  'local.lede':
    'ChatGPT 무료 계정이나 SuperGrok으로 시작하세요. API 키 없이도 됩니다. 만든 이미지와 영상은 내 컴퓨터에만 남습니다.',
  'local.quote.before': '설정에 ',
  'local.quote.strong': 'Configured but disabled',
  'local.quote.after':
    '가 보인다면, API key가 설정돼 있지만 현재 작업공간은 GPT OAuth를 쓰고 있다는 뜻입니다. API나 Grok 경로를 쓰려면 provider를 바꾸세요.',
  'local.meta': '로컬 저장 · MIT 라이선스 · 확인, 동기화, 버전 관리까지 원하는 방식으로.',
  'local.shot.alt':
    'ima2-gen 설정 화면 — GPT OAuth 활성, API key는 설정되어 있지만 비활성.',

  // Install
  'install.tag': '05 · 시작하기',
  'install.h.before': '두 줄이면 끝. ',
  'install.h.em': '바로 만들기.',
  'install.lede': 'npm install -g ima2-gen → ima2 serve. 끝입니다.',
  'install.badge.npm': 'npm install',
  'install.badge.node': 'Node ≥22',
  'install.badge.mit': 'MIT',
  'install.links.aria': '프로젝트 링크',
  'install.link.repo': 'GitHub 저장소',
  'install.link.npm': 'npm 패키지',
  'install.link.ko': '한국어 README',
  'install.link.ja': '日本語 README',
  'install.link.zh': '简体中文 README',
  'install.link.zhTw': '正體中文 README',
  'install.desktop.title': '데스크톱 앱',
  'install.desktop.note': 'macOS · Windows · Linux',
  'install.desktop.step1': '최신 데스크톱 릴리스에서 내 플랫폼용 설치 파일을 받으세요.',
  'install.desktop.step2': 'macOS: DMG를 열고 ima2를 응용 프로그램 폴더로 옮기세요. Windows: 설치 .exe를 실행하세요. Linux: AppImage에 chmod +x 후 실행하거나 .deb를 설치하세요.',
  'install.desktop.step3': 'ima2를 실행하고 환영 화면에서 제공자에 로그인하세요.',
  'install.desktop.cta': '데스크톱 앱 다운로드',
  'install.desktop.ctaFor': '{platform}용 다운로드',
  'install.desktop.detected': '{platform} 감지됨. 버전 {version}.',
  'install.desktop.others': '다른 플랫폼',
  'install.desktop.soon': '준비 중',
  'install.desktop.all': '전체 데스크톱 릴리스',
  'install.desktop.other': 'Intel Mac이라면 아래 설치 스크립트나 npm을 쓰세요.',
  'dl.platform.mac-arm64': 'macOS · Apple Silicon (.dmg)',
  'dl.platform.win-x64': 'Windows · x64 (.exe)',
  'dl.platform.win-arm64': 'Windows · ARM64 (.exe)',
  'dl.platform.linux-x64-appimage': 'Linux · x64 (.AppImage)',
  'dl.platform.linux-x64-deb': 'Linux · x64 (.deb)',
  'dl.platform.linux-arm64-appimage': 'Linux · ARM64 (.AppImage)',
  'dl.platform.linux-arm64-deb': 'Linux · ARM64 (.deb)',
  'dl.os.mac': 'Mac',
  'dl.os.win': 'Windows',
  'dl.os.linux': 'Linux',
  'banner.tag': '새 릴리스',
  'banner.text': 'ima2 Desktop {version} 출시',
  'banner.platforms': '{platforms} 지원',
  'banner.download': '다운로드',
  'banner.notes': '릴리스 노트',
  'banner.dismiss': '릴리스 배너 닫기',

  // FAQ — 랜딩 짧은 목록
  'faq.tag': 'FAQ',
  'faq.more': '전체 FAQ 보기 →',
  'faq.q1': 'Node 모드와 Canvas Mode는 언제 쓰나요?',
  'faq.a1':
    '마음에 든 결과에서 여러 방향을 비교하려면 Node 모드를 씁니다. 이미지가 거의 맞지만 배경 정리, annotation, alpha/matte export 같은 부분 정리가 필요하면 Canvas Mode를 씁니다.',
  'faq.q2': '이미지는 어디 저장되나요?',
  'faq.a2':
    '로컬 사용자 데이터 폴더에 이미지와 작업 기록이 저장됩니다. 직접 확인, 동기화, 버전 관리까지 가능합니다. 이미지 파일을 별도 외부 저장소에 올리지 않습니다.',
  'faq.q3': 'OpenAI API key가 필요한가요?',
  'faq.a3':
    '기본 GPT OAuth 경로에는 필요 없습니다. 명시적으로 선택하면 OpenAI API key 경로나 xAI OAuth로 붙는 Grok 경로도 사용할 수 있습니다.',

  // FAQ — 상세 페이지
  'faq.page.title': 'FAQ — ima2-gen',
  'faq.page.h': '자주 묻는 질문',
  'faq.page.lede': '설치, 실행, 분기 — 핵심만 짧게.',
  'faq.ui.copy': '복사',
  'faq.ui.copied': '복사됨',
  'faq.cat.install': '설치',
  'faq.cat.usage': '사용',
  'faq.cat.tech': '기술',

  'faq.install.q1': 'Codex 데스크톱 앱으로도 되나요?',
  'faq.install.a1':
    '아니요. `Codex CLI`로 실행됩니다. CLI가 없으면 `ima2-gen`이 첫 실행 때 설치를 안내하고, 로그인 창을 띄워줍니다. 안내대로 깔면 바로 시작할 수 있습니다.',
  'faq.install.q2': '어떻게 설치하나요?',
  'faq.install.a2':
    '터미널(macOS / Linux) 또는 PowerShell(Windows)을 엽니다. `npm install -g ima2-gen`으로 전역 설치하고 `ima2 serve`로 실행하세요. 브라우저에서 `http://localhost:3333`을 열면 됩니다.',
  'faq.install.q3': 'npm이 뭔가요? 한 번에 설치하는 방법이 있나요?',
  'faq.install.a3':
    '`npm`은 Node.js 패키지 매니저입니다. 처음이라면 OS별 설치 스크립트를 사용할 수 있습니다. 스크립트는 Node가 없으면 설치를 안내하고, `ima2-gen` 설치와 서버 실행을 돕습니다.',
  'faq.install.q4': 'Windows / PowerShell에서도 되나요?',
  'faq.install.a4':
    '됩니다. Windows 10 이상, `PowerShell 5.1` 또는 `PowerShell 7`을 지원합니다. 공개 설치 스크립트는 GitHub Pages에서 제공되며, 실행 전 모든 명령을 화면에 출력합니다.',

  'faq.usage.q1': '한 번에 몇 장까지 만들 수 있나요?',
  'faq.usage.a1':
    'Classic은 한 번에 여러 장을 만들 수 있고(빠른 선택 1·2·4장), 서버는 기본적으로 작업을 최대 24개까지 동시에 돌립니다(IMA2_MAX_PARALLEL). Node에서는 자식 노드마다 별도 요청이 가니, 할당량이 허용하는 만큼 가지를 펼칠 수 있습니다.',
  'faq.usage.q2': '레퍼런스 이미지를 붙일 수 있나요?',
  'faq.usage.a2':
    '프롬프트당 다섯 장까지 붙일 수 있습니다. 컴포저에 끌어 놓거나 붙여 넣으면 끝. 큰 파일은 자동으로 압축돼서 업로드되므로 미리 손볼 필요는 없습니다.',
  'faq.usage.q3': 'Style sheet은 어떻게 쓰나요?',
  'faq.usage.a3':
    '`매체`, `구도`, `분위기`, `팔레트`, `제외할 요소`를 시트로 묶어 두고 프롬프트에 붙여 쓰면 됩니다. 시트는 세션을 넘겨도 유지되므로 같은 룩을 다음 작업에서도 그대로 가져갈 수 있습니다.',
  'faq.usage.q4': 'Multimode는 뭔가요?',
  'faq.usage.a4':
    '하나의 프롬프트에서 여러 Classic 후보를 동시에 시작하고 slot별 진행 상황을 보여주는 방식입니다. 진행 도중 특정 슬롯을 취소하거나 중간 결과를 확인한 뒤, 가장 잘 나온 이미지에서 작업을 이어갈 수 있습니다.',
  'faq.usage.q5': 'GitHub에서 prompt를 가져올 수 있나요?',
  'faq.usage.a5':
    '가능합니다. Prompt library는 로컬 prompt pack, GitHub folder, curated source, GPT-image hint pack을 가져와 로컬 index에 저장하고 검색/ranking에 사용합니다.',

  'faq.tech.q1': '내 컴퓨터에서 어떤 데이터가 나가나요?',
  'faq.tech.a1':
    '이미지 생성 요청은 선택한 provider로 전송됩니다: GPT OAuth/API는 OpenAI, Grok은 api.x.ai 직접 호출입니다. 결과 파일과 작업 기록은 로컬에 남습니다.',
  'faq.tech.q2': '오프라인에서도 되나요?',
  'faq.tech.a2':
    '이미지 생성은 선택한 provider 네트워크 경로가 필요해 인터넷이 있어야 합니다. 로컬 갤러리 조회, 세션 정리, 스타일 시트 편집은 오프라인에서도 사용할 수 있습니다.',
  'faq.tech.q3': '오픈소스인가요?',
  'faq.tech.a3':
    '네. `ima2-gen`은 MIT 라이선스로 공개되어 있습니다. 코드는 GitHub에서 볼 수 있습니다.',

  // Footer
  'footer.line1': 'ima2-gen · MIT 라이선스',
  'footer.line2': '마음에 든 한 장, 거기서 바로 펼치기.',
  'footer.line3': '로컬에서 만들고, 코드는 GitHub에.',
  'footer.lang.aria': '언어별 README',

  // LangToggle
  'lang.aria': '언어',
};

export const STRINGS: Record<Lang, Dict> = { en, ko };

export function t(lang: Lang, key: string): string {
  return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
}
