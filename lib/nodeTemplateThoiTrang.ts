/**
 * Kho khuon THOI TRANG: dau vao mot bo do, dau ra nguoi mau mac bo do do theo
 * tung concept chup.
 *
 * Moi khuon la mot day: MAU (sinh nguoi mau) + BOC DO (boc bo do tu anh that ra
 * flat lay) -> MAC DO (mac len nguoi mau) -> cac CANH theo concept -> KET THUC.
 * Nguoi dung chi phai lam MOT viec: dinh anh that cua bo do vao node BOC DO.
 *
 * Ba thu duoi day rut ra tu nhung lan sai da phai sua, khong phai cho dep:
 *
 * 1. `Wearing: {{TRANG_PHUC}}` - khong phai "She wears". Buoc BOC DO doc flat
 *    lay ra mot cau roi dien vao o trong, nen prompt khong dong cung gioi tinh
 *    cua nhan vat; nguoi mau nam hay nu do node MAU quyet dinh.
 * 2. Cau dang phai goi ten CO THE va MAY: chan nao truoc, tay o dau, mat nhin
 *    dau, may cao ngang gi, tieu cu bao nhieu. Cau chung chung kieu "walking
 *    toward the camera, mid-stride" lam tam nao cung ra gan giong tam nao.
 * 3. Khoi BOI CANH giong nhau tung chu o moi canh trong cung mot khuon - co the
 *    la thu duy nhat giu cho tam nao cung nhin ra la cung mot buoi chup.
 *
 * Ti le dat o node BAT DAU (`size`), nen ca khuon ra mot ti le duy nhat.
 */

import type { NodeTemplateRecord } from "./nodeTemplateStore.js";

type Node = NodeTemplateRecord["graph"]["nodes"][number];
type Edge = NodeTemplateRecord["graph"]["edges"][number];

/** Prompt boc trang phuc - giong ban trong ui/src/lib/vaiTroNode.ts. */
const PROMPT_BOC_DO =
  "Fashion flat lay product photograph on a pure white background, shot from directly above. "
  + "Look at the reference photograph(s) and extract EVERY garment and accessory the person is wearing. "
  + "Lay each piece out flat and separately on the white background, reproducing each one exactly as it "
  + "appears in the reference: same colour, same pattern, same fabric texture, same cut, same length. "
  + "Do not invent items that are not in the reference, and do not leave any out. Arrange the pieces "
  + "neatly with clear space around each item. Clean e-commerce product photography, soft even shadowless "
  + "lighting, sharp focus, photorealistic, pure white seamless background, no people, no mannequin, "
  + "no hangers, no text, no watermark.";

/** Khoa nhan dang + khoa tung mon do giu mau rieng. Dung o MAC DO va moi CANH. */
const KHOA =
  "Keep the exact same face, hair, body shape and skin tone as the base image. Do not restyle the person. "
  + "Wearing: {{TRANG_PHUC}}. Use the reference image to match the exact colour, pattern, fabric texture "
  + "and cut of each garment. Each garment keeps its own colour - never let the colour of one piece bleed "
  + "into another.";

/**
 * Buoc MAC DO chup o studio tron, KHONG o boi canh cua concept: day la buoc
 * trung gian, cac canh sau lay no lam anh nen. De no o quan ca phe thi moi canh
 * sau phai xoa mot quan ca phe di truoc da.
 */
const MAC_DO_MAC_DINH =
  "Standing in the same neutral pose as the base image, plain light grey seamless background, full body"
  + " from head to shoes, photorealistic, no text.";

export type CanhConcept = {
  /** Hau to id node, phai khong trung trong cung mot khuon. */
  ma: string;
  /** Nhan hien tren node, tieng Viet - de nhin canvas la biet canh nao. */
  nhan: string;
  /** Cau dang: co the + may. Day la phan lam cac tam khac nhau. */
  dang: string;
};

export type Concept = {
  id: string;
  ten: string;
  moTa: string;
  tags: string[];
  /** Ti le cua ca khuon, dat tren node BAT DAU. */
  size: string;
  /** Prompt node MAU. Sua cau nay la doi nguoi mau. */
  mau: string;
  /** Khoi BOI CANH, giong nhau tung chu o moi canh. */
  boiCanh: string;
  /** Duoi prompt: chat anh, ong kinh, hau ky. */
  duoi: string;
  /** Prompt rieng cho buoc MAC DO; bo trong thi dung cau mac dinh o studio. */
  mauMacDo?: string;
  canh: CanhConcept[];
};

