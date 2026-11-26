import type { MediaProviderAdapter } from "../../contract.js";
import { MediaAdapterError, fail, normalizeUnknownError } from "../_l2/errors.js";
import { mingmou, pollVod, submitVod, vodCall } from "./vod.js";

export const adapter: MediaProviderAdapter = {
  id: "tencent-vod",
  label: "Tencent Cloud VOD AIGC",
  route: "direct",
  errorPrefix: "TENCENT_VOD",
  credential: {
    keyVocabulary: "tencent-vod",
    envVars: ["TENCENTCLOUD_SECRET_ID"],
    configKey: "tencentVodApiKey",
    consoleUrl: "https://console.tencentcloud.com/cam/capi",
    extraFields: [
      { name: "secretKey", envVar: "TENCENTCLOUD_SECRET_KEY", secret: true, required: true },
      { name: "vodSubAppId", envVar: "TENCENT_VOD_SUBAPPID", secret: false, required: true },
      { name: "region", envVar: "TENCENTCLOUD_REGION", secret: false, required: false },
    ],
  },
  inputTransport: "url",
  listModels: () => [mingmou],
  async validateKey(ctx) {
    const data = await vodCall(ctx, "DescribeSubAppIds", {}, ctx.extra?.region);
    if (!Array.isArray(data.SubAppIdInfoSet)) {
      fail("TENCENT_VOD", "BAD_RESPONSE", "upstream", "Invalid VOD application list response");
    }
    return { ok: true };
  },
  submit: submitVod,
  poll: pollVod,
  normalizeError(error) {
    const detail = normalizeUnknownError("TENCENT_VOD", error);
    return error instanceof MediaAdapterError ? detail : { ...detail, message: "Provider request failed" };
  },
};
