import * as mediaApi from "./mediaApi.js";
import { MediaApiError } from "./mediaErrors.js";
import { assertNotAborted, projectCompletion, waitOptions, type HandlerOptions } from "./mcpMediaHandlers.js";

type Dict = Record<string, unknown>;
function object(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Dict : {};
}
async function run(base: string, args: Dict, options: HandlerOptions): Promise<Dict> {
  assertNotAborted(options.signal);
  const data = await mediaApi.workflowRun(base, String(args.id), object(args.values), object(args.selection), {
    requestId: String(args.requestId), wait: args.wait === true, ...waitOptions(args, options, 600),
  });
  return projectCompletion(data);
}
export async function handleWorkflow(base: string, name: string, args: Dict, options: HandlerOptions): Promise<Dict> {
  switch (name) {
    case "workflow_list": return mediaApi.workflows(base);
    case "workflow_schema": return mediaApi.workflowSchema(base, String(args.id));
    case "workflow_estimate": return mediaApi.workflowEstimate(base, String(args.id), object(args.values), object(args.selection));
    case "workflow_run": return run(base, args, options);
    default: throw new MediaApiError("MCP_TOOL_UNKNOWN", `Unknown workflow tool: ${name}`);
  }
}
