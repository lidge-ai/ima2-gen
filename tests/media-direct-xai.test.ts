import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/xai.js";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.js";

const key = "sk-test-SECRET-123456";
const request: MediaSubmitRequest = { model: "xai/grok-imagine-video-1.5", task: "text-to-video", prompt: "unchanged", inputs: [] };
function fake(responses: Array<{status?: number; body: unknown}>) {
  const calls: Array<{url: string; init: RequestInit}> = [];
  const ctx: MediaAdapterContext = { apiKey: key, fetch: async (input, init) => {
    calls.push({url: String(input), init: init ?? {}});
    const next = responses.shift();
    assert.ok(next, "unexpected network call");
    return new Response(JSON.stringify(next.body), {status: next.status ?? 200});
  } };
  return {ctx, calls};
}
test("generation requests and state transitions", async () => {
  const f = fake([{body:{request_id:"abc"}},{body:{status:"pending"}},{body:{status:"done",video:{url:"https://cdn.example/video.mp4",respect_moderation:true}}},{body:{status:"failed",error:{message:key}}}]);
  const job = await adapter.submit(f.ctx, {...request,durationSec:5,resolution:"720p",aspectRatio:"16:9",audio:false});
  assert.equal(f.calls[0]?.url,"https://api.x.ai/v1/videos/generations");
  assert.equal(f.calls[0]?.init.method,"POST");
  assert.equal((f.calls[0]?.init.headers as Record<string,string>).Authorization,`Bearer ${key}`);
  assert.deepEqual(JSON.parse(String(f.calls[0]?.init.body)),{model:"grok-imagine-video-1.5",prompt:"unchanged",duration:5,resolution:"720p",aspect_ratio:"16:9",generate_audio:false});
  assert.equal((await adapter.poll(f.ctx,job)).status,"running");
  assert.deepEqual(await adapter.poll(f.ctx,job),{status:"succeeded",outputs:[{kind:"video",url:"https://cdn.example/video.mp4",mimeType:"video/mp4"}]});
  const failed = await adapter.poll(f.ctx,job); assert.equal(failed.status,"failed");
  assert.ok(!JSON.stringify(failed).includes(key));
  assert.equal(f.calls[1]?.url,"https://api.x.ai/v1/videos/abc");
});
test("image and reference wire shapes", async () => {
  const f = fake([{body:{request_id:"1"}},{body:{request_id:"2"}}]);
  await adapter.submit(f.ctx,{...request,task:"image-to-video",inputs:[{role:"first-frame",url:"https://a.test/1",mimeType:"image/png"}]});
  await adapter.submit(f.ctx,{...request,task:"reference-to-video",inputs:[{role:"reference-image",url:"https://a.test/2",mimeType:"image/png"}]});
  assert.deepEqual(JSON.parse(String(f.calls[0]?.init.body)).image,{url:"https://a.test/1"});
  assert.deepEqual(JSON.parse(String(f.calls[1]?.init.body)).reference_images,[{url:"https://a.test/2"}]);
});
test("HTTP errors are classified and scrubbed", async () => {
  for (const [status,category,retryable] of [[401,"auth",false],[402,"quota",false],[429,"rate-limit",true],[500,"upstream",true]] as const) {
    const f=fake([{status,body:{error:{message:key}}}]);
    await assert.rejects(adapter.submit(f.ctx,request), error => {
      assert.ok(error instanceof Error); assert.ok(!error.message.includes(key));
      const normalized=adapter.normalizeError(error); assert.equal(normalized.category,category); assert.equal(normalized.retryable,retryable); assert.match(normalized.code,/^XAI_/); assert.ok(!normalized.message.includes(key)); return true;
    });
  }
});
test("invalid requests and key validation", async () => {
  const f=fake([{body:{data:[]}},{status:401,body:{error:key}}]);
  await assert.rejects(adapter.submit(f.ctx,{...request,model:"xai/missing"}));
  await assert.rejects(adapter.submit(f.ctx,{...request,vendorOptions:{surprise:true}}));
  assert.deepEqual(await adapter.validateKey(f.ctx),{ok:true});
  assert.equal((await adapter.validateKey(f.ctx)).ok,false);
  assert.equal(f.calls[0]?.url,"https://api.x.ai/v1/models");
});
test("video editing and extension use their documented endpoints", async () => {
  const f = fake([{body:{request_id:"edit"}},{body:{request_id:"extend"}}]);
  const input = {role:"source-video" as const,url:"https://cdn.example/input.mp4",mimeType:"video/mp4"};
  await adapter.submit(f.ctx,{...request,model:"xai/grok-imagine-video",task:"video-to-video",inputs:[input]});
  await adapter.submit(f.ctx,{...request,model:"xai/grok-imagine-video",task:"video-extend",durationSec:6,inputs:[input]});
  assert.equal(f.calls[0]?.url,"https://api.x.ai/v1/videos/edits");
  assert.deepEqual(JSON.parse(String(f.calls[0]?.init.body)),{model:"grok-imagine-video",prompt:"unchanged",video:{url:input.url}});
  assert.equal(f.calls[1]?.url,"https://api.x.ai/v1/videos/extensions");
  assert.deepEqual(JSON.parse(String(f.calls[1]?.init.body)),{model:"grok-imagine-video",prompt:"unchanged",duration:6,video:{url:input.url}});
});
test("moderation and bad input fail closed", async () => {
  const f=fake([{body:{status:"done",video:{respect_moderation:false}}}]);
  const result=await adapter.poll(f.ctx,{providerJobId:"id"});
  assert.equal(result.status,"failed");
  if (result.status === "failed") assert.equal(result.error.category,"moderation");
  await assert.rejects(adapter.submit(f.ctx,{...request,model:key}), error => error instanceof Error && !error.message.includes(key));
  assert.ok(!adapter.normalizeError(new Error(key)).message.includes(key));
  await assert.rejects(adapter.submit(f.ctx,{...request,task:"reference-to-video",resolution:"1080p",inputs:[{role:"reference-image",url:"https://a.test/i",mimeType:"image/png"}]}));
});


