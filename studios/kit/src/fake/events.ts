import type { IncomingMessage, ServerResponse } from "node:http";
type Entry = { id: number; event: string; data: Record<string, unknown> };
export class EventRing {
  private next = 1;
  private ring: Entry[] = [];
  private clients = new Set<ServerResponse>();
  private readonly scrub: <T>(value: T) => T;
  constructor(scrub: <T>(value: T) => T) {
    this.scrub = scrub;
  }
  private wire(entry: Entry): string {
    return `id: ${entry.id}\nevent: ${entry.event}\ndata: ${JSON.stringify(this.scrub(entry.data))}\n\n`;
  }
  emit(event: string, data: Record<string, unknown>): void {
    const entry = { id: this.next++, event, data: structuredClone(data) };
    this.ring.push(entry);
    if (this.ring.length > 100) this.ring.shift();
    for (const client of this.clients) client.write(this.wire(entry));
  }
  connect(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": connected\n\n");
    const header = req.headers["last-event-id"],
      cursor = header === undefined ? null : Number(header),
      first = this.ring[0]?.id;
    if (cursor !== null && Number.isFinite(cursor) && first !== undefined && cursor < first - 1)
      res.write("event: replay-gap\ndata: {}\n\n");
    if (cursor !== null && Number.isFinite(cursor))
      for (const entry of this.ring) if (entry.id > cursor) res.write(this.wire(entry));
    this.clients.add(res);
    const timer = setInterval(() => res.write(": ping\n\n"), 15000);
    res.on("close", () => {
      clearInterval(timer);
      this.clients.delete(res);
    });
  }
  close(): void {
    for (const client of this.clients) client.end();
  }
}
