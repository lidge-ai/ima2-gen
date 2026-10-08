#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { main } from "./api88Demo.ts";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