const img = (role: "reference-image" | "first-frame" | "last-frame", url: string) => ({ role, url, mimeType: "image/png" });

test("local bytes travel as data: URLs, as the grok lane sends them", async () => {
  const f = fake([{body:{request_id:"bytes"}}]);
  await adapter.submit(f.ctx,{...request,task:"image-to-video",inputs:[{role:"first-frame",bytes:new Uint8Array([1,2,3]),mimeType:"image/jpeg"}]});
  assert.deepEqual(JSON.parse(String(f.calls[0]?.init.body)).image,{url:"data:image/jpeg;base64,AQID"});
  await assert.rejects(adapter.submit(f.ctx,{...request,task:"image-to-video",inputs:[{role:"first-frame",url:"http://insecure.test/a.png",mimeType:"image/png"}]}),/https URL or a data: URL/);
});

test("reference-to-video on 1.5 maps first/last frame and keyframes, other refs stay references", async () => {
  const f = fake([{body:{request_id:"pins"}}]);
  await adapter.submit(f.ctx,{...request,task:"reference-to-video",durationSec:10,resolution:"720p",audio:false,
    inputs:[img("first-frame","https://a.test/first"),img("reference-image","https://a.test/k1"),img("reference-image","https://a.test/ref"),img("reference-image","https://a.test/k2"),img("last-frame","https://a.test/last")],
    vendorOptions:{keyframes:[{inputIndex:1,timestampS:2.333},{inputIndex:3,timestampS:7.333}]}});
  const body = JSON.parse(String(f.calls[0]?.init.body));
  assert.deepEqual(body,{model:"grok-imagine-video-1.5",prompt:"unchanged",duration:10,resolution:"720p",generate_audio:false,
    image:{url:"https://a.test/first"},reference_images:[{url:"https://a.test/ref"}],last_frame:{url:"https://a.test/last"},
    keyframes:[{image:{url:"https://a.test/k1"},timestamp_s:2.333},{image:{url:"https://a.test/k2"},timestamp_s:7.333}]});
});

