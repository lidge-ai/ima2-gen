import { createHash, createSign } from 'node:crypto';
import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest } from '../contract.js';
import { assertAllowed, findModel, fromBase64, httpJson, invalidRequest, MediaHttpError, normalizeMediaError, protocolError, readVendorOptions, toBase64 } from './l3-http.js';

const docs='https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate';
const models: readonly MediaModelSpec[] = ['veo-3.1','veo-3.1-fast','veo-3.1-lite'].map((name, i) => ({
 id:'google/'+name, upstreamId:['veo-3.1-generate-001','veo-3.1-fast-generate-001','veo-3.1-lite-generate-001'][i]!, vendor:'google', label:name, kind:'video', tasks:i===2?['text-to-video','image-to-video']:['text-to-video','image-to-video','reference-to-video'],
 params:{durationsSec:[4,6,8],resolutions:i===0?['720p','1080p','4k']:['720p','1080p'],aspectRatios:['16:9','9:16'],nativeAudio:true,negativePrompt:true,seed:true},pricing:[],docsUrl:docs,
}));
interface Account { type: string; project_id: string; client_email: string; private_key: string }
const cache = new Map<string,{token:string; until:number}>();
function account(ctx:MediaAdapterContext):Account {
 let a:Account;
 try { a=JSON.parse(ctx.apiKey) as Account; } catch { throw invalidRequest('Invalid service account JSON'); }
 if (a.type !== 'service_account' || !a.client_email || !a.private_key || !/^[a-z0-9-]+$/.test(a.project_id ?? '')) throw invalidRequest('Invalid service account fields');
 return a;
}
function location(ctx:MediaAdapterContext):string {
 const loc=ctx.extra?.location ?? 'us-central1'; if (loc !== 'us-central1') throw invalidRequest('Unsupported Vertex location'); return loc;
}
function modelPath(a:Account, loc:string, model:string):string { return `/projects/${a.project_id}/locations/${loc}/publishers/google/models/${model}`; }
function root(ctx:MediaAdapterContext,loc:string):string { return (ctx.baseUrl ?? `https://${loc}-aiplatform.googleapis.com/v1`).replace(/\/$/,''); }
function jwt(a:Account):string {
 const now=Math.floor(Date.now()/1000);
 const enc=(v:unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
 const parts=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:a.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 try { return parts+'.'+createSign('RSA-SHA256').update(parts).sign(a.private_key,'base64url'); }
 catch { throw invalidRequest('Invalid service account private key'); }
}
async function token(ctx:MediaAdapterContext,a:Account):Promise<string> {
 const id=a.client_email+':'+createHash('sha256').update(ctx.apiKey).digest('hex'); const old=cache.get(id);
 if (old && old.until>Date.now()) return old.token;
 const assertion=jwt(a); const payload=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion});
 let res:{access_token?:string;expires_in?:number};
 try { res=await httpJson(ctx,'Google token','https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:payload.toString()}); }
 catch (error) { if (error instanceof MediaHttpError) throw new MediaHttpError({message:'Google token request failed',reason:error.reason,category:error.category,retryable:error.retryable,...(error.status === undefined ? {} : {status:error.status})}); throw new Error('Google token request failed'); }
 if (!res.access_token || typeof res.expires_in !== 'number') throw protocolError('Token response missing credentials');
 cache.set(id,{token:res.access_token,until:Date.now()+Math.max(0,res.expires_in-60)*1000}); return res.access_token;
}
async function call<T>(ctx:MediaAdapterContext,a:Account,url:string,method:'GET'|'POST',json?:unknown):Promise<T> {
 const access=await token(ctx,a);
 const safeCtx:MediaAdapterContext={...ctx,apiKey:access,extra:{...(ctx.extra??{}),serviceJson:ctx.apiKey,privateKey:a.private_key}};
 try { return await httpJson<T>(safeCtx,'Vertex request',url,{method,headers:{Authorization:'Bearer '+access},...(json===undefined?{}:{json}),secretExtras:['serviceJson','privateKey']}); }
 catch (error) { if (error instanceof MediaHttpError) throw new MediaHttpError({message:'Vertex request failed',reason:error.reason,category:error.category,retryable:error.retryable,...(error.status === undefined ? {} : {status:error.status})}); throw new Error('Vertex request failed'); }
}
function payload(req:MediaSubmitRequest,spec:MediaModelSpec):unknown {
 readVendorOptions(req,[]); if (!spec.tasks.includes(req.task)) throw invalidRequest('Unsupported task');
 assertAllowed('durationSec',req.durationSec,spec.params.durationsSec); assertAllowed('resolution',req.resolution,spec.params.resolutions); assertAllowed('aspectRatio',req.aspectRatio,spec.params.aspectRatios);
 if (req.audio!==undefined || (req.count!==undefined && (!Number.isInteger(req.count)||req.count<1||req.count>4)) || (req.seed!==undefined && (!Number.isInteger(req.seed)||req.seed<0||req.seed>4294967295))) throw invalidRequest('Invalid parameter');
 if ((req.task==='text-to-video' && req.inputs.length) || (req.task==='image-to-video' && (req.inputs.length!==1 || req.inputs[0]?.role!=='first-frame')) || (req.task==='reference-to-video' && (req.inputs.length<1 || req.inputs.length>3 || req.inputs.some(i=>i.role!=='reference-image') || (req.durationSec!==undefined && req.durationSec!==8)))) throw invalidRequest('Invalid inputs');
 const instance:Record<string,unknown>={prompt:req.prompt ?? ''};
 const images=req.inputs.map(input=>{ if (!input.bytes || !['image/jpeg','image/png'].includes(input.mimeType)) throw invalidRequest('Inline JPEG or PNG required'); return {bytesBase64Encoded:toBase64(input.bytes),mimeType:input.mimeType}; });
 if (req.task==='image-to-video') instance.image=images[0];
 if (req.task==='reference-to-video') instance.referenceImages=images.map(image=>({image,referenceType:'asset'}));
 const parameters:Record<string,unknown>={};
 for (const [key,val] of Object.entries({durationSeconds:req.durationSec,resolution:req.resolution,aspectRatio:req.aspectRatio,negativePrompt:req.negativePrompt,seed:req.seed,sampleCount:req.count})) if (val!==undefined) parameters[key]=val;
 return {instances:[instance],parameters};
}
interface Operation {name?:string;done?:boolean;error?:unknown;response?:{videos?:Array<{bytesBase64Encoded?:string;mimeType?:string}>}}
function operationState(op:Operation):MediaJobState {
 if (!op.done) return {status:'running'};
 if (op.error) return {status:'failed',error:normalizeMediaError('GOOGLE_VERTEX',protocolError('Vertex operation failed'))};
 const videos=op.response?.videos;
 if (!videos?.length || videos.some(v=>!v.bytesBase64Encoded)) return {status:'failed',error:normalizeMediaError('GOOGLE_VERTEX',protocolError('Vertex returned no inline video'))};
 return {status:'succeeded',outputs:videos.map(v=>({kind:'video',bytes:fromBase64(v.bytesBase64Encoded!),mimeType:v.mimeType ?? 'video/mp4'}))};
}
export const adapter:MediaProviderAdapter={
 id:'google-vertex',label:'Google Vertex AI',route:'direct',errorPrefix:'GOOGLE_VERTEX',inputTransport:'inline',
 credential:{keyVocabulary:'google-vertex',configKey:'vertexServiceAccountJson',envVars:['VERTEX_SERVICE_ACCOUNT_JSON'],consoleUrl:'https://console.cloud.google.com/iam-admin/serviceaccounts',extraFields:[{name:'location',envVar:'VERTEX_LOCATION',secret:false,required:false}]},
 listModels:()=>models,
 async validateKey(ctx) { const a=account(ctx),loc=location(ctx); try { await call(ctx,a,root(ctx,loc)+modelPath(a,loc,models[0]!.upstreamId),'GET'); return {ok:true}; } catch(error) { if(error instanceof MediaHttpError && (error.status===401 || error.status===403)) return {ok:false,reason:'Invalid or unauthorized service account'}; throw error; } },
 async submit(ctx,req) { const spec=findModel(models,req.model), data=payload(req,spec), a=account(ctx),loc=location(ctx),path=modelPath(a,loc,spec.upstreamId); const result=await call<Operation>(ctx,a,root(ctx,loc)+path+':predictLongRunning','POST',data); if(!result.name?.startsWith(path.slice(1)+'/operations/') || !/^[a-zA-Z0-9/_.-]+$/.test(result.name)) throw protocolError('Invalid operation name'); return {providerJobId:result.name,resume:{model:spec.upstreamId}}; },
 async poll(ctx,job:MediaJobRef) { const a=account(ctx),loc=location(ctx),spec=models.find(m=>m.upstreamId===job.resume?.model); if(!spec) throw invalidRequest('Invalid operation model'); const path=modelPath(a,loc,spec.upstreamId); if(!job.providerJobId.startsWith(path.slice(1)+'/operations/') || !/^[a-zA-Z0-9/_.-]+$/.test(job.providerJobId)) throw invalidRequest('Invalid operation name'); return operationState(await call<Operation>(ctx,a,root(ctx,loc)+path+':fetchPredictOperation','POST',{operationName:job.providerJobId})); },
 normalizeError(error) { return error instanceof MediaHttpError ? normalizeMediaError('GOOGLE_VERTEX',new MediaHttpError({message:'Vertex request failed',reason:error.reason,category:error.category,retryable:error.retryable,...(error.status === undefined ? {} : {status:error.status})})) : normalizeMediaError('GOOGLE_VERTEX',new Error('Vertex request failed')); },
};
