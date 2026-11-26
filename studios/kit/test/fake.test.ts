import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeServer } from '../src/fake/server.ts';
import { createStudioClient } from '../src/client.ts';
import { StudioApiError } from '../src/http.ts';
import { readSse } from '../src/sse.ts';
import type { JobEvent } from '../src/types.ts';

const image={model:'openai/gpt-image-2',task:'text-to-image' as const,inputs:[]};
test('client exercises catalog, keys, media, history and workflows', async () => {
  const server=await startFakeServer({timeScale:0.02});
  const bodies:string[]=[]; const secret='a-unique-private-key-73812';
  const intercepted: typeof fetch=async (input,init) => {const response=await fetch(input,init); if(!response.headers.get('content-type')?.includes('text/event-stream')) bodies.push(await response.clone().text()); return response;};
  const client=createStudioClient({baseUrl:server.url,fetch:intercepted});
  try {
    const catalog=await client.catalog(); assert.ok(catalog.models.length>=24);
    assert.equal(catalog.models.find(m=>m.id===image.model)?.routes[0]?.keyConfigured,true);
    await client.keys.save('kling',{apiKey:secret}); assert.equal((await client.keys.validate('kling')).ok,true);
    assert.equal((await client.keys.list()).find(k=>k.keyVocabulary==='kling')?.configured,true);
    const upload=await client.uploads.put(new Uint8Array([1,2,3]),'image/png'); assert.equal(upload.bytes,3);
    const accepted=await client.media.submit({...image,prompt:secret,inputs:[{role:'reference-image',inputId:upload.inputId}],clientRequestId:'same'});
    assert.deepEqual(await client.media.submit({...image,clientRequestId:'same'}),accepted);
    const done=await client.watchJob(accepted.jobId); assert.equal(done.status,'succeeded'); assert.equal(done.provider,'openai');
    const output=await fetch(server.url+done.outputs[0]!.url); assert.equal(output.headers.get('content-type'),'image/png'); assert.equal((await output.arrayBuffer()).byteLength>100,true);
    const video=await client.media.submit({model:'kling/kling-3',task:'text-to-video',inputs:[],aspectRatio:'9:16'});
    const finished=await client.watchJob(video.jobId); const range=await fetch(server.url+finished.outputs[0]!.url,{headers:{Range:'bytes=0-31'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,32);
    const first=await client.history.list({limit:1}); assert.equal(first.items.length,1); assert.ok(first.nextCursor);
    const second=await client.history.list({limit:1,cursor:first.nextCursor!});assert.notEqual(first.items[0]!.historyId,second.items[0]!.historyId);
    const id=first.items[0]!.historyId;await client.history.favorite(id,true); assert.equal((await client.history.list({favorite:true,kind:'video'})).items.length,1);
    await client.history.remove(id);assert.equal((await client.history.list({kind:'video'})).items.length,0);
    const defs=await client.workflows.list();assert.equal(defs.length,7);
    const run={inputs:{prompt:'A scene',source:[{role:'source-video' as const,url:'/files/source'}]}}; assert.equal((await client.workflows.estimate(defs[0]!.id,run)).steps.length,2);
    const abort=new AbortController(), events:JobEvent[]=[];
    let opened!: () => void; const ready=new Promise<void>(resolve=>{opened=resolve;});
    const following=client.events.follow({signal:abort.signal,onEvent:e=>events.push(e),onStatus:s=>{if(s==='open')opened();}});
    await ready; const wf=await client.workflows.run(defs[0]!.id,run); assert.equal((await client.watchJob(wf.jobId)).status,'succeeded');
    abort.abort();await following;assert.ok(events.some(e=>e.jobId===wf.jobId && e.event==='step'));
    assert.ok(!JSON.stringify(events).includes(secret));
    await client.keys.remove('kling');assert.equal((await client.keys.validate('kling')).ok,false);
    assert.ok(!bodies.join('').includes(secret));
  } finally {await server.close();}
});

test('missing keys, failures and cancellation',async()=>{
  const server=await startFakeServer({timeScale:0.05,keyed:[]});const client=createStudioClient({baseUrl:server.url});
  try {
    await assert.rejects(client.media.submit(image),(e:unknown)=>e instanceof StudioApiError && e.status===409 && e.code==='MEDIA_KEY_MISSING' && Array.isArray((e.details as {candidates:string[]}).candidates));
    await assert.rejects(client.media.submit({...image,model:'unknown'}),(e:unknown)=>e instanceof StudioApiError && e.code==='MEDIA_MODEL_UNKNOWN');
    await client.keys.save('fal',{apiKey:'x-private-value'});
    const job=await client.media.submit({...image,prompt:'[fail:rate-limit]'});const failed=await client.watchJob(job.jobId);assert.equal(failed.error?.category,'rate-limit');assert.equal(failed.error?.code,'FAKE_RATE_LIMIT');
    const pending=await client.media.submit(image);assert.equal((await client.media.cancel(pending.jobId)).job.status,'canceled');assert.equal((await client.watchJob(pending.jobId)).status,'canceled');
  } finally {await server.close();}
});

test('SSE replay resumes and reports gaps',async()=>{
  const server=await startFakeServer({timeScale:0.001});const client=createStudioClient({baseUrl:server.url});
  try {
    for(let i=0;i<22;i++){const a=await client.media.submit(image);await client.watchJob(a.jobId);}
    const controller=new AbortController();const response=await fetch(server.url+'/api/events',{headers:{'Last-Event-ID':'1'},signal:controller.signal});
    const seen:number[]=[];let gap=false;
    for await(const event of readSse(response.body!)){if(event.event==='replay-gap')gap=true;if(event.id)seen.push(Number(event.id));if(seen.length===100)break;}
    controller.abort();assert.equal(gap,true);assert.equal(new Set(seen).size,100);assert.deepEqual(seen,Array.from({length:100},(_,i)=>seen[0]!+i));
    const cursor=seen[seen.length-3]!;const stop=new AbortController();const replay=await fetch(server.url+'/api/events',{headers:{'Last-Event-ID':String(cursor)},signal:stop.signal});const ids:number[]=[];
    for await(const event of readSse(replay.body!)){if(event.id)ids.push(Number(event.id));if(ids.length===2)break;}stop.abort();assert.deepEqual(ids,[cursor+1,cursor+2]);
  } finally {await server.close();}
});
