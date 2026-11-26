import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { adapter } from '../lib/providers/media/direct/google-vertex.js';
import type { MediaAdapterContext, MediaSubmitRequest } from '../lib/providers/media/contract.js';
const privateKey = generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
const key = JSON.stringify({type:'service_account',project_id:'test-project',client_email:'fake@example.test',private_key:privateKey});
const req: MediaSubmitRequest = {model:'google/veo-3.1',task:'text-to-video',prompt:'a cat',inputs:[]};
function fake(responses: Array<{status?:number;body:unknown}>) {
 const calls: Array<{url:string;init?:RequestInit}> = [];
 const ctx: MediaAdapterContext = {apiKey:key,fetch:(async (url,init) => { calls.push({url:String(url),init}); const r=responses.shift(); assert.ok(r); return new Response(JSON.stringify(r.body),{status:r.status ?? 200}); }) as typeof fetch};
 return {ctx,calls};
}
test('mints a bearer token and reuses it for submit and poll',async () => {
 const op='projects/test-project/locations/us-central1/publishers/google/models/veo-3.1-generate-001/operations/123';
 const {ctx,calls}=fake([{body:{access_token:'fake-access-token',expires_in:3600}},{body:{name:op}},{body:{done:false}},{body:{done:true,response:{videos:[{bytesBase64Encoded:'YQ==',mimeType:'video/mp4'}]}}}]);
 const job=await adapter.submit(ctx,req); assert.equal(calls[0]?.url,'https://oauth2.googleapis.com/token');
 assert.match(String(calls[0]?.init?.body),/grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
 assert.match(calls[1]?.url ?? '',/veo-3.1-generate-001:predictLongRunning$/);
 assert.equal((calls[1]?.init?.headers as Record<string,string>).Authorization,'Bearer fake-access-token');
 assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)),{instances:[{prompt:'a cat'}],parameters:{}});
 assert.equal((await adapter.poll(ctx,job)).status,'running'); const state=await adapter.poll(ctx,job); assert.equal(state.status,'succeeded');
 if(state.status==='succeeded') assert.deepEqual(state.outputs[0]?.bytes,new Uint8Array([97])); assert.equal(calls.length,4);
});

test('validates input before networking', async () => {
 const {ctx}=fake([]);
 await assert.rejects(adapter.submit(ctx,{...req,model:'unknown'}));
 await assert.rejects(adapter.submit(ctx,{...req,vendorOptions:{unknown:true}}));
});

test('classifies HTTP errors without revealing credentials', async () => {
 for (const [index,status,category,retryable] of [[1,401,'auth',false],[2,402,'quota',false],[3,429,'rate-limit',true],[4,500,'upstream',true]] as const) {
  const {ctx}=fake([{body:{access_token:'secret-token-'+index,expires_in:3600}},{status,body:{error:{message:key+' '+privateKey+' secret-token-'+index}}}]);
  ctx.apiKey=JSON.stringify({type:'service_account',project_id:'test-project',client_email:`fake${index}@example.test`,private_key:privateKey});
  await assert.rejects(adapter.submit(ctx,req),(error:Error)=>{ const result=adapter.normalizeError(error); assert.equal(result.category,category); assert.equal(result.retryable,retryable); assert.match(result.code,/^GOOGLE_VERTEX_/); for(const secret of [key,privateKey,'secret-token-'+index]) {assert.ok(!error.message.includes(secret));assert.ok(!result.message.includes(secret));} return true; });
 }
});

test('validates key and maps failed and unsupported output',async()=>{
 const {ctx}=fake([{body:{access_token:'validation-token',expires_in:3600}},{body:{}},{body:{done:true,error:{message:privateKey}}},{body:{done:true,response:{videos:[{gcsUri:'gs://private/video'}]}}}]);
 ctx.apiKey=JSON.stringify({type:'service_account',project_id:'test-project',client_email:'validation@example.test',private_key:privateKey});
 assert.equal((await adapter.validateKey(ctx)).ok,true);
 const job={providerJobId:'projects/test-project/locations/us-central1/publishers/google/models/veo-3.1-generate-001/operations/123',resume:{model:'veo-3.1-generate-001'}};
 const failed=await adapter.poll(ctx,job); assert.equal(failed.status,'failed'); if(failed.status==='failed') assert.ok(!failed.error.message.includes(privateKey));
 const gcs=await adapter.poll(ctx,job); assert.equal(gcs.status,'failed'); if(gcs.status==='failed') assert.equal(gcs.error.code,'GOOGLE_VERTEX_BAD_RESPONSE');
 const denied=fake([{status:401,body:{error:'invalid'}}]); denied.ctx.apiKey=JSON.stringify({type:'service_account',project_id:'test-project',client_email:'denied@example.test',private_key:privateKey});
 assert.equal((await adapter.validateKey(denied.ctx)).ok,false);
});

test('serializes reference images and restricts reference duration',async()=>{
 const operation='projects/test-project/locations/us-central1/publishers/google/models/veo-3.1-generate-001/operations/ref';
 const {ctx,calls}=fake([{body:{access_token:'ref-token',expires_in:3600}},{body:{name:operation}}]);
 ctx.apiKey=JSON.stringify({type:'service_account',project_id:'test-project',client_email:'reference@example.test',private_key:privateKey});
 const input={role:'reference-image' as const,bytes:new Uint8Array([97]),mimeType:'image/png'};
 const reference={...req,task:'reference-to-video' as const,inputs:[input],durationSec:8};
 await adapter.submit(ctx,reference);
 assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)),{instances:[{prompt:'a cat',referenceImages:[{image:{bytesBase64Encoded:'YQ==',mimeType:'image/png'},referenceType:'asset'}]}],parameters:{durationSeconds:8}});
 await assert.rejects(adapter.submit(ctx,{...reference,durationSec:4}));
 await assert.rejects(adapter.submit(ctx,{...reference,model:'google/veo-3.1-lite'}));
});

test('serializes first frame as a Vertex image',async()=>{
 const operation='projects/test-project/locations/us-central1/publishers/google/models/veo-3.1-generate-001/operations/image';
 const {ctx,calls}=fake([{body:{access_token:'image-token',expires_in:3600}},{body:{name:operation}}]);
 ctx.apiKey=JSON.stringify({type:'service_account',project_id:'test-project',client_email:'image@example.test',private_key:privateKey});
 await adapter.submit(ctx,{...req,task:'image-to-video',inputs:[{role:'first-frame',bytes:new Uint8Array([97]),mimeType:'image/png'}]});
 assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)),{instances:[{prompt:'a cat',image:{bytesBase64Encoded:'YQ==',mimeType:'image/png'}}],parameters:{}});
});
