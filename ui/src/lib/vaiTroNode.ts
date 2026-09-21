/**
 * Vai tro cua node trong mot khuon chup.
 *
 * Node Studio von chi co mot loai node chung: anh vao, prompt, anh ra. Trong mot
 * khuon thi moi node lai lam mot viec khac han nhau, ma nhin vao thi giong het -
 * nguoi dung khong biet node nao sua duoc, node nao dung yen.
 *
 * Nen danh dau vai tro, va voi nhung vai tro CO PROMPT CO DINH thi khoa o nhap
 * lai: prompt do da dung roi, sua vao chi lam hong.
 */

export type VaiTroNode =
  | "bat-dau"
  | "mau"
  | "trang-phuc"
  | "mac-do"
  | "canh"
  | "video"
  | "gop-anh"
  | "gop-video"
  | "ket-thuc";

export type MoTaVaiTro = {
  nhan: string;
  /** Prompt co dinh - nguoi dung khong can va khong nen sua. */
  promptCoDinh?: string;
  mau: string;
  /**
   * Node MOC chi danh dau dau/cuoi cua mot khuon: khong prompt, khong anh,
   * khong goi mo hinh. Bam chay tren MOC DAU thi ca khuon chay mot luot.
   */
  moc?: boolean;
};

/**
 * Prompt boc trang phuc. KHONG goi ten mon do nao, nen dinh anh nao thi ra bo do
 * do - da kiem: dua anh nguoi mac bo kem vao thi no boc ra dung bo kem.
 */
export const PROMPT_BOC_TRANG_PHUC =
  "Fashion flat lay product photograph on a pure white background, shot from directly above. "
  + "Look at the reference photograph(s) and extract EVERY garment and accessory the person is wearing. "
  + "Lay each piece out flat and separately on the white background, reproducing each one exactly as it "
  + "appears in the reference: same colour, same pattern, same fabric texture, same cut, same length. "
  + "Do not invent items that are not in the reference, and do not leave any out. Arrange the pieces "
  + "neatly with clear space around each item. Clean e-commerce product photography, soft even shadowless "
  + "lighting, sharp focus, photorealistic, pure white seamless background, no people, no mannequin, "
  + "no hangers, no text, no watermark.";

export const VAI_TRO: Record<VaiTroNode, MoTaVaiTro> = {
  // Hai moc nam o hai dau danh sach vi trong khuon chung cung nam o hai dau.
  "bat-dau": { nhan: "BẮT ĐẦU", mau: "#1f7a3a", moc: true },
  "mau": { nhan: "MẪU", mau: "#6b7cff" },
  "trang-phuc": { nhan: "BÓC ĐỒ", promptCoDinh: PROMPT_BOC_TRANG_PHUC, mau: "#0f9d58" },
  "mac-do": { nhan: "MẶC ĐỒ", mau: "#e2622f" },
  "canh": { nhan: "CẢNH", mau: "#8a5326" },
  "video": { nhan: "VIDEO", mau: "#9334e6" },
  // Hai vai tro GOP khong goi mo hinh nao: chung chi thu gom, nen khong co
  // prompt va khong ton tien.
  "gop-anh": { nhan: "GỘP ẢNH", mau: "#0b8a8f" },
  "gop-video": { nhan: "GỘP VIDEO", mau: "#b3005e" },
  "ket-thuc": { nhan: "KẾT THÚC", mau: "#8a1f1f", moc: true },
};

export function layVaiTro(v: unknown): MoTaVaiTro | null {
  return typeof v === "string" && v in VAI_TRO ? VAI_TRO[v as VaiTroNode] : null;
}

/** Vai tro GOP: thu gom media tu cac canh vao, khong co prompt. */
export function laVaiTroGop(v: unknown): boolean {
  return v === "gop-anh" || v === "gop-video";
}

/** Moc dau / moc cuoi: khong sinh gi, chi dinh hinh mot khuon hoan chinh. */
export function laNodeMoc(v: unknown): boolean {
  return !!layVaiTro(v)?.moc;
}

/** Vai tro co prompt co dinh thi khoa o nhap prompt. */
export function khoaPrompt(v: unknown): boolean {
  return !!layVaiTro(v)?.promptCoDinh;
}
