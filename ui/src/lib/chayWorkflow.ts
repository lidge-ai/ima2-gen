/**
 * Chuoi chay cua mot khuon: tu node BAT DAU den node KET THUC.
 *
 * Node MOC khong sinh gi ca - chung chi noi cho may biet dau la mot khuon hoan
 * chinh. Bam chay tren MOC DAU thi moi node nam sau no duoc chay LAN LUOT theo
 * dung thu tu phu thuoc, cho xong node truoc roi moi sang node sau. Phai cho
 * that su: node sau an anh cua node truoc, chay song song thi node sau lay
 * nham anh cu.
 *
 * Toan bo phan tinh toan nam o lib/wfChain.ts, dung chung voi may chu - mot
 * khuon kich hoat qua API phai chay dung thu tu ma giao dien bay ra.
 */
export {
  dauVaoVideoCuaNode,
  dienOTrong,
  laViecThat,
  nodeChaDau,
  oTrongCuaKhuon,
  oTrongTrongVanBan,
  timChuoiChay,
  viecCuaNode,
  type KetQuaChuoi,
  type LoaiViec,
  type LoiChuoi,
} from "../../../lib/wfChain.js";
