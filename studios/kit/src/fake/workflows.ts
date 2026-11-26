import { estimateCost, sumEstimates } from '../pricing.ts';
import { chooseRoute } from '../routing.ts';
import type { Catalog, WorkflowDef, WorkflowEstimate, WorkflowRunBody } from '../types.ts';

const names = ['remix-motion-transfer','remix-subject-swap','remix-restyle','director-studio','director-cast','director-locations','director-cinema'];
export const workflows: WorkflowDef[] = names.map(id => ({
  id, family: id.startsWith('remix') ? 'remix' : 'director', label: id.split('-').map(x => x[0]!.toUpperCase() + x.slice(1)).join(' '), description: 'Create a scene from source material and a creative direction.', output: 'video',
  inputs: [{ name:'source', label:'Source video', kind:'video', role:'source-video', required:id.startsWith('remix'), accept:'video/*' }, { name:'reference', label:'Reference image', kind:'image', role:'reference-image', required:false, accept:'image/*' }, { name:'prompt', label:'Creative direction', kind:'text', required:true }],
  params: [{ name:'duration', label:'Duration', type:'select', options:[{value:'5',label:'5 seconds'},{value:'10',label:'10 seconds'}], default:'5' }],
  steps: [{ id:'prepare', label:'Prepare reference', model:'openai/gpt-image-2' }, { id:'animate', label:'Animate scene', model:'bytedance/seedance-2.5' }],
}));
export function estimateWorkflow(def: WorkflowDef, body: WorkflowRunBody, catalog: Catalog): WorkflowEstimate {
  const steps = def.steps.map(step => {
    const model = catalog.models.find(m => m.id === (body.steps?.[step.id]?.model ?? step.model));
    const choice = model && chooseRoute(model, body.steps?.[step.id]?.provider);
    const pricing = choice && choice.kind !== 'unavailable' ? choice.route.pricing : [];
    return { id: step.id, estimate: estimateCost(pricing, { durationSec: Number(body.params?.duration ?? 5) }) };
  });
  return { steps, total: sumEstimates(steps.map(s => s.estimate)) };
}
