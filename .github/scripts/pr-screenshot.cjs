"use strict";

// Screenshot gate for pull requests that touch the rendered UI surface.
// Ported from opencodex `.github/scripts/pr-quality.cjs`; see
// `.github/workflows/pr-screenshot-gate.yml` for the runner. Everything here
// reads trusted data only (the base-branch script under `pull_request_target`,
// PR metadata, comments, issue events) — PR head code is never checked out.

const UI_SCREENSHOT_WAIVER_LABEL = "ui-screenshot-waived";

/** Collaborator permission levels that may waive the gate via label. */
const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);

/**
 * UI surface for ima2-gen. `ui/` is the React app: everything under it counts
 * except pure test files (`*.test.*`/`*.spec.*` anywhere in `ui/`) and the
 * Playwright suite `ui/e2e/`, which verify behavior but cannot change what
 * the app renders. `public/` is the served web root, so every file in it
 * counts. Under `assets/` only image files count — the folder also holds
 * non-visual templates and snapshots (`card-news/templates`, `mcp-snapshots`)
 * that never produce a rendered pixel.
 */
const IMAGE_PATH_RE = /\.(?:png|jpe?g|gif|webp|svg|avif)$/i;
const UI_TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;

function isUiSurfacePath(file) {
  if (typeof file !== "string" || !file) return false;
  if (file === "ui" || file.startsWith("ui/")) {
    if (file === "ui/e2e" || file.startsWith("ui/e2e/")) return false;
    if (UI_TEST_FILE_RE.test(file)) return false;
    return true;
  }
  if (file === "public" || file.startsWith("public/")) return true;
  if (
    (file === "assets" || file.startsWith("assets/")) &&
    IMAGE_PATH_RE.test(file)
  ) {
    return true;
  }
  return false;
}

function uiPathsChanged(files) {
  return files.some(isUiSurfacePath);
}

/**
 * True when the changed-file list from `pulls.listFiles` cannot be trusted to
 * be complete for screenshot gating. Missing or non-integer counts, a head
 * mismatch between the count snapshot and the paginated list, or a count above
 * the returned list length all fail closed.
 */
function isChangedFileListTruncated(changedFilesCount, listedLength, headMatches = true) {
  if (!headMatches) return true;
  if (!Number.isInteger(changedFilesCount) || changedFilesCount < 0) return true;
  return changedFilesCount > listedLength;
}

/** HTML comments, which GitHub never renders. An unclosed comment runs through EOF. */
const HTML_COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g;
/** Fenced code blocks (``` or ~~~) whose content GitHub does not render. */
const FENCED_CODE_RE = /(?:^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*(?=\n|$)/gm;
/** Embedded markdown image (`![alt](url)`), as GitHub renders for dropped images. */
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\([^)]+\)/;
/** Reference-style markdown image (`![alt][id]`, collapsed `![alt][]`). */
const MARKDOWN_REFERENCE_IMAGE_RE = /!\[([^\]]*)\]\[([^\]]*)\]/g;
/** Link definitions (`[id]: url`) that reference-style images depend on. */
const MARKDOWN_REFERENCE_DEF_RE = /^\s*\[([^\]]+)\]:\s*\S+/gm;
/** Embedded HTML image with a renderable `src` (`<img ... src="...">`). */
const HTML_IMAGE_RE = /<img\b[^>]*\bsrc\s*=\s*(?:"[^"]+"|'[^']+'|[^\s>"']+)[^>]*>/i;

/**
 * Drop the regions GitHub does not render as Markdown: HTML comments and
 * fenced code blocks. Image syntax there is literal text, not evidence.
 */
function stripNonRenderedRegions(body) {
  // Fenced code MUST be removed first. GFM treats fence contents as literal
  // text, so a `<!--` inside a fence never opens an HTML comment. Stripping
  // comments first let an unclosed comment-like literal in a code sample run
  // through EOF and swallow the real body after it, which rejected valid
  // descriptions in opencodex: a UI PR whose screenshot followed such an
  // example lost its evidence.
  return body.replace(FENCED_CODE_RE, "").replace(HTML_COMMENT_RE, "");
}

/**
 * True when the description contains a reference-style image (`![alt][id]` or
 * collapsed `![alt][]`) backed by a matching `[id]: url` definition — GitHub
 * renders only those reference images, so a bare token is not evidence.
 */
function hasRenderableReferenceImage(visible) {
  const definitions = new Set();
  for (const match of visible.matchAll(MARKDOWN_REFERENCE_DEF_RE)) {
    definitions.add(match[1].trim().toLowerCase());
  }
  if (definitions.size === 0) return false;
  for (const match of visible.matchAll(MARKDOWN_REFERENCE_IMAGE_RE)) {
    const id = (match[2] || match[1]).trim().toLowerCase();
    if (id && definitions.has(id)) return true;
  }
  return false;
}

