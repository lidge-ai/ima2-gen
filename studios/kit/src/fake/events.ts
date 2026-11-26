import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Job, JobEventName } from '../types.ts';

export class EventRing {
  private next = 1;
  private ring: { id: number; event: JobEventName; job: Job }[] = [];
  constructor(privateScrub: <T>(value: T) => T) { this.scrub=privateScrub; }
  private readonly scrub: <T>(value: T) => T;
  private wire(id: number, event: JobEventName, job: Job): string { return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(this.scrub({jobId:job.jobId,job}))}\n\n`; }
  private clients = new Set<ServerResponse>();
  emit(event: JobEventName, job: Job): void {
    const id = this.next++;
    const snapshot=structuredClone(job);
    const wire=this.wire(id,event,snapshot);
    this.ring.push({id,event,job:snapshot});
    if (this.ring.length > 100) this.ring.shift();
    for (const client of this.clients) client.write(wire);
  }
  connect(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
    res.write(': connected\n\n');
    const cursor = Number(req.headers['last-event-id'] ?? 0);
    const first = this.ring[0]?.id;
    if (cursor > 0 && first !== undefined && cursor < first - 1) res.write('event: replay-gap\ndata: {}\n\n');
    if (cursor > 0) for (const event of this.ring) if (event.id > cursor) res.write(this.wire(event.id,event.event,event.job));
    this.clients.add(res);
    const timer = setInterval(() => res.write(': ping\n\n'), 15000);
    res.on('close', () => { clearInterval(timer); this.clients.delete(res); });
  }
  close(): void { for (const client of this.clients) client.end(); }
}
