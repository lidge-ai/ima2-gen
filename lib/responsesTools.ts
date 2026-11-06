import { isImage26Model } from "./oauthNormalize.js";

export interface ImageGenOptions {
  model?: string | undefined;
  complexity?: string | undefined;
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
  complexity?: string | undefined;
  quality?: string | undefined;
  size?: string | undefined;
  moderation?: string | undefined;
  partial_images?: number | undefined;
  background?: string | undefined;
  output_format?: string | undefined;
};
export type ImageToolChoice = "required" | { type: "image_generation" };

/**
 * The image_generation tool's model fields for an explicitly selected API image model.
 * complexity is a 2.6-only field. input_fidelity is never sent: 2.6 rejects it and
 * ima2 has no control for it on 2.5 either.
 */
export function apiImageToolFields(imageToolModel: string | undefined, complexity: string | undefined) {
  if (!imageToolModel) return {};
  return { model: imageToolModel, ...(complexity && isImage26Model(imageToolModel) ? { complexity } : {}) };
}

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
