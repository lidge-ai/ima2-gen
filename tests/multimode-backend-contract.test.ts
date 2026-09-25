import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSourceTree } from "./_readTree.mjs";
import { collectCallArguments } from "./_executionImportEdges.mjs";

const root = process.cwd();

// NOTE: lib/oauthProxy.ts was split into lib/oauthProxy/*.ts behind a facade;
// readSource("lib/oauthProxy.ts") now returns all split sources concatenated.
const OAUTH_PROXY_SOURCES = [
  "lib/oauthProxy.ts",
  "lib/oauthProxy/types.ts",
  "lib/oauthProxy/prompts.ts",
  "lib/oauthProxy/references.ts",
  "lib/oauthProxy/errors.ts",
  "lib/oauthProxy/runtime.ts",
  "lib/oauthProxy/streams.ts",
  "lib/oauthProxy/generators.ts",
  "lib/oauthProxy/multimodeGenerators.ts",
  "lib/oauthProxy/index.ts",
];

function readSource(path) {
  if (path === "lib/oauthProxy.ts") {
    return OAUTH_PROXY_SOURCES.map((p) => readFileSync(join(root, p), "utf8")).join("\n");
  }
  return readSourceTree(path);
}

describe("multimode backend contract", () => {
  it("registers a separate multimode route instead of overloading classic generate", () => {
    const index = readSource("routes/index.ts");
    const route = (readSource("routes/multimode.ts") + readSource("lib/multimodePipeline.ts"));
    const classic = (readSource("routes/generate.ts") + readSource("lib/generatePipeline.ts"));

    assert.match(index, /registerMultimodeRoutes/);
    assert.match(route, /app\.post\("\/api\/generate\/multimode"/);
    assert.match(route, /normalizeMaxImages/);
    const owner = "lib/providers/adapters/openaiExecution.ts";
    const calls = collectCallArguments(readFileSync(join(root, owner), "utf8"), owner, "generateMultimodeViaResponses", "executeOpenaiMultimode");
    assert.equal(calls.length, 1);
    assert.match(calls[0][9], /maxImages/);
    assert.match(calls[0][9], /onPartialImage: progress\.onPartialImage/);
    assert.match(calls[0][9], /onFinalImage: progress\.onFinalImage/);
    assert.match(classic, /Promise\.allSettled\(Array\.from\(\{ length: count \}, generateOne\)\)/);
  });

  it("uses a strict prompt wrapper and collects multiple image_generation_call outputs", () => {
    const oauth = readSource("lib/oauthProxy.ts");
    const operationsOwner = "lib/providers/adapters/openaiOperations.ts";
    const operations = readFileSync(join(root, operationsOwner), "utf8");
    const transportOwner = "lib/responsesTransport.ts";
    const transport = readFileSync(join(root, transportOwner), "utf8");
    const responsesTools = readFileSync(join(root, "lib/responsesTools.ts"), "utf8");
    const parser = readFileSync(join(root, "lib/responsesParse.ts"), "utf8");

    assert.match(oauth, /export function buildMultimodeSequencePrompt/);
    assert.match(oauth, /You MUST create up to N separate image_generation_call outputs/);
    assert.match(oauth, /Do not create a collage/);
    assert.match(oauth, /Do not create a grid/);
    assert.match(oauth, /Do not create a contact sheet/);
    assert.match(oauth, /Do not create a storyboard sheet/);
    assert.match(oauth, /Do not put multiple panels inside one image/);
    const streamCalls = collectCallArguments(transport, transportOwner, "parseStream", "postResponses");
    assert.equal(streamCalls.length, 1);
    assert.match(streamCalls[0][1], /onPartialImage, onFinalImage/);
    assert.match(parser, /export async function parseStream/);
    assert.match(parser, /images: \[\]/);
    assert.match(parser, /state\.images\.push\(/);
    assert.match(parser, /state\.images\.some\(\(image\) => image\.b64 === item\.result\)\) return/);
    assert.match(parser, /onFinalImage/);
    assert.match(parser, /await onFinalImage\?\.\(image, index\)/);
    const posts = collectCallArguments(operations, operationsOwner, "postResponses", "generateMultimodeViaResponses");
    assert.equal(posts.length, 1);
    assert.match(posts[0][0], /onPartialImage: options\.onPartialImage/);
    assert.match(posts[0][0], /onFinalImage: options\.onFinalImage/);
    assert.match(parser, /extraIgnored/);
    assert.match(responsesTools, /function tools\(webSearchEnabled/);
    assert.match(responsesTools, /\.\.\(webSearchEnabled \? \[\{ type: "web_search" \}\] : \[\]\)/);
    assert.match(posts[0][0], /tool_choice: "required"/);
  });

  it("persists sequence metadata and surfaces it through history", () => {
    const route = (readSource("routes/multimode.ts") + readSource("lib/multimodePipeline.ts"));
    const history = readSource("lib/historyList.ts");
    const api = readSource("ui/src/lib/api.ts");

    for (const source of [route, history, api]) {
      assert.match(source, /sequenceId/);
      assert.match(source, /sequenceIndex/);
      assert.match(source, /sequenceTotalRequested/);
      assert.match(source, /sequenceTotalReturned/);
      assert.match(source, /sequenceStatus/);
    }
    assert.match(route, /kind: "multimode-image"/);
    assert.match(route, /generationStrategy: "one-call-text-sequence"/);
  });

  it("saves multimode images incrementally and preserves partial timeout output", () => {
    const route = (readSource("routes/multimode.ts") + readSource("lib/multimodePipeline.ts"));

    assert.match(route, /const persistedIndexes = new Set<number>\(\)/);
    assert.match(route, /const persistAndSendImage = async/);
    assert.match(route, /onFinalImage: async \(image, index\) =>/);
    assert.match(route, /await persistAndSendImage\(/);
    assert.match(route, /persistedIndexes\.has\(index\)/);
    assert.match(route, /dualEmitMultimode\(res, requestId, "image", item\)/);
    assert.match(route, /fallbackCode === "RESPONSES_IMAGE_TIMEOUT"/);
    assert.match(route, /images\.length > 0/);
    assert.match(route, /finishHttpStatus = 206/);
    assert.match(route, /partialErrorCode: "RESPONSES_IMAGE_TIMEOUT"/);
    assert.match(route, /usage: latestUsage/);
    assert.match(route, /extraIgnored: latestExtraIgnored/);
  });
});
