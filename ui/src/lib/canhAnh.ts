/**
 * Phan biet CANH ANH voi CANH THU TU.
 *
 * Node MOC (BAT DAU / KET THUC) khong bao gio sinh ra anh. Canh di ra tu mot moc
 * chi noi len "chay cai nay truoc", chu khong dua anh nao sang node sau.
 *
 * Neu khong tach ra thi moi cho tinh lai lich su anh deu coi moc la CHA: node
 * dau tien cua khuon se bi bao "sinh anh cha truoc da" va khong bao gio chay
 * duoc, con nhan base/ref tren canh thi dem ca canh moc vao.
 */
import { laNodeMoc } from "./vaiTroNode";

type NodeCoVaiTro = { id: string; data?: { vaiTro?: string } | undefined };
type CanhCoNguon = { source: string; target: string };

function tapMoc(nodes: readonly NodeCoVaiTro[]): Set<string> {
  const ra = new Set<string>();
  for (const n of nodes) if (laNodeMoc(n.data?.vaiTro)) ra.add(n.id);
  return ra;
}

/** Canh xuat phat tu mot node MOC: chi dinh thu tu chay, khong mang anh. */
export function laCanhThuTu(
  edge: CanhCoNguon,
  nodes: readonly NodeCoVaiTro[],
): boolean {
  return tapMoc(nodes).has(edge.source);
}

/** Bo moi canh thu tu, chi giu nhung canh thuc su dua anh di. */
export function locCanhAnh<E extends CanhCoNguon>(
  edges: readonly E[],
  nodes: readonly NodeCoVaiTro[],
): E[] {
  const moc = tapMoc(nodes);
  return moc.size === 0 ? [...edges] : edges.filter((e) => !moc.has(e.source));
}

/**
 * Canh ANH di vao mot node, giu nguyen thu tu goc: canh dau la anh nen, cac
 * canh sau la tham chieu.
 */
export function canhAnhVao<E extends CanhCoNguon>(
  edges: readonly E[],
  nodes: readonly NodeCoVaiTro[],
  targetId: string,
): E[] {
  const moc = tapMoc(nodes);
  return edges.filter((e) => e.target === targetId && !moc.has(e.source));
}
