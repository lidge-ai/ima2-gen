// Top-level CLI help, kept out of bin/ima2.ts so the dispatcher stays small.

export function renderHelp(pkg: { name: string; version: string }): string {
  return `
  ${pkg.name} v${pkg.version} — GPT Image 2 Generator

  Usage: ima2 <command> [options]

  Generation workflow:
    Image/video jobs run on the server. For multiple candidates, prefer
    'ima2 gen -n <N>' or 'ima2 multimode <prompt>' instead of repeating
    one-image prompts. Start independent CLI jobs concurrently when needed;
    use 'ima2 ps --json' to monitor requestIds and 'ima2 cancel <id>' to stop.

  Server commands:
    serve [--dev] [--force]  Start the server (--force allows a second instance)
    setup          Choose providers and sign in (interactive)
    login          Sign in with ChatGPT for GPT OAuth (--device for headless)
    status         Show current configuration status
    doctor         Diagnose environment and setup
    open           Open web UI in browser
    reset          Reset configuration

  Client commands (require a running 'ima2 serve'):
    gen <prompt>   Generate image(s) from prompt  (ima2 gen --help)
    video <prompt> Generate video via Grok        (ima2 video --help)
    edit <file>    Edit an existing image         (ima2 edit --help)
    ls             List recent history            (ima2 ls --help)
    show <name>    Show one history item          (ima2 show --help)
    session <sub>  Session/graph CRUD             (ima2 session --help)
    history <sub>  History write-ops              (ima2 history --help)
    prompt <sub>   Prompt library + folders + import (ima2 prompt --help)
    multimode <prompt>   Multi-image SSE generation (ima2 multimode --help)
    node <sub>     Node-mode generate/show          (ima2 node --help)
    annotate <sub> Image annotations CRUD           (ima2 annotate --help)
    canvas-versions <sub>  Canvas version save/update (ima2 canvas-versions --help)
    metadata <file>  Read embedded metadata
    comfy <sub>    ComfyUI workflow export          (ima2 comfy --help)
    cardnews <sub> Card News templates/jobs/export  (ima2 cardnews --help)
    ps             List active jobs               (ima2 ps --help)
    cancel <id>    Mark an in-flight job canceled (ima2 cancel --help)
    inflight <sub> Inflight jobs (ls / rm)         (ima2 inflight --help)
    storage <sub>  Storage status / open-dir       (ima2 storage --help)
    backfill-thumbs  Generate missing thumbnails for gallery performance
    billing        API usage / quota
    providers      Configured providers
    oauth <sub>    GPT OAuth proxy status              (ima2 oauth --help)
    gpt <sub>      ChatGPT OAuth login/status/logout (ima2 gpt --help)
    grok <sub>     xAI OAuth login/status/logout    (ima2 grok --help)
    config <sub>   Config get/set/ls/path/rm       (ima2 config --help)
    defaults <sub> Inspect/change model defaults   (ima2 defaults --help)
    models         List available lane models      (ima2 models --help)
    capabilities   Agent capability metadata       (ima2 capabilities --help)
    tools          Machine tool contracts for agents (ima2 tools --help)
    ping           Ping running server / check health
    start          Start the server in the background (ima2 start --help)
    stop           Stop the running server safely (ima2 stop --help)
    restart        Stop, then start in the background again
    logs           Show the background server log (-n N, -f)
    status --runtime  Who runs the server: pid, url, launcher (--json)
    service        Background service management (install/status/... ; -h)

  Local commands (no running server needed):
    vectorize <image>  Trace a raster image into SVG   (ima2 vectorize --help)

  Agent skills (SKILL.md + references/):
    skill ls                         List packaged skills (ima2, front, uiux)
    skill [front|uiux]               Print a skill's SKILL.md
    skill [front|uiux] refs          List reference modules
    skill [front|uiux] ref <name>    Print one reference module
    skill install --dir <path>       Install all skills to a directory
    skill install front --dir <path> Install one skill only
    skill install --tmp              Install to temp dir (ephemeral)

    Skills ship as directories (SKILL.md + references/). The agent resolves
    its own skill path and passes it via --dir. After install, the agent
    reads SKILL.md and follows references/ natively from disk.

  Options:
    -v, --version  Show version
    -h, --help     Show help

  Server-aware subcommands accept:
    --server <url>       Override discovered server URL
    IMA2_SERVER          Same as --server for client commands
    ~/.ima2/server.json  Auto-discovery file written by 'ima2 serve'
    IMA2_CONFIG_DIR      Override config directory
    IMA2_GENERATED_DIR   Override generated images directory
    IMA2_CARD_NEWS=1     Enable Card News routes
    IMA2_LOG_LEVEL       debug|info|warn|error

  Examples:
    ima2 serve                       Start server in this terminal
    ima2 start                       Start server in the background
    ima2 status --runtime --json     Inspect the running server
    ima2 serve --dev                 Start with verbose server diagnostics
    ima2 gen "a shiba in space"      Generate from CLI
    ima2 gen "a shiba in space" -n 4 -d ./out
                                      Generate 4 candidates in one request
    ima2 ps --json                    Watch active async generation jobs
    ima2 gen "merge" --ref a.png --ref b.png -q high -o out.png
    ima2 video "a cat playing piano" --duration 10
    ima2 ls -n 10                    Last 10 generations
    ima2 skill                       Print core agent skill
    ima2 skill ls                     List all skills (core, front, uiux)
    ima2 skill front                  Print frontend implementation skill
    ima2 skill uiux                   Print design direction skill
    ima2 skill front refs             List frontend reference modules
    ima2 skill front ref motion       Load one reference module
    ima2 skill install --dir <path>   Install all skills
    ima2 skill install front --dir <path>  Install frontend skill only
    ima2 skill install --tmp          Install to temp dir
    ima2 capabilities --json         Inspect supported models/options
    ima2 models --json               List image/video models by lane
    ima2 defaults --json             Inspect running server defaults
    ima2 ping                        Health check
`;
}