/**
 * True when the rendered description embeds a screenshot image: an inline
 * markdown image, a reference-style image with a definition, or an `<img>` tag
 * with a non-empty `src`. A plain link to an image is not visual evidence.
 */
function hasScreenshotEvidence(body) {
  if (typeof body !== "string") return false;
  const visible = stripNonRenderedRegions(body);
  if (MARKDOWN_IMAGE_RE.test(visible)) return true;
  if (HTML_IMAGE_RE.test(visible)) return true;
  return hasRenderableReferenceImage(visible);
}

/**
 * Phrases in a maintainer comment that waive the UI-screenshot gate. A comment
 * saying the change does not touch the UI means the path cue is a false
 * positive and no screenshot is required. The negation word must appear within
 * a short window before the surface name, so "this touches ui but only the
 * config" (no negation) keeps the gate. The window cannot cross a sentence or
 * line boundary: "This does not change the API. Please add a ui screenshot."
 * must not waive the gate.
 */
const UI_OVERRIDE_RE =
  /\b(?:no|not|doesn'?t|does not|never|without)\b[^.!?\n]{0,40}?\b(?:ui|gui|front[-\s]?end)\b/i;

/**
 * True when a maintainer (OWNER / COLLABORATOR / MEMBER) issue comment waives
 * the UI-screenshot requirement. Only the comment author's association counts:
 * the PR author (`CONTRIBUTOR`/`NONE`) cannot override their own requirement.
 */
function hasUiOverride({ comments = [] }) {
  return comments.some(
    (comment) =>
      (comment?.author_association === "OWNER" ||
        comment?.author_association === "COLLABORATOR" ||
        comment?.author_association === "MEMBER") &&
      typeof comment?.body === "string" &&
      UI_OVERRIDE_RE.test(comment.body)
  );
}

function hasWritePermission(permission) {
  return WRITE_PERMISSIONS.has(permission);
}

/**
 * The login that most recently applied `UI_SCREENSHOT_WAIVER_LABEL`, taken
 * from the issue timeline events (labeled/unlabeled for that label, oldest to
 * newest). Returns null when the label is not currently applied — i.e. the
 * latest event is an `unlabeled` — or when no waiver event exists.
 */
function waiverLabelActorLogin(events) {
  const waiverEvents = (events ?? [])
    .filter(
      (event) =>
        (event?.event === "labeled" || event?.event === "unlabeled") &&
        event?.label?.name === UI_SCREENSHOT_WAIVER_LABEL
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.created_at ?? "") || 0;
      const rightTime = Date.parse(right.created_at ?? "") || 0;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return Number(left.id ?? 0) - Number(right.id ?? 0);
    });
  const latest = waiverEvents.at(-1);
  if (latest?.event !== "labeled") return null;
  return latest.actor?.login ?? null;
}

/**
 * Pure verdict for the gate. `filesTruncated` arms the gate on its own: a
 * change set whose full file list GitHub cannot return might hide a UI path,
 * so an unverifiable list is treated as UI-changing (fail closed).
 */
function evaluateScreenshotGate({
  changedFilePaths = [],
  filesTruncated = false,
  body = "",
  comments = [],
  waiverLabelPresent = false,
  waiverActorPermission = null,
}) {
  const uiPaths = changedFilePaths.filter(isUiSurfacePath);
  if (!filesTruncated && uiPaths.length === 0) {
    return { status: "pass", reason: "no_ui_changes", uiPaths };
  }
  if (hasScreenshotEvidence(body)) {
    return { status: "pass", reason: "screenshot_present", uiPaths };
  }
  if (waiverLabelPresent && hasWritePermission(waiverActorPermission)) {
    return { status: "waived", reason: "label", uiPaths };
  }
  if (hasUiOverride({ comments })) {
    return { status: "waived", reason: "comment", uiPaths };
  }
  return { status: "fail", reason: "missing_ui_screenshot", uiPaths };
}

/**
 * Snapshot the PR, list its changed files (paginated), and check the head did
 * not move between the count and the list. The head is re-read after the page
 * walk; a moved head retries once, then fails closed via `filesTruncated`.
 */
async function listChangedFilesTrustably({ github, owner, repo, pullNumber, core }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: snapshot } = await github.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    const headSha = snapshot.head?.sha ?? "";
    const listedFiles = await github.paginate(github.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });
    const { data: verify } = await github.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    const headMatches = verify.head?.sha === headSha;
    if (!headMatches && attempt === 0) {
      core.info("PR head moved while listing changed files; retrying once.");
      continue;
    }
    if (!headMatches) {
      core.warning(
        "PR head moved during changed-file snapshot; treating file list as truncated."
      );
    }
    return {
      pr: verify,
      changedFilePaths: listedFiles.map((file) => file.filename).filter(Boolean),
      filesTruncated: isChangedFileListTruncated(
        snapshot.changed_files,
        listedFiles.length,
        headMatches
      ),
    };
  }
  // Unreachable: the loop always returns, but keep a closed fallback.
  return { pr: null, changedFilePaths: [], filesTruncated: true };
}

