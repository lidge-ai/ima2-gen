import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chooseRoute } from '../routing.ts';
import type { MediaSubmitBody, WorkflowRunBody } from '../types.ts';
import { makeCatalog } from './catalog.ts';
import { historyPage } from './history.ts';
import { workflows, estimateWorkflow } from './workflows.ts';
import type { Jobs } from './jobs.ts';
import type { Keys } from './keys.ts';

class Fault extends Error {
  readonly status: number; readonly code: string; readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) { super(message); this.status=status; this.code=code; this.details=details; }
}
const invalid = () => new Fault(400,'MEDIA_INVALID_REQUEST','Invalid request');
const missing = () => new Fault(404,'NOT_FOUND','Not found');
async function body(req: IncomingMessage): Promise<Buffer> { const chunks: Buffer[]=[]; for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array)); return Buffer.concat(chunks); }
async function json(req: IncomingMessage): Promise<Record<string,unknown>> {
  try { const parsed: unknown=JSON.parse((await body(req)).toString()); if (!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw invalid(); return parsed as Record<string,unknown>; } catch { throw invalid(); }
}
const scrubbers = new WeakMap<ServerResponse, Keys>();
function send(res: ServerResponse, status: number, value?: unknown): void { res.statusCode=status; if (value===undefined) {res.end();return;} res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(scrubbers.get(res)?.scrub(value) ?? value)); }
function file(req: IncomingMessage, res: ServerResponse, data: Buffer, mime: string): void {
  res.setHeader('Content-Type',mime); res.setHeader('Accept-Ranges','bytes');
  const range=req.headers.range;
  if (!range) {res.setHeader('Content-Length',data.length);res.end(data);return;}
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) {res.setHeader('Content-Range',`bytes */${data.length}`);send(res,416,{error:{code:'INVALID_RANGE',message:'Range not satisfiable'}});return;}
  const start=match[1] ? Number(match[1]) : Math.max(0,data.length-Number(match[2]));
  const end=match[1] && match[2] ? Math.min(Number(match[2]),data.length-1) : data.length-1;
  if (start>=data.length || start>end) {res.setHeader('Content-Range',`bytes */${data.length}`);send(res,416,{error:{code:'INVALID_RANGE',message:'Range not satisfiable'}});return;}
  res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':end-start+1});res.end(data.subarray(start,end+1));
}
function routeFor(modelId: string, provider: string | undefined, keys: Keys) {
  const model=makeCatalog(keys.keyed).models.find(m=>m.id===modelId);
  if (!model) throw new Fault(404,'MEDIA_MODEL_UNKNOWN','Unknown model');
  if (provider && !model.routes.some(r=>r.providerId===provider)) throw invalid();
  const choice=chooseRoute(model,provider);
  if (choice.kind==='needs-key') throw new Fault(409,'MEDIA_KEY_MISSING','Provider key required',{ candidates:choice.candidates.map(r=>r.providerId) });
  if (choice.kind==='unavailable') throw new Fault(409,'MEDIA_KEY_MISSING','Provider key required',{candidates:[]});
  return {model,route:choice.route};
}
async function mediaSubmit(req: IncomingMessage, res: ServerResponse, jobs: Jobs, keys: Keys): Promise<void> {
  const raw=await json(req), request=keys.scrub(raw) as unknown as MediaSubmitBody;
  if (typeof request.model!=='string' || typeof request.task!=='string' || !Array.isArray(request.inputs) || (request.provider!==undefined && typeof request.provider!=='string') || (request.clientRequestId!==undefined && typeof request.clientRequestId!=='string') || (request.prompt!==undefined && typeof request.prompt!=='string')) throw invalid();
  if (request.inputs.some(input => !input || typeof input!=='object' || typeof input.role!=='string' || !('inputId' in input ? typeof input.inputId==='string' : 'url' in input && typeof input.url==='string'))) throw invalid();
  if (request.clientRequestId && jobs.tokens.has(request.clientRequestId)) {send(res,202,jobs.tokens.get(request.clientRequestId));return;}
  const {model,route}=routeFor(request.model,request.provider,keys);
  if (!model.tasks.includes(request.task)) throw invalid();
  send(res,202,jobs.start(model.id,route.providerId,request,model.kind));
}
async function workflowRoute(req: IncomingMessage, res: ServerResponse, parts: string[], jobs: Jobs, keys: Keys): Promise<void> {
  const def=workflows.find(w=>w.id===parts[2]); if (!def) throw missing();
  const request=keys.scrub(await json(req)) as unknown as WorkflowRunBody;
  if (!request.inputs || typeof request.inputs!=='object' || Array.isArray(request.inputs)) throw invalid();
  if (def.inputs.some(input => input.required && (!request.inputs[input.name] || request.inputs[input.name]?.length === 0))) throw invalid();
  if (parts[3]==='estimate') {send(res,200,estimateWorkflow(def,request,makeCatalog(keys.keyed)));return;}
  if (request.clientRequestId && jobs.tokens.has(request.clientRequestId)) {send(res,202,jobs.tokens.get(request.clientRequestId));return;}
  const routes=def.steps.map(step=>routeFor(request.steps?.[step.id]?.model ?? step.model!,request.steps?.[step.id]?.provider,keys));
  const estimate=estimateWorkflow(def,request,makeCatalog(keys.keyed));
  const resolved={...def,steps:def.steps.map((step,index)=>({...step,model:routes[index]!.model.id}))};
  send(res,202,jobs.start(def.id,routes[0]!.route.providerId,request,def.output,resolved,estimate));
}
async function keyRoute(req: IncomingMessage, res: ServerResponse, parts: string[], keys: Keys): Promise<void> {
  const provider=makeCatalog(keys.keyed).providers.find(p=>p.keyVocabulary===parts[3]); if (!provider) throw missing();
  if (req.method==='PUT') { const data=await json(req); if (typeof data.apiKey!=='string' || !data.apiKey) throw invalid(); keys.secrets.add(data.apiKey); if (data.extra && typeof data.extra==='object') for(const value of Object.values(data.extra)) if(typeof value==='string' && value) keys.secrets.add(value); keys.extras.set(provider.id,new Set(data.extra && typeof data.extra==='object' ? Object.keys(data.extra) : [])); keys.keyed.add(provider.id); send(res,200,{key:keys.status(provider),validation:{ok:true}}); return; }
  if (req.method==='DELETE') {keys.keyed.delete(provider.id);keys.extras.delete(provider.id);send(res,204);return;}
  if (req.method==='POST' && parts[4]==='validate') {send(res,200,keys.keyed.has(provider.id)?{ok:true}:{ok:false,reason:'Key not configured'});return;}
  throw missing();
}
async function dispatch(req: IncomingMessage, res: ServerResponse, jobs: Jobs, keys: Keys): Promise<void> {
  const url=new URL(req.url ?? '/', 'http://localhost'), p=url.pathname.split('/').filter(Boolean), method=req.method;
  if (method==='GET' && url.pathname==='/api/events') {jobs.events.connect(req,res);return;}
  if (method==='GET' && p[0]==='files') {const found=jobs.files.get(p[1] ?? '');if(!found) throw missing();file(req,res,found.data,found.mime);return;}
  if (method==='GET' && url.pathname==='/api/media/catalog') {send(res,200,makeCatalog(keys.keyed));return;}
  if (method==='GET' && url.pathname==='/api/media/keys') {send(res,200,{keys:makeCatalog(keys.keyed).providers.map(p=>keys.status(p))});return;}
  if (p[1]==='media' && p[2]==='keys' && p[3]) {await keyRoute(req,res,p,keys);return;}
  if (method==='POST' && url.pathname==='/api/media/uploads') {const data=await body(req),inputId=randomUUID(),mime=req.headers['content-type'] ?? 'application/octet-stream';jobs.files.set(inputId,{data,mime});send(res,201,{inputId,mimeType:mime,bytes:data.length,url:'/files/'+inputId});return;}
  if (method==='POST' && url.pathname==='/api/media') {await mediaSubmit(req,res,jobs,keys);return;}
  if (p[1]==='media' && p[2]==='jobs') {jobRoute(req,res,p,url,jobs);return;}
  if (p[1]==='media' && p[2]==='history') {await historyRoute(req,res,p,url,jobs);return;}
  if (method==='GET' && url.pathname==='/api/workflows') {send(res,200,{workflows});return;}
  if (method==='POST' && p[1]==='workflows' && p[2]) {await workflowRoute(req,res,p,jobs,keys);return;}
  throw missing();
}
function jobRoute(req: IncomingMessage,res: ServerResponse,p: string[],url: URL,jobs: Jobs): void {
  if (!p[3] && req.method==='GET') {const active=url.searchParams.get('status')!=='all';const limit=Number(url.searchParams.get('limit')) || 100;send(res,200,{jobs:[...jobs.jobs.values()].filter(j=>!active || j.status==='queued' || j.status==='running').slice(0,limit)});return;}
  const job=jobs.jobs.get(p[3] ?? '');if(!job) throw missing();
  if(req.method==='GET' && !p[4]) {send(res,200,job);return;}
  if(req.method==='POST' && p[4]==='cancel') {jobs.cancel(job);send(res,200,{job});return;}
  throw missing();
}
async function historyRoute(req: IncomingMessage,res: ServerResponse,p: string[],url: URL,jobs: Jobs): Promise<void> {
  if(req.method==='GET' && !p[3]) {send(res,200,historyPage(jobs.history,url.searchParams));return;}
  const index=jobs.history.findIndex(item=>item.historyId===p[3]);if(index<0) throw missing();
  if(req.method==='DELETE' && !p[4]) {jobs.history.splice(index,1);send(res,204);return;}
  if(req.method==='POST' && p[4]==='favorite') {const data=await json(req);if(typeof data.favorite!=='boolean') throw invalid();jobs.history[index]!.favorite=data.favorite;send(res,200,{item:jobs.history[index]});return;}
  throw missing();
}
export async function router(req: IncomingMessage,res: ServerResponse,jobs: Jobs,keys: Keys): Promise<void> {
  scrubbers.set(res,keys);
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,Last-Event-ID,X-Ima2-Filename');
  if(req.method==='OPTIONS') {send(res,204);return;}
  try {await dispatch(req,res,jobs,keys);} catch(error) {const fault=error instanceof Fault ? error : new Fault(500,'INTERNAL_ERROR','Internal error');send(res,fault.status,{error:keys.scrub({code:fault.code,message:fault.message,...(fault.details===undefined?{}:{details:fault.details})})});}
}
