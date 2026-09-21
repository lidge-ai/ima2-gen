/**
 * Phan biet CANH ANH voi CANH THU TU.
 *
 * Node MOC (BAT DAU / KET THUC) khong bao gio sinh ra anh. Canh di ra tu mot moc
 * chi noi len "chay cai nay truoc", chu khong dua anh nao sang node sau.
 *
 * Neu khong tach ra thi moi cho tinh lai lich su anh deu coi moc la CHA: node
 * dau tien cua khuon se bi bao "sinh anh cha truoc da" va khong bao gio chay
 * duoc, con nhan base/ref tren canh thi dem ca canh moc vao.
 *
 * Phan tinh toan nam o lib/wfChain.ts vi MAY CHU cung chay dung logic nay khi
 * mot khuon duoc kich hoat qua API. Hai ban sao se lech nhau.
 */
export { canhAnhVao, laCanhThuTu, locCanhAnh } from "../../../lib/wfChain.js";