function node(id: string, x: number, y: number, data: Record<string, unknown>): Node {
  return { id, type: "imageNode", position: { x, y }, data: { status: "idle", ...data } };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target, sourceHandle: "source-right", targetHandle: "target-left" };
}

/** Prompt mot canh: khoa nhan dang -> dang -> boi canh -> chat anh. */
export function promptCanh(c: Concept, canh: CanhConcept): string {
  return `${KHOA} ${canh.dang} LOCATION (keep identical in every shot): ${c.boiCanh} ${c.duoi}`;
}

/**
 * Dung mot khuon tu concept.
 *
 * Thu tu canh vao co Y NGHIA: canh DAU TIEN la anh nen dem di sua, cac canh sau
 * moi la tham chieu. Nen `mau -> macdo` phai dung truoc `bocdo -> macdo`, va
 * `macdo -> canh` phai dung truoc `bocdo -> canh`. Dao lai la node mac do lay
 * flat lay lam anh nen va sinh ra mot bo do bay tren nen trang.
 */
export function khuonTuConcept(c: Concept): NodeTemplateRecord {
  const nodes: Node[] = [
    node("bat-dau", 0, 240, { vaiTro: "bat-dau", prompt: "", size: c.size }),
    node("mau", 240, 60, { vaiTro: "mau", prompt: c.mau, label: "MAU - sua loi ta la doi nguoi mau" }),
    node("boc-do", 240, 400, {
      vaiTro: "trang-phuc",
      prompt: PROMPT_BOC_DO,
      label: "BOC DO - dinh anh that cua bo do vao day",
    }),
    node("mac-do", 520, 240, {
      vaiTro: "mac-do",
      prompt: `${KHOA} ${c.mauMacDo ?? MAC_DO_MAC_DINH}`,
      label: "MAC DO - mac bo do len nguoi mau",
    }),
    ...c.canh.map((canh, i) => node(`canh-${canh.ma}`, 820, i * 190, {
      vaiTro: "canh",
      prompt: promptCanh(c, canh),
      label: canh.nhan,
    })),
    node("ket-thuc", 1120, 240, { vaiTro: "ket-thuc", prompt: "" }),
  ];

  const edges: Edge[] = [
    edge("e-start-mau", "bat-dau", "mau"),
    edge("e-start-bocdo", "bat-dau", "boc-do"),
    edge("e-mau-macdo", "mau", "mac-do"),
    edge("e-bocdo-macdo", "boc-do", "mac-do"),
    ...c.canh.flatMap((canh) => [
      edge(`e-macdo-${canh.ma}`, "mac-do", `canh-${canh.ma}`),
      edge(`e-bocdo-${canh.ma}`, "boc-do", `canh-${canh.ma}`),
      edge(`e-${canh.ma}-end`, `canh-${canh.ma}`, "ket-thuc"),
    ]),
  ];

  return {
    id: c.id,
    name: c.ten,
    description: c.moTa,
    source: "seed",
    graph: {
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 0.8 },
      // `requiredPlaceholders` de TRONG: `{{TRANG_PHUC}}` do buoc BOC DO dien,
      // khong phai thu doi nguoi dung nhap.
      manifest: { requiredPlaceholders: [], expectedTerminalResults: c.canh.length },
    },
    tags: c.tags,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * Cac concept.
 *
 * Moi concept la mot kieu chup co that trong nghe: lookbook thi phang, deu,
 * thay ro duong cat; street style thi 35mm, co chuyen dong; editorial thi mot
 * nguon sang cung, bong do gat. Khac nhau o boi canh VA o cach danh sang va
 * ong kinh - doi moi boi canh ma giu nguyen cach chup thi tam nao cung nhu tam
 * nao, chi khac cai tuong dang sau.
 */
const CONCEPTS: Concept[] = [
  {
    id: "seed-tp-tiec-vuon",
    ten: "Tiec vuon cot trang",
    moTa: "Tiec tra ngoai vuon: hang cot trang, ban linen, hoa hong kem, nang trua gat va bong sac net.",
    tags: ["thoi-trang", "tiec-vuon", "sang-trong"],
    size: "1024x1536",
    mau: "Full-body model reference sheet photograph of a young adult fashion model, early twenties, long"
      + " loose wavy hair, warm dewy skin, soft red lip, elegant posture. Relaxed neutral stance facing"
      + " camera, arms slightly away from the body. Plain cream fitted top, plain beige shorts, nude heels,"
      + " no accessories. Soft even studio lighting, plain light grey seamless background, photorealistic,"
      + " head to shoes, no text.",
    boiCanh: "a formal garden terrace with a white classical colonnade behind, clipped hedges and tall"
      + " cypress beyond it, a round table under a white linen cloth laid with cream roses and hydrangeas in"
      + " a low bowl, gold-rimmed plates, crystal glasses and a structured handbag resting on the cloth,"
      + " white French bistro chairs standing on close-cut lawn, bright midday sun throwing crisp shadows.",
    duoi: "Luxury lifestyle fashion photography, warm bright daylight, creamy highlights, 85mm lens,"
      + " shallow depth of field, photorealistic, no text, no watermark.",
    canh: [
      {
        ma: "ngoi-ban",
        nhan: "Ngoi ben ban tiec",
        dang: "The model sits sideways on a bistro chair turned away from the table, spine long, knees"
          + " together and angled off camera, one hand resting on the chair back and the other in the lap,"
          + " head turned to the lens with a small smile. Camera at seated eye level, 85mm, full body with"
          + " the laid table in the near foreground out of focus.",
      },
      {
        ma: "rot-tra",
        nhan: "Rot tra",
        dang: "The model stands at the table pouring from a porcelain pot into a cup, weight on the front"
          + " foot, the free hand steadying the cloth, eyes down on the pour, shoulders relaxed forward."
          + " Camera at chest height, 85mm, three-quarter length with the colonnade soft behind.",
      },
      {
        ma: "di-hang-cot",
        nhan: "Di doc hang cot",
        dang: "The model walks along the colonnade away from the table, mid-stride with the far leg"
          + " extended, one hand lifting the hem clear of the grass, chin up and eyes ahead, the white"
          + " columns marching past behind. Camera at chest height, 85mm, full body, sunlight striping the"
          + " lawn.",
      },
      {
        ma: "ngoanh-lai",
        nhan: "Tua ban ngoanh lai",
        dang: "The model leans back against the edge of the table with both palms on the cloth behind, one"
          + " ankle crossed in front of the other, head turned back over the shoulder toward the lens, hair"
          + " lifted by the breeze. Camera at chest height, 85mm, three-quarter length.",
      },
    ],
  },
  {
    id: "seed-tp-dam-sen",
    ten: "Dam sen studio",
    moTa: "Set sen dung trong studio: phong nen ve, sen that, khay nuoc nong phan chieu, khoi mo va anh sang toa.",
    tags: ["thoi-trang", "sen", "co-dien"],
    size: "1024x1536",
    mau: "Full-body model reference sheet photograph of a young adult fashion model, early twenties, very"
      + " long dark wavy hair, porcelain dewy skin, soft pink lip, delicate build. Relaxed neutral stance"
      + " facing camera, arms slightly away from the body. Plain cream fitted top, plain cream shorts, bare"
      + " feet, small white flowers pinned in the hair. Soft even studio lighting, plain light grey seamless"
      + " background, photorealistic, head to feet, no text.",
    boiCanh: "a studio lotus set: a hand-painted misty lotus backdrop in pale green and grey, real white and"
      + " cream lotus blooms with round green pads standing in a shallow black water tray that mirrors"
      + " everything above it, a low dark wooden platform and a small clay teapot at the edge of the water,"
      + " thin haze hanging in the air.",
    duoi: "Soft dreamy oriental portrait photography, diffused frontal light with a pale glow, pastel green"
      + " and cream palette, 85mm lens, shallow depth of field, photorealistic, no text, no watermark.",
    canh: [
      {
        ma: "ngoi-be",
        nhan: "Ngoi ben be sen",
        dang: "The model sits on the low wooden platform at the edge of the water with both legs folded to"
          + " one side, one hand resting behind for support and the other trailing just above the surface,"
          + " head tilted down toward a bloom. Camera at water level, 85mm, full body with lotus pads in the"
          + " foreground.",
      },
      {
        ma: "nga-lung",
        nhan: "Nga lung tren be",
        dang: "The model lies back along the wooden platform just above the water, one knee raised, one arm"
          + " stretched above the head and the other across the waist, hair spilling over the edge toward"
          + " the reflection, eyes closed. Camera high looking straight down, 50mm, whole figure with blooms"
          + " framing two corners.",
      },
      {
        ma: "quay-lung",
        nhan: "Quay lung ben hoa",
        dang: "The model kneels facing away from the camera among the tall stems, back straight, both hands"
          + " lifting the hair off the nape, head turned just enough to show the profile. Camera at chest"
          + " height, 85mm, three-quarter length with haze separating her from the backdrop.",
      },
      {
        ma: "can-mat",
        nhan: "Can mat nghieng",
        dang: "Close portrait from the shoulders up, the model in profile with eyes closed and chin lifted,"
          + " one lotus held just below the jaw, the flowers in the hair catching the light. Camera at eye"
          + " level, 135mm, very shallow depth of field with the pond melting behind.",
      },
    ],
  },
  {
    id: "seed-tp-tennis",
    ten: "San tennis chieu muon",
    moTa: "Nang xien cuoi chieu tren san dat nen, ghe khan dai xanh nhoe phia sau, da bong mo hoi.",
    tags: ["thoi-trang", "the-thao", "golden-hour"],
    size: "1024x1536",
    mau: "Full-body model reference sheet photograph of a young adult fashion model, early twenties, hair"
      + " pulled into a high ponytail with loose strands, clear-framed glasses, bare skin with a light"
      + " sheen, athletic slim build. Relaxed neutral stance facing camera, arms slightly away from the"
      + " body. Plain white fitted top, plain black shorts, white court shoes, no accessories. Soft even"
      + " studio lighting, plain light grey seamless background, photorealistic, head to shoes, no text.",
    boiCanh: "an outdoor clay tennis court late in the afternoon, rows of blue stadium seats rising out of"
      + " focus behind, crisp white court lines on red-orange clay, a net at the far edge, floodlight masts"
      + " against a pale sky, the low sun raking straight across the court.",
    duoi: "Sporty editorial photography, strong warm backlight and a flare at the frame edge, visible skin"
      + " sheen, 135mm lens compressing the seats into soft bokeh, photorealistic, no text, no watermark.",
    canh: [
      {
        ma: "vac-vot",
        nhan: "Vac vot nhin may",
        dang: "The model stands half-turned with a racket resting across one shoulder, that elbow high and"
          + " the other hand on the hip, chin level, looking straight into the lens without smiling, stray"
          + " hairs lit by the sun behind. Camera at chest height, 135mm, waist-up with the blue seats"
          + " dissolved behind.",
      },
      {
        ma: "giao-bong",
        nhan: "Vuon nguoi giao bong",
        dang: "The model reaches full stretch at the top of a serve, the racket arm extended overhead and"
          + " the other arm pointing up after the toss, back arched and the front heel lifted, eyes on the"
          + " ball out of frame. Camera at hip height, 85mm, full body against the sky.",
      },
      {
        ma: "thu-the",
        nhan: "Khom nguoi thu the",
        dang: "The model crouches low in the ready position behind the baseline, knees bent wide, racket"
          + " held in both hands in front, weight on the balls of the feet, eyes fixed down the court."
          + " Camera at knee height, 85mm, full body with the white line running under her.",
      },
      {
        ma: "roi-san",
        nhan: "Roi san lau mo hoi",
        dang: "The model walks off court toward the camera, the racket hanging from one hand and the other"
          + " wiping the brow with the back of the wrist, head down and shoulders loose, backlight rimming"
          + " the ponytail. Camera at chest height, 135mm, three-quarter length.",
      },
    ],
  },
  {
    id: "seed-tp-co-phuc",
    ten: "Co phuc studio",
    moTa: "Nen trang tron, do cu toi thieu: mot doa moc lan va mot buc chan dung co. Mau vai la thu duy nhat co mau.",
    tags: ["thoi-trang", "co-phuc", "editorial"],
    size: "1024x1536",
    mau: "Full-body model reference sheet photograph of a young adult fashion model, early twenties, very"
      + " long straight black hair parted in the middle, matte porcelain skin, deep red lip, sharp"
      + " cheekbones. Relaxed neutral stance facing camera, arms slightly away from the body. Plain white"
      + " fitted top, plain white trousers, bare feet, no accessories. Soft even studio lighting, plain"
      + " light grey seamless background, photorealistic, head to feet, no text.",
    boiCanh: "a pure white studio cyclorama with a seamless white floor, one fresh white magnolia bloom and"
      + " a small framed antique painted portrait propped on the floor as the only props, nothing else in"
      + " the frame.",
    duoi: "Vietnamese heritage concept photography, clean even light with a soft falloff into the white,"
      + " deeply saturated garment colour against the bare set, 85mm lens, photorealistic, no text,"
      + " no watermark.",
    canh: [
      {
        ma: "ngoi-san",
        nhan: "Ngoi xep chan tren san",
        dang: "The model sits on the white floor with both legs folded to one side, one palm flat on the"
          + " floor taking the weight, the far sleeve spread wide across the ground, spine tall and chin"
          + " level to the lens. Camera at floor level, 50mm, whole figure with a large empty white field"
          + " above.",
      },
      {
        ma: "xoe-tay-ao",
        nhan: "Dang tay cho tay ao xoe",
        dang: "The model stands and lifts both arms to shoulder height so the wide sleeves fall open into"
          + " two long curtains, feet together, head turned in profile with the eyes closed. Camera at"
          + " chest height, 85mm, full body centred with symmetrical space on both sides.",
      },
      {
        ma: "chong-khuyu",
        nhan: "Chong khuyu cam hoa",
        dang: "The model reclines on the floor propped on one elbow, the lower hand holding the magnolia"
          + " just below the chin, legs folded away behind, looking straight down the lens. Camera at floor"
          + " level, 85mm, three-quarter length with the folded fabric filling the lower frame.",
      },
      {
        ma: "lung-ao",
        nhan: "Quay lung khoe than ao",
        dang: "The model stands with the back three-quarters to the camera, weight on one hip, one hand"
          + " gathering the hair over the shoulder so the back panel and its pattern are fully visible,"
          + " head turned just past the shoulder. Camera at chest height, 85mm, full body.",
      },
    ],
  },
  {
    id: "seed-tp-lookbook",
    ten: "Lookbook studio",
    moTa: "Bon goc chuan cua mot trang lookbook: chinh dien, ba phan tu, sau lung, va mot tam can canh chat lieu.",
    tags: ["thoi-trang", "lookbook", "studio"],
    size: "1024x1536",
    mau: "Full-body model reference sheet photograph of a young adult fashion model, early twenties, natural"
      + " healthy skin, hair pulled back simply, minimal makeup, slim build. Relaxed neutral stance facing"
      + " camera, arms slightly away from the body. Plain white fitted top, plain light grey shorts, bare"
      + " feet, no accessories. Soft even studio lighting, plain light grey seamless background,"
      + " photorealistic, head to feet, no text.",
    boiCanh: "a professional photo studio with a plain warm-grey seamless paper backdrop, the floor the same"
      + " tone as the wall with no visible seam, one large softbox at 45 degrees and a white bounce card"
      + " filling the shadow side, no props, no furniture.",
    duoi: "Commercial e-commerce lookbook photography, even flattering light, true-to-life colour,"
      + " 85mm lens, photorealistic, sharp on the garment, no text, no watermark.",
    canh: [
      {
        ma: "truoc",
        nhan: "Chinh dien",
        dang: "The model stands square to the camera, weight even on both feet, shoulders level, arms hanging"
          + " relaxed a hand's width from the body so the silhouette of the garment reads clearly, chin level,"
          + " calm neutral expression. Camera at chest height, 85mm, full body from hair to feet with even"
          + " space above and below.",
      },
      {
        ma: "ba-phan-tu",
        nhan: "Ba phan tu",
        dang: "The model turns 45 degrees to the camera with the far shoulder back, weight on the back foot,"
          + " front knee softly bent, the near hand resting at the hip to show the waist of the garment, head"
          + " turned to the lens. Camera at chest height, 85mm, full body.",
      },
      {
        ma: "sau",
        nhan: "Sau lung",
        dang: "The model stands with their back fully to the camera, feet hip width apart, arms relaxed at the"
          + " sides, head straight so the back neckline, shoulder seams and hem line are all clearly visible."
          + " Camera at chest height, 85mm, full body.",
      },
      {
        ma: "chat-lieu",
        nhan: "Can canh chat lieu",
        dang: "Waist-up crop of the model half-turned, one hand lifting the edge of the garment toward the"
          + " camera so the weave, stitching and hem finish fill the frame, face partly in shot but out of"
          + " focus. Camera at chest height, 100mm macro, shallow depth of field on the fabric.",
      },
    ],
  },
  {
    id: "seed-tp-street",
    ten: "Street style",
    moTa: "Kieu anh chup nhanh ngoai pho: 35mm, co chuyen dong, nang chieu xuong giua cac toa nha.",
    tags: ["thoi-trang", "street", "candid"],
    size: "1152x2048",
    mau: "Full-body model reference sheet photograph of a young adult fashion model, early twenties, natural"
      + " skin texture with visible pores, loose hair, no-makeup makeup, athletic slim build. Relaxed neutral"
      + " stance facing camera, arms slightly away from the body. Plain grey fitted top, plain black shorts,"
      + " white sneakers, no accessories. Soft even studio lighting, plain light grey seamless background,"
      + " photorealistic, head to shoes, no text.",
    boiCanh: "a wide city sidewalk between tall buildings, pale stone paving with painted crossing lines, a"
      + " row of parked cars along the kerb, glass shopfronts reflecting the street, a few blurred passers-by"
      + " in the distance, mid-morning sun coming down the street from behind the camera's left.",
    duoi: "Candid street style photography, 35mm lens, slight motion in the limbs, natural contrast,"
      + " photorealistic, no text, no watermark.",
    canh: [
      {
        ma: "buoc-qua",
        nhan: "Buoc qua truoc may",
        dang: "The model strides left to right across the frame, legs scissored wide mid-step, front heel"
          + " just landing, both arms swinging, eyes down the street and not at the camera, hair lifting with"
          + " the movement. Camera at hip height, 35mm, full body with a sliver of sky above.",
      },
      {
        ma: "sang-duong",
        nhan: "Sang duong",
        dang: "The model crosses the painted crossing lines straight toward the camera, one hand holding a"
          + " strap on the shoulder, the other loose, head slightly down and to the side as if checking for"
          + " traffic. Camera at chest height, 35mm, full body, crossing lines converging under the feet.",
      },
      {
        ma: "dung-cot",
        nhan: "Dua vao cot den",
        dang: "The model leans one shoulder against a lamp post, ankles crossed, one thumb hooked in a"
          + " pocket, looking off past the camera with a flat unsmiling expression. Camera at chest height,"
          + " 50mm, full body, the street receding out of focus behind.",
      },
      {
        ma: "ngoai-lai",
        nhan: "Ngoanh lai",
        dang: "The model walks away from the camera and turns the upper body back over the right shoulder,"
          + " one foot mid-lift, one hand pushing hair off the face, sunlight rimming the shoulder line."
          + " Camera at chest height, 50mm, full body with a long shadow toward the viewer.",
      },
    ],
  },
  {
    id: "seed-tp-cafe",
    ten: "Quan ca phe",
    moTa: "Noi that am, go nhat va nang sang - kieu anh de ban do thuong ngay.",
    tags: ["thoi-trang", "lifestyle", "cafe"],
    size: "1152x2048",
    mau: "Full-body model reference sheet photograph of a young adult fashion model, early twenties, glossy"
      + " dark hair with face-framing layers, dewy skin, soft gradient lips, slim delicate build. Relaxed"
      + " neutral pose facing camera, arms slightly away from the body. Plain white crop top, light grey"
      + " shorts, white sneakers, no accessories. Soft even studio lighting, plain light grey seamless"
      + " background, photorealistic, head to shoes, no text.",
    boiCanh: "a warm cosy coffee shop with pale oak furniture, white brick walls, tall arched windows with"
      + " sheer linen curtains, brass pendant lights, a long marble counter with a chrome espresso machine,"
      + " potted olive trees in the corners, soft morning sunlight lying across the floor.",
    duoi: "Natural candid lifestyle fashion photography, shallow depth of field, warm true-to-life colour,"
      + " 50mm lens, photorealistic, no text, no watermark.",
    canh: [
      {
        ma: "di-vao",
        nhan: "Day cua buoc vao",
        dang: "The model pushes the glass door open with one palm flat on the frame and steps over the"
          + " threshold, the back foot still outside, body leaning slightly forward, head tilted down watching"
          + " the step, seen from inside the shop. Camera at eye level, 35mm, full body, daylight flaring"
          + " around the open door.",
      },
      {
        ma: "goi-do",
        nhan: "Goi do o quay",
        dang: "The model stands at the counter with weight on one hip, the other knee softly bent and that"
          + " toe pointed at the floor, one forearm resting on the marble, chin lifted toward the menu board"
          + " above, body half turned three-quarter front. Camera at chest height, 50mm, full body.",
      },
      {
        ma: "di-giua-ban",
        nhan: "Di giua cac ban",
        dang: "The model walks between two rows of tables holding a cup at chest height, mid-stride with the"
          + " right knee lifted, the free hand brushing a chair back, eyes on the cup. Camera low at table"
          + " height looking slightly up, 35mm, full body with pendant lights above.",
      },
      {
        ma: "ngoi-cua-so",
        nhan: "Ngoi ben cua so",
        dang: "The model sits at the window table on a wooden chair turned slightly away from the table, back"
          + " straight, legs crossed at the knee with the top foot pointed down, both hands around a cup in"
          + " the lap, looking out of the window in profile. Camera at seated eye level, 50mm, full body from"
          + " hair to shoes.",
      },
    ],
  },
  {
    id: "seed-tp-hoang-hon",
    ten: "San thuong hoang hon",
    moTa: "Nguoc sang gio vang: vien sang quanh nguoi, troi cam, gio lam bay vat ao.",
    tags: ["thoi-trang", "golden-hour", "rooftop"],
    size: "1152x2048",
    mau: "Full-body model reference sheet photograph of a young adult fashion model, early twenties, long"
      + " loose hair, sun-kissed skin, bare natural makeup, tall slim build. Relaxed neutral stance facing"
      + " camera, arms slightly away from the body. Plain cream fitted top, plain sand-coloured shorts, bare"
      + " feet, no accessories. Soft even studio lighting, plain light grey seamless background,"
      + " photorealistic, head to feet, no text.",
    boiCanh: "an open concrete rooftop terrace above a city at sunset, a low parapet wall along the edge, the"
      + " skyline hazy and far behind, the sun sitting just above the horizon directly behind the model, the"
      + " concrete still warm and pale orange.",
    duoi: "Backlit golden hour fashion photography, strong rim light around the hair and shoulders, warm haze"
      + " and gentle lens flare, 85mm lens, photorealistic, no text, no watermark.",
    canh: [
      {
        ma: "nguoc-sang",
        nhan: "Nguoc sang chinh dien",
        dang: "The model stands facing the camera with the sun directly behind, feet hip width apart, both"
          + " arms slightly away from the body, chin level, eyes on the lens, hair and the edges of the"
          + " garment lit into a bright outline. Camera at chest height, 85mm, full body, flare in the top"
          + " corner.",
      },
      {
        ma: "gio",
        nhan: "Gio tat vat ao",
        dang: "The model stands three-quarter to the camera with one hand holding the hair back from the"
          + " face and the other letting the hem lift in the wind, weight on the back foot, looking away"
          + " toward the horizon. Camera at chest height, 85mm, full body, fabric caught mid-movement.",
      },
      {
        ma: "tua-tuong",
        nhan: "Tua parapet",
        dang: "The model sits on the low parapet wall in profile, one leg drawn up with the foot flat on the"
          + " wall and the other hanging, hands resting on the raised knee, head turned down toward the city."
          + " Camera at seated eye level, 50mm, full body with the skyline behind.",
      },
      {
        ma: "bong",
        nhan: "Bong do tren san",
        dang: "The model walks toward the camera into their own long shadow, mid-stride with the left foot"
          + " forward, one hand shading the eyes, the low sun flattening the concrete into pale orange."
          + " Camera at knee height looking slightly up, 50mm, full body.",
      },
    ],
  },
  {
    id: "seed-tp-editorial",
    ten: "Editorial toi gian",
    moTa: "Mot nguon sang cung, bong do gat, tuong be tong tron - kieu anh bia tap chi.",
    tags: ["thoi-trang", "editorial", "minimal"],
    size: "1024x1536",
    mau: "Full-body model reference sheet photograph of a young adult fashion model, early twenties, sharp"
      + " bone structure, hair slicked back flat, matte skin, bare lips, very slim build. Relaxed neutral"
      + " stance facing camera, arms slightly away from the body. Plain black fitted top, plain black shorts,"
      + " bare feet, no accessories. Soft even studio lighting, plain light grey seamless background,"
      + " photorealistic, head to feet, no text.",
    boiCanh: "an empty room with smooth pale concrete walls and floor of the same tone, one tall narrow"
      + " window out of frame to the right throwing a single hard shaft of daylight across the wall, nothing"
      + " else in the room.",
    duoi: "High fashion editorial photography, one hard light source, deep defined shadows, muted palette,"
      + " 50mm lens, photorealistic, grain of medium format film, no text, no watermark.",
    canh: [
      {
        ma: "bong-gat",
        nhan: "Dung trong vet sang",
        dang: "The model stands inside the single shaft of light, body square to the camera but face turned"
          + " fully to the light, one arm crossing the waist and the other hanging, half the figure in deep"
          + " shadow and the lit edge razor sharp. Camera at chest height, 50mm, full body.",
      },
      {
        ma: "ngoi-san",
        nhan: "Ngoi tren san",
        dang: "The model sits directly on the concrete floor with knees drawn up and apart, forearms resting"
          + " on the knees, spine long, head tipped back slightly with eyes closed, the hard light raking"
          + " across the shoulders. Camera at floor level, 35mm, whole figure with a large empty wall above.",
      },
      {
        ma: "goc-tuong",
        nhan: "Ap goc tuong",
        dang: "The model stands pressed into the corner of the room in profile, shoulder blades flat to one"
          + " wall, one knee lifted with the sole against the other wall, arms straight down, staring level"
          + " out of frame. Camera at chest height, 50mm, full body with the corner line dividing the frame.",
      },
      {
        ma: "bang-qua",
        nhan: "Bang qua vet sang",
        dang: "The model strides through the shaft of light so the body is half lit and half dark at the"
          + " moment of the step, front leg extended and back heel lifted, both arms swung back, chin down."
          + " Camera at chest height, 50mm, full body, motion held sharp.",
      },
    ],
  },
  {
    id: "seed-tp-san-bay",
    ten: "Thoi trang san bay",
    moTa: "Kieu anh bat gap o san bay: den tran deu, san bong, keo vali - de ban do mac ca ngay.",
    tags: ["thoi-trang", "airport", "candid"],
    size: "1152x2048",
    mau: "Full-body model reference sheet photograph of a young adult fashion model, early twenties, glossy"
      + " straight hair, fresh dewy skin, light natural makeup, slim build. Relaxed neutral stance facing"
      + " camera, arms slightly away from the body. Plain white fitted top, plain grey shorts, white"
      + " sneakers, no accessories. Soft even studio lighting, plain light grey seamless background,"
      + " photorealistic, head to shoes, no text.",
    boiCanh: "a bright modern airport terminal, polished pale stone floor reflecting the ceiling lights, a"
      + " long glass curtain wall on the left showing aircraft tails on the apron, rows of empty seats and a"
      + " check-in island far behind, even daylight mixed with cool ceiling light.",
    duoi: "Candid paparazzi-style airport fashion photography, flat even light, slight reflection on the"
      + " floor, 35mm lens, photorealistic, no text, no watermark.",
    canh: [
      {
        ma: "keo-vali",
        nhan: "Keo vali di toi",
        dang: "The model walks straight toward the camera pulling a cabin suitcase with the right hand, the"
          + " left hand holding a phone at chest height, mid-stride with the right foot forward, looking just"
          + " past the lens. Camera at chest height, 35mm, full body with the glass wall running away on the"
          + " left.",
      },
      {
        ma: "ngoanh-vai",
        nhan: "Ngoanh qua vai",
        dang: "The model walks away from the camera and looks back over the left shoulder, sunglasses pushed"
          + " up into the hair, one hand adjusting the bag strap, the polished floor doubling the figure."
          + " Camera at chest height, 50mm, full body with the reflection included.",
      },
      {
        ma: "ngoi-cho",
        nhan: "Ngoi cho o ghe",
        dang: "The model sits sideways across two terminal seats with one ankle crossed over the other knee,"
          + " leaning back on one elbow, the other hand loose in the lap, head turned toward the window light."
          + " Camera at seated eye level, 50mm, full body from hair to shoes.",
      },
      {
        ma: "cua-kinh",
        nhan: "Dung ben cua kinh",
        dang: "The model stands in profile close to the glass curtain wall with one palm resting on it, feet"
          + " together, the aircraft outside soft and out of focus, cool daylight shaping the front of the"
          + " body. Camera at chest height, 85mm, full body against the bright window.",
      },
    ],
  },
];

export const khuonThoiTrang: readonly NodeTemplateRecord[] = CONCEPTS.map(khuonTuConcept);

export { CONCEPTS as conceptThoiTrang, KHOA as KHOA_NHAN_DANG, PROMPT_BOC_DO };
