import { startFakeServer } from './server.ts';
const server=await startFakeServer({port:Number(process.env.PORT ?? 8790)});
console.log(server.url);