/**
 * Resolve the waiver label's provenance. The label counts only when the actor
 * who applied it holds write/admin permission on the repository — a label a
 * contributor puts on their own PR never waives the gate. Lookup failures
 * return null (fail closed).
 */
async function resolveWaiverActorPermission({ github, owner, repo, pullNumber, core }) {
  let events;
  try {
    events = await github.paginate(github.rest.issues.listEventsForTimeline, {
      owner,
      repo,
      issue_number: pullNumber,
      per_page: 100,
    });
  } catch (error) {
    core.warning(
      `Could not resolve ${UI_SCREENSHOT_WAIVER_LABEL} label provenance: ${error.message}`
    );
    return { actor: null, permission: null };
  }
  const actor = waiverLabelActorLogin(events);
  if (typeof actor !== "string") return { actor: null, permission: null };
  try {
    const { data } = await github.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: actor,
    });
    return { actor, permission: data?.permission ?? null };
  } catch (error) {
    core.warning(
      `Could not look up collaborator permission for ${actor}: ${error.message}`
    );
    return { actor, permission: null };
  }
}

/**
 * Top-level runner invoked by the workflow. Writes a job summary and fails the
 * check (with remediation steps) when UI-surface changes lack screenshot
 * evidence and no waiver applies.
 */
async function runScreenshotGate({ github, context, core }) {
  const { owner, repo } = context.repo;
  const pullRequest = context.payload.pull_request;
  if (!pullRequest) {
    core.info("Not a pull_request_target event; nothing to gate.");
    return;
  }
  const pullNumber = pullRequest.number;

  const { pr, changedFilePaths, filesTruncated } =
    await listChangedFilesTrustably({ github, owner, repo, pullNumber, core });
  if (!pr) {
    core.setFailed("Could not snapshot the pull request; failing closed.");
    return;
  }

  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pullNumber,
    per_page: 100,
  });

  const waiverLabelPresent = (pr.labels ?? []).some(
    (label) => label.name === UI_SCREENSHOT_WAIVER_LABEL
  );
  const { actor: waiverActor, permission: waiverActorPermission } =
    waiverLabelPresent
      ? await resolveWaiverActorPermission({ github, owner, repo, pullNumber, core })
      : { actor: null, permission: null };
  if (waiverLabelPresent && !hasWritePermission(waiverActorPermission)) {
    core.info(
      `${waiverActor ?? "unknown label actor"} lacks write/admin permission; ignoring ${UI_SCREENSHOT_WAIVER_LABEL}.`
    );
  }

  const verdict = evaluateScreenshotGate({
    changedFilePaths,
    filesTruncated,
    body: pr.body ?? "",
    comments,
    waiverLabelPresent,
    waiverActorPermission,
  });

  const summary = core.summary
    .addHeading("Screenshot gate")
    .addRaw(`**Verdict:** ${verdict.status} (${verdict.reason})`, true)
    .addRaw(
      `**Changed files checked:** ${changedFilePaths.length}` +
        (filesTruncated ? " — list truncated, treated as UI-changing" : ""),
      true
    );
  if (verdict.uiPaths.length > 0) {
    summary.addList(verdict.uiPaths.slice(0, 20).map((p) => `\`${p}\``));
  }
  await summary.write();

  if (verdict.status === "fail") {
    core.setFailed(
      "This PR changes the UI surface but the description has no screenshot " +
        "evidence. Add an image to the PR description (drag it into the " +
        "editor, or link a file on the `pr-assets` branch by commit SHA), or " +
        "have a maintainer apply the `ui-screenshot-waived` label / comment " +
        "that the change does not touch the UI."
    );
    return;
  }
  core.info(
    verdict.status === "waived"
      ? `UI screenshot requirement waived (${verdict.reason}).`
      : "Screenshot gate passed."
  );
}

module.exports = {
  UI_SCREENSHOT_WAIVER_LABEL,
  UI_OVERRIDE_RE,
  isUiSurfacePath,
  uiPathsChanged,
  isChangedFileListTruncated,
  stripNonRenderedRegions,
  hasRenderableReferenceImage,
  hasScreenshotEvidence,
  hasUiOverride,
  hasWritePermission,
  waiverLabelActorLogin,
  evaluateScreenshotGate,
  listChangedFilesTrustably,
  resolveWaiverActorPermission,
  runScreenshotGate,
};
