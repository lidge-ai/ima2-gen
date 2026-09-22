export interface ImageGenOptions {
  model?: string | undefined;
  quality?: string | undefined;
  size?: string | undefined;
  moderation?: string | undefined;
  partial_images?: number | undefined;
  background?: string | undefined;
  output_format?: string | undefined;
}

export type ResponseTool = {
  type: string;
  model?: string | undefined;
  quality?: string | undefined;
  size?: string | undefined;
  moderation?: string | undefined;
  partial_images?: number | undefined;
  background?: string | undefined;
  output_format?: string | undefined;
};
export type ImageToolChoice = "required" | { type: "image_generation" };

export function tools(webSearchEnabled: boolean, imageOptions: ImageGenOptions): ResponseTool[] {
  return [
    ...(webSearchEnabled ? [{ type: "web_search" }] : []),
    { type: "image_generation", ...imageOptions },
  ];
}

export function toolTypes(requestTools: ResponseTool[]): string[] {
  return requestTools.map((tool) => tool.type);
}

export function imageToolChoice(forceImageTool: boolean): ImageToolChoice {
  return forceImageTool ? { type: "image_generation" } : "required";
}

export function imageToolChoiceKind(choice: ImageToolChoice): "required" | "image_generation" {
  return choice === "required" ? "required" : "image_generation";
}
