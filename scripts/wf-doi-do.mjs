// Doi bo trang phuc cho ca mot workflow chi bang mot lenh.
//
//   node scripts/wf-doi-do.mjs <sessionId> <nhanh> "<mo ta bo do>"
//   node scripts/wf-doi-do.mjs s_01M30... hong "the oversized dusty-pink button-up shirt worn open over a BLACK AND WHITE checked plaid tube top, and a brown utility mini skirt with cargo pockets, plain white sneakers"
//
// VI SAO CAN MO TA BANG CHU, KHONG CHI DUA ANH THAM CHIEU:
// Da thu hai cach viet "chung chung" (chi anh tham chieu ma khong goi ten mon
// do) - ca hai deu HONG: mot lan mo hinh nhuom hong bo do cu tren anh nen, mot
// lan giu nguyen do cu. Anh tham chieu giup giu CHI TIET (hoa tiet, tui, nep
// vai) nhung khong quyet dinh duoc MAC CAI GI. Cai quyet dinh la chu.
//
// Nen khuon nay giu nguyen moi thu (goc may, dia diem, cach giu mat mui) va chi
// thay dung doan mo ta bo do o tat ca cac node cua mot nhanh.

import { pathToFileURL } from 'node:url';

const SERVER = process.env.IMA2_SERVER || 'http://127.0.0.1:3333';

const GIU = 'Keep the exact same face, hair, body shape and skin tone as the base image. Do not restyle the person.';
const LUAT = 'Use the reference image to match the exact colour, pattern, fabric texture and cut of each garment. Each garment keeps its own colour - never let the colour of one piece bleed into another.';
const DIADIEM = 'LOCATION (keep identical in every shot): a warm cosy Korean-style coffee shop with pale oak wood furniture, white brick walls, tall arched windows with sheer linen curtains, brass pendant lights, a long marble counter with a chrome espresso machine, potted olive trees in the corners, soft morning sunlight across the floor.';
const DUOI = 'Natural candid fashion editorial style, shallow depth of field, photorealistic, no text, no watermark.';
const STUDIO = 'Standing in the same neutral studio pose as the base image, plain light grey seamless background, full body from head to shoes, photorealistic, no text.';

/** Dong tac cua tung canh - doi o day neu muon bo goc may khac. */
export const DONG_TAC = {
  1: 'Walking toward the camera, mid-stride, soft natural smile. Full body visible.',
  2: 'Walking past the counter seen from the side in profile, holding an iced drink. Full body visible.',
  3: 'Walking away toward the window, three-quarter rear view, head turned back over the shoulder, backlit. Full body visible.',
  4: 'Walking between the tables, low camera angle close to the floor looking slightly up. Full body visible.',
  5: 'Pushing the glass door open and stepping in, one hand on the door frame, seen from inside. Full body visible.',
  6: 'Standing at the counter ordering, three-quarter front angle, looking up at the menu board. Full body visible.',
  7: 'Sitting at a table by the window, legs crossed, holding a cup, looking outside. Shoes and legs visible.',
  8: 'Walking slowly while looking down at her phone, front three-quarter angle. Full body visible.',
  9: 'Sitting sideways on a high stool at the counter, one foot on the footrest, turning to look back at the camera. Full body visible.',
};

export const promptMacDo = (moTa) => `${GIU} She wears: ${moTa}. ${LUAT} ${STUDIO}`;
export const promptCanh = (moTa, dongTac) => `${GIU} She wears: ${moTa}. ${LUAT} ${dongTac} ${DIADIEM} ${DUOI}`;

async function api(duongDan, tuyChon = {}) {
  const res = await fetch(SERVER + duongDan, tuyChon);
  if (!res.ok) throw new Error(`${duongDan} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const [sessionId, nhanh, moTa] = process.argv.slice(2);
  if (!sessionId || !nhanh || !moTa) {
    console.error('Dung: node scripts/wf-doi-do.mjs <sessionId> <nhanh> "<mo ta bo do>"');
    console.error('  <nhanh>  hau to cua node, vi du "thu" hoac "hong"');
    process.exit(2);
  }

  const { session } = await api(`/api/sessions/${encodeURIComponent(sessionId)}`);
  if (!session) throw new Error('khong thay session');

  const nodes = session.nodes.map((n) => ({ ...n, data: { ...n.data } }));

  // Cac node canh cua nhanh nay.
  const canh = nodes.filter((n) => {
    const khop = /^canh-(.+)-(\d+)$/.exec(n.id);
    return khop && khop[1] === nhanh && DONG_TAC[Number(khop[2])];
  });

  // Node MAC DO khong phai luc nao cung ten "mac-<nhanh>" (nhanh dau tien ten la
  // "mac-do"). Do theo canh thay vi doan theo ten: cha chung cua cac node canh.
  // Moi node canh co HAI canh vao: base (anh nen) truoc, ref (trang phuc) sau.
  // Phai lay canh DAU TIEN. Dung new Map(...) thi cai sau de len cai truoc, hoa
  // ra tro vao node trang phuc va ghi de mat prompt trich cua no.
  const chaCua = new Map();
  for (const e of session.edges) if (!chaCua.has(e.target)) chaCua.set(e.target, e.source);
  const cha = [...new Set(canh.map((n) => chaCua.get(n.id)).filter(Boolean))];
  const macDo = cha.length === 1 ? nodes.find((n) => n.id === cha[0]) : null;

  let doi = 0;
  if (macDo) { macDo.data.prompt = promptMacDo(moTa); doi++; }
  for (const n of canh) {
    const so = Number(/^canh-.+-(\d+)$/.exec(n.id)[1]);
    n.data.prompt = promptCanh(moTa, DONG_TAC[so]);
    doi++;
  }
  if (!doi) throw new Error(`khong node nao thuoc nhanh "${nhanh}"`);

  const kq = await api(`/api/sessions/${encodeURIComponent(sessionId)}/graph`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': `"${session.graphVersion}"` },
    body: JSON.stringify({ nodes, edges: session.edges }),
  });
  console.log(`da doi mo ta bo do o ${doi} node (graphVersion: ${kq.graphVersion})`);
  console.log('bo do moi:', moTa);
}

// Tren Windows duong dan la "G:\..." nen file:// + argv[1] khong bao gio khop.
// pathToFileURL lo chuyen dung o moi he dieu hanh.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('LOI:', e.message); process.exitCode = 1; });
}
