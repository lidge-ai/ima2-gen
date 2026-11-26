import type { HistoryItem, HistoryPage } from '../types.ts';
export function historyPage(items: HistoryItem[], query: URLSearchParams): HistoryPage {
  const filtered=items.filter(item => ['kind','model','workflow'].every(k => !query.has(k) || String(item[k as 'kind'|'model'|'workflow'])===query.get(k)) && (!query.has('favorite') || Boolean(item.favorite)===(query.get('favorite')==='true')));
  const cursor=query.get('cursor'), index=cursor ? filtered.findIndex(item => item.historyId===cursor)+1 : 0;
  const limit=Math.max(1,Math.min(100,Number(query.get('limit')) || 20));
  const page=filtered.slice(index,index+limit);
  return {items:page,nextCursor:index+limit<filtered.length ? page.at(-1)!.historyId : null};
}
