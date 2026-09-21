/**
 * Hop dong su kien cua luot chay khuon - DUNG CHUNG cho may chu va giao dien.
 *
 * Mot khuon kich hoat qua API chay o may chu, nhung nguoi dung van dang mo giao
 * dien va muon thay no chay. Kenh /api/events co san duoc dung lai o day thay vi
 * de giao dien hoi lien tuc.
 *
 * Kenh su kien loc theo `jobId`, ma giao dien thi KHONG biet truoc ma cua mot
 * luot chay do he thong khac goi vao. Nen moi su kien khuon deu di duoi cung mot
 * `jobId` co dinh, con ma luot chay nam trong than su kien.
 */

/** `jobId` co dinh cua moi su kien khuon. */
export const WF_KENH = "wf";

export const WF_SU_KIEN = {
  batDau: "wf_start",
  buoc: "wf_step",
  ketThuc: "wf_end",
} as const;

export type WfSuKienBatDau = {
  jobId: typeof WF_KENH;
  runId: string;
  sessionId: string;
  startNodeId: string;
  tong: number;
  buoc: { nodeId: string; viec: string }[];
};

export type WfSuKienBuoc = {
  jobId: typeof WF_KENH;
  runId: string;
  sessionId: string;
  startNodeId: string;
  nodeId: string;
  trangThai: string;
  /** Chi co khi buoc da xong: media node do vua sinh ra. */
  url?: string;
  loai?: "anh" | "video";
  loi?: string;
  daXong: number;
  tong: number;
};

export type WfSuKienKetThuc = {
  jobId: typeof WF_KENH;
  runId: string;
  sessionId: string;
  startNodeId: string;
  trangThai: string;
  daXong: number;
  tong: number;
  loi?: { code: string; message: string; nodeId?: string };
};
