import type { Catalog, CatalogModel, CatalogProvider, MediaKind, MediaTask } from '../types.ts';

const entries: [string, string, MediaKind, MediaTask[]][] = [
  ['bytedance/seedance-2.5','Seedance 2.5','video',['text-to-video','image-to-video']],
  ['kling/kling-3','Kling Video v3 Pro','video',['text-to-video','image-to-video']],
  ['google/veo-3.1','Veo 3.1','video',['text-to-video','image-to-video']],
  ['minimax/minimax-h3','MiniMax H3','video',['text-to-video','image-to-video']],
  ['alibaba/wan-3.0','Wan 3.0','video',['text-to-video','image-to-video']],
  ['vidu/vidu-q4','Vidu v4','video',['text-to-video','reference-to-video']],
  ['pixverse/pixverse-v6','PixVerse V6','video',['text-to-video','image-to-video']],
  ['xai/grok-imagine-video-1.5','Grok Imagine Video 1.5','video',['text-to-video','image-to-video']],
  ['openai/gpt-image-2','ChatGPT Image 2','image',['text-to-image','image-to-image']],
  ['black-forest-labs/flux-kontext-max','Flux Kontext Max','image',['text-to-image','image-to-image']],
  ['ideogram/ideogram-v4.5','Ideogram 4.5','image',['text-to-image']],
  ['recraft/recraft-v4.1','Recraft V4.1','image',['text-to-image','image-to-image']],
  ['topaz-labs/topaz-upscale','Topaz Image Upscale','image',['image-upscale']],
  ['sync/sync-lipsync-3','Sync Lipsync 3','video',['lipsync']],
  ['heygen/heygen-avatar-6','HeyGen Avatar 6','video',['avatar']],
  ['mirelo/mirelo-sfx-2.0','Mirelo SFX 2.0','audio',['text-to-audio','video-to-audio']],
  ['google/nano-banana-pro','Nano Banana Pro','image',['text-to-image','image-to-image']],
  ['bytedance/seedream-5.5','Seedream 5.5','image',['text-to-image','image-to-image']],
  ['xai/grok-image','Grok Imagine','image',['text-to-image','image-to-image']],
  ['ideogram/ideogram-vectorize','Ideogram Vectorize','image',['image-vectorize']],
  ['topaz-labs/topaz-video','Topaz Video','video',['video-upscale']],
  ['kling/kling-lipsync','Kling Lipsync','video',['lipsync']],
  ['vidu/vidu-q4-reference','Vidu v4 Reference','video',['reference-to-video']],
  ['pixverse/pixverse-c1','PixVerse C1','video',['text-to-video','image-to-video']],
];
const sites: Record<string,string> = { openai:'https://platform.openai.com/', google:'https://aistudio.google.com/', xai:'https://console.x.ai/', fal:'https://fal.ai/', replicate:'https://replicate.com/', kling:'https://klingai.com/', bytedance:'https://www.byteplus.com/', 'black-forest-labs':'https://bfl.ai/', alibaba:'https://www.alibabacloud.com/', minimax:'https://www.minimax.io/', vidu:'https://www.vidu.com/', pixverse:'https://pixverse.ai/', ideogram:'https://ideogram.ai/', recraft:'https://www.recraft.ai/', 'topaz-labs':'https://www.topazlabs.com/', sync:'https://sync.so/', heygen:'https://www.heygen.com/', mirelo:'https://mirelo.ai/' };

export function makeCatalog(keyed: Set<string>): Catalog {
  const ids = [...new Set(entries.map(([id]) => id.split('/')[0]!)), 'fal', 'replicate'];
  const providers: CatalogProvider[] = ids.map(id => ({ id, label: id, route: id === 'fal' || id === 'replicate' ? 'aggregator' : 'direct', keyVocabulary: id, consoleUrl: sites[id]!, keyConfigured: keyed.has(id), ...(id === 'bytedance' ? { extraFields: [{ name: 'region', secret: false, required: false }] } : {}) }));
  const models: CatalogModel[] = entries.map(([id,label,kind,tasks], index) => {
    const vendor = id.split('/')[0]!;
    const pricing = index === 13 || index === 15 ? [] : [{ unit: kind === 'video' ? 'second' as const : 'image' as const, usd: kind === 'video' ? 0.05 : 0.03, source: 'fixture:fake', checkedAt: '2026-11-26' }];
    return { id, vendor, label, kind, tasks, params: { durationsSec: [2,5,10], resolutions: ['720p','1080p'], aspectRatios: ['1:1','16:9','9:16'], maxReferenceImages: 3, maxReferenceVideos: 1, nativeAudio: kind === 'video', seed: true }, routes: [vendor,'fal','replicate'].map(providerId => ({ providerId, route: providerId === vendor ? 'direct' : 'aggregator', label: providerId, upstreamId: id, pricing, docsUrl: sites[providerId]!, keyConfigured: keyed.has(providerId) })) };
  });
  return { providers, models };
}