test("keyframe rules from the grok lane are enforced before any request", async () => {
  const f = fake([]);
  const r2v = {...request,task:"reference-to-video" as const,durationSec:8,inputs:[img("reference-image","https://a.test/1"),img("reference-image","https://a.test/2"),img("first-frame","https://a.test/f")]};
  const bad: Array<[unknown, RegExp]> = [
    [[{inputIndex:2,timestampS:1}], /must point at a reference-image/],
    [[{inputIndex:9,timestampS:1}], /must point at a reference-image/],
    [[{inputIndex:0,timestampS:8}], /strictly inside/],
    [[{inputIndex:0,timestampS:0}], /strictly inside/],
    [[{inputIndex:0,timestampS:1},{inputIndex:1,timestampS:1.1}], /same 1\/3 s slot/],
    [[{inputIndex:0,timestampS:1},{inputIndex:0,timestampS:3}], /two keyframes use input 0/],
    [[{inputIndex:0,timestampS:1},{inputIndex:1,timestampS:2},{inputIndex:0,timestampS:3},{inputIndex:1,timestampS:4},{inputIndex:0,timestampS:5}], /at most 4/],
    ["nope", /must be an array/],
    [[{inputIndex:"0",timestampS:1}], /integer inputIndex/],
  ];
  for (const [keyframes, pattern] of bad) await assert.rejects(adapter.submit(f.ctx,{...r2v,vendorOptions:{keyframes}}), pattern);
  await assert.rejects(adapter.submit(f.ctx,{...r2v,durationSec:undefined,vendorOptions:{keyframes:[{inputIndex:0,timestampS:1}]}}), /need durationSec/);
  await assert.rejects(adapter.submit(f.ctx,{...r2v,resolution:"1080p"}), /capped at 720p/);
  await assert.rejects(adapter.submit(f.ctx,{...r2v,task:"image-to-video",inputs:[img("first-frame","https://a.test/f")],vendorOptions:{keyframes:[{inputIndex:0,timestampS:1}]}}), /make a reference-to-video request/);
  await assert.rejects(adapter.submit(f.ctx,{...r2v,model:"xai/grok-imagine-video",inputs:[img("reference-image","https://a.test/1")],vendorOptions:{keyframes:[{inputIndex:0,timestampS:1}]}}), /need grok-imagine-video-1.5/);
  await assert.rejects(adapter.submit(f.ctx,{...r2v,model:"xai/grok-imagine-video",inputs:[img("reference-image","https://a.test/1"),img("last-frame","https://a.test/l")]}), /does not take a last-frame/);
  await assert.rejects(adapter.submit(f.ctx,{...r2v,model:"xai/grok-imagine-video",durationSec:12,inputs:[img("reference-image","https://a.test/1")]}), /at most 10 seconds/);
  await assert.rejects(adapter.submit(f.ctx,{...r2v,inputs:[img("first-frame","https://a.test/f")]}), /needs a reference image, a keyframe or a last frame/);
  await assert.rejects(adapter.submit(f.ctx,{...request,model:"xai/grok-imagine-video",audio:false}), /Silent output/);
  assert.equal(f.calls.length,0);
});

test("video-to-video takes one source video and nothing that would be ignored", async () => {
  const f = fake([{body:{request_id:"edit-bytes"}}]);
  await adapter.submit(f.ctx,{...request,model:"xai/grok-imagine-video",task:"video-to-video",inputs:[{role:"source-video",bytes:new Uint8Array([0,0,0,24]),mimeType:"video/mp4"}]});
  assert.deepEqual(JSON.parse(String(f.calls[0]?.init.body)).video,{url:"data:video/mp4;base64,AAAAGA=="});
  await assert.rejects(adapter.submit(f.ctx,{...request,model:"xai/grok-imagine-video",task:"video-to-video",durationSec:5,inputs:[{role:"source-video",url:"https://a.test/v.mp4",mimeType:"video/mp4"}]}), /follows the source/);
  await assert.rejects(adapter.submit(f.ctx,{...request,model:"xai/grok-imagine-video",task:"video-to-video",inputs:[]}), /needs one source-video/);
});
