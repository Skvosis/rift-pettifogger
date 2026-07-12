// 分享判决图：把一条论据渲染成适合贴吧 / Reddit 传播的「判决书」风格 PNG。
// 纯 Canvas 2D 手绘，零运行时依赖；队标以 CORS 方式加载，失败退化为首字母
// 头像，保证画布永不被污染、始终可导出。
import type { Argument, Edge, Filters, SeriesEvidence } from "../engine/types";
import { getLocale, t } from "../i18n";
import {
  argKind,
  formatRule2Note,
  leagueLabel,
  name as teamName,
  ruleName,
  scopeLabel,
  stageLabel,
  type Teams,
} from "./describe";
import { resolveLogos } from "../logos";

export interface ShareImageOptions {
  teams: Teams;
  arg: Argument;
  filters: Filters | null;
  toast: (msg: string) => void;
}

type ThemeId = "light" | "dark";

interface Palette {
  bg: string;
  glow: string;
  card: string;
  card2: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentDeep: string;
  accentSoft: string;
  win: string;
  seal: string;
}

const PALETTES: Record<ThemeId, Palette> = {
  light: {
    bg: "#ffffff",
    glow: "rgba(253, 215, 222, 0.55)",
    card: "#fafafb",
    card2: "#f1f1f4",
    text: "#1a1a1f",
    muted: "#6b6b76",
    border: "#e4e4ea",
    accent: "#d8324e",
    accentDeep: "#7a0f22",
    accentSoft: "#fce8ec",
    win: "#1f9d63",
    seal: "#d92b48",
  },
  dark: {
    bg: "#12141c",
    glow: "rgba(70, 22, 32, 0.6)",
    card: "#1b1f2a",
    card2: "#232837",
    text: "#e9e9ee",
    muted: "#9a9aa8",
    border: "#2a3040",
    accent: "#ff5872",
    accentDeep: "#c22743",
    accentSoft: "#33161e",
    win: "#46c98a",
    seal: "#ff4d68",
  },
};

const SANS = `"Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
// 判决书公文感：仿宋/宋体系（Windows FangSong、mac Songti），西文退化到衬线
const SERIF = `"FangSong", "STFangsong", "Songti SC", "SimSun", "Noto Serif SC", Georgia, serif`;

const font = (weight: number, size: number, serif = false) =>
  `${weight} ${size}px ${serif ? SERIF : SANS}`;

/** letterSpacing 是较新的画布属性，不支持的浏览器静默忽略（纯装饰）。 */
function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}

// ---------- 多段富文本（一行内混排字号/颜色，整行按 maxW 等比缩放） ----------
interface Seg {
  text: string;
  size: number;
  weight?: number;
  color: string;
  serif?: boolean;
}

function segsWidth(ctx: CanvasRenderingContext2D, segs: Seg[], scale = 1): number {
  let w = 0;
  for (const s of segs) {
    ctx.font = font(s.weight ?? 400, s.size * scale, s.serif);
    w += ctx.measureText(s.text).width;
  }
  return w;
}

function drawSegs(
  ctx: CanvasRenderingContext2D,
  segs: Seg[],
  x: number,
  baseline: number,
  opts: { maxW?: number; align?: "left" | "center" | "right" } = {},
): number {
  let scale = 1;
  if (opts.maxW) {
    const w = segsWidth(ctx, segs);
    if (w > opts.maxW) scale = Math.max(0.45, opts.maxW / w);
  }
  const total = segsWidth(ctx, segs, scale);
  let cx = x;
  if (opts.align === "center") cx = x - total / 2;
  else if (opts.align === "right") cx = x - total;
  for (const s of segs) {
    ctx.font = font(s.weight ?? 400, s.size * scale, s.serif);
    ctx.fillStyle = s.color;
    ctx.fillText(s.text, cx, baseline);
    cx += ctx.measureText(s.text).width;
  }
  return total;
}

// ---------- 基础图形 ----------
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const inner = r * 0.4;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : inner;
    const px = cx + Math.cos(ang) * rad;
    const py = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// ---------- 队标加载（CORS + 高清重写 + 失败退化） ----------
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    // Fandom CDN 对带 Referer 的热链返回 404（体内是占位图，仍会被解码渲染），必须去掉
    img.referrerPolicy = "no-referrer";
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}

/** 队标缓存的是 48px 缩略图，画布用大图：改写 Fandom 缩略 URL 的宽度段。 */
function hiResUrl(url: string): string {
  return url
    .replace(/scale-to-width-down\/\d+/, "scale-to-width-down/256")
    .replace(/\/\d+px-/, "/256px-");
}

async function loadLogos(ids: string[]): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>();
  try {
    const urls = await resolveLogos(ids);
    await Promise.all(
      ids.map(async (id) => {
        const url = urls.get(id);
        if (!url) return;
        const img = (await loadImage(hiResUrl(url))) ?? (await loadImage(url));
        if (img) out.set(id, img);
      }),
    );
  } catch {
    /* 无网络等情况：全部退化为首字母头像 */
  }
  return out;
}

function drawLogo(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  img: HTMLImageElement | undefined,
  label: string,
  x: number,
  y: number,
  size: number,
) {
  rr(ctx, x, y, size, size, size * 0.22);
  ctx.fillStyle = pal.card2;
  ctx.fill();
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (img) {
    ctx.save();
    rr(ctx, x, y, size, size, size * 0.22);
    ctx.clip();
    const pad = size * 0.1;
    const s = Math.min((size - 2 * pad) / img.width, (size - 2 * pad) / img.height);
    const w = img.width * s;
    const h = img.height * s;
    ctx.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
    ctx.restore();
  } else {
    ctx.font = font(800, size * 0.3);
    ctx.fillStyle = pal.muted;
    const text = label.slice(0, 2);
    const w = ctx.measureText(text).width;
    ctx.fillText(text, x + (size - w) / 2, y + size / 2 + size * 0.11);
  }
}

// ---------- 证据步骤 ----------
const STEP_H_SINGLE = 124; // 规则 1 / 3：两行
const STEP_H_RULE2 = 196; // 规则 2：标题 + 两场比赛 + 结论

function stepHeight(e: Edge): number {
  return e.evidence.kind === "rule2" ? STEP_H_RULE2 : STEP_H_SINGLE;
}

function seriesMeta(ev: SeriesEvidence): string {
  const parts = [ev.date.slice(0, 10), leagueLabel(ev.league), stageLabel(ev.stage), `Bo${ev.best_of}`];
  if (ev.flags.includes("ff")) parts.push(t("flag.ff"));
  return parts.filter(Boolean).join(" · ");
}

/** 「名字 比分 名字」行：胜方比分绿色、败方与对手灰色。 */
function scoreLineSegs(
  teams: Teams,
  pal: Palette,
  ev: SeriesEvidence,
  size: number,
  withDate = false,
): Seg[] {
  const won = ev.selfScore > ev.oppScore;
  const segs: Seg[] = [
    { text: teamName(teams, ev.self), size, weight: 800, color: pal.text },
    { text: `  ${ev.selfScore}`, size, weight: 800, color: won ? pal.win : pal.muted },
    { text: " : ", size: size - 4, weight: 700, color: pal.muted },
    { text: `${ev.oppScore}  `, size, weight: 800, color: pal.muted },
    { text: teamName(teams, ev.opp), size, weight: 600, color: pal.muted },
  ];
  if (withDate) segs.push({ text: `   ${ev.date.slice(5, 10)}`, size: size - 6, color: pal.muted });
  return segs;
}

function drawStep(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  teams: Teams,
  e: Edge,
  idx: number,
  x: number,
  y: number,
  w: number,
) {
  const h = stepHeight(e);
  rr(ctx, x, y, w, h, 16);
  ctx.fillStyle = pal.card;
  ctx.fill();
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 序号圆
  ctx.beginPath();
  ctx.arc(x + 46, y + 46, 20, 0, Math.PI * 2);
  ctx.fillStyle = pal.accent;
  ctx.fill();
  ctx.font = font(800, 20);
  ctx.fillStyle = "#ffffff";
  const num = String(idx + 1);
  ctx.fillText(num, x + 46 - ctx.measureText(num).width / 2, y + 53);

  const x0 = x + 84;
  const maxW = w - 108;

  if (e.evidence.kind === "rule1") {
    const ev = e.evidence.series;
    drawSegs(ctx, scoreLineSegs(teams, pal, ev, 30), x0, y + 56, { maxW });
    drawSegs(
      ctx,
      [{ text: `${seriesMeta(ev)} · ${ruleName(1)}`, size: 21, color: pal.muted }],
      x0,
      y + 96,
      { maxW },
    );
  } else if (e.evidence.kind === "rule2") {
    const ev = e.evidence;
    drawSegs(
      ctx,
      [{ text: t("img.rule2Line", { via: teamName(teams, ev.via) }), size: 24, weight: 700, color: pal.text }],
      x0,
      y + 52,
      { maxW },
    );
    drawSegs(ctx, scoreLineSegs(teams, pal, ev.aSeries, 26, true), x0, y + 92, { maxW });
    drawSegs(ctx, scoreLineSegs(teams, pal, ev.bSeries, 26, true), x0, y + 128, { maxW });
    drawSegs(
      ctx,
      [{ text: `→ ${formatRule2Note(ev.note)}`, size: 21, weight: 600, color: pal.accent }],
      x0,
      y + 164,
      { maxW },
    );
  } else {
    const ev = e.evidence;
    const losses = ev.total - ev.wins;
    drawSegs(
      ctx,
      [
        { text: teamName(teams, e.from), size: 30, weight: 800, color: pal.text },
        { text: `  ${ev.wins}`, size: 30, weight: 800, color: pal.win },
        { text: " - ", size: 26, weight: 700, color: pal.muted },
        { text: `${losses}  `, size: 30, weight: 800, color: pal.muted },
        { text: teamName(teams, e.to), size: 30, weight: 600, color: pal.muted },
      ],
      x0,
      y + 56,
      { maxW },
    );
    const scopeNote = ev.downgraded ? t("link.rule3ScopeNote", { scope: scopeLabel(ev.scopeUsed) }) : "";
    drawSegs(
      ctx,
      [
        {
          text:
            t("link.rule3Summary", {
              wins: ev.wins,
              losses,
              tally: t(`tally.${ev.tally}`),
              rate: (ev.rate * 100).toFixed(0),
            }) + scopeNote,
          size: 21,
          color: pal.muted,
        },
      ],
      x0,
      y + 96,
      { maxW },
    );
  }
}

function drawConnector(ctx: CanvasRenderingContext2D, pal: Palette, cx: number, y0: number, y1: number) {
  const cy = (y0 + y1) / 2;
  ctx.strokeStyle = pal.muted;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, y0 + 6);
  ctx.lineTo(cx, cy + 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 7, cy + 2);
  ctx.lineTo(cx + 7, cy + 2);
  ctx.lineTo(cx, cy + 12);
  ctx.closePath();
  ctx.fillStyle = pal.muted;
  ctx.fill();
}

// ---------- 公章 / 印章 ----------
/** 中文：圆形公章（环形队名 + 五角星 + 「判案专用章」）。 */
function drawSealZh(ctx: CanvasRenderingContext2D, pal: Palette, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.16);
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = pal.seal;
  ctx.fillStyle = pal.seal;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  starPath(ctx, 0, -6, r * 0.3);
  ctx.fill();
  // 环形文字（上弧）
  const label = t("img.sealArc");
  const chars = [...label];
  const a0 = -Math.PI * 0.82;
  const a1 = -Math.PI * 0.18;
  const rad = r - 27;
  ctx.font = font(800, 29, true);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  chars.forEach((ch, i) => {
    const ang = a0 + ((a1 - a0) * (i + 0.5)) / chars.length;
    ctx.save();
    ctx.translate(Math.cos(ang) * rad, Math.sin(ang) * rad);
    ctx.rotate(ang + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
  ctx.font = font(700, 21, true);
  ctx.fillText(t("img.sealBottom"), 0, r * 0.55);
  ctx.restore();
}

/** 英文：斜置双框「CASE CLOSED」矩形戳。 */
function drawStampEn(ctx: CanvasRenderingContext2D, pal: Palette, cx: number, cy: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.12);
  ctx.globalAlpha = 0.85;
  ctx.font = font(800, 38, true);
  setSpacing(ctx, 3);
  const text = t("img.stamp");
  const w = ctx.measureText(text).width + 56;
  const h = 78;
  ctx.strokeStyle = pal.seal;
  ctx.lineWidth = 5;
  rr(ctx, -w / 2, -h / 2, w, h, 10);
  ctx.stroke();
  ctx.lineWidth = 2;
  rr(ctx, -w / 2 + 7, -h / 2 + 7, w - 14, h - 14, 6);
  ctx.stroke();
  ctx.fillStyle = pal.seal;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 2);
  setSpacing(ctx, 0);
  ctx.restore();
}

// ---------- 徽章行 ----------
function drawPillRow(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  pills: { text: string; accent?: boolean }[],
  centerX: number,
  cy: number,
  maxW: number,
) {
  const size = 20;
  const padX = 16;
  const gap = 10;
  const h = 40;
  ctx.font = font(600, size);
  const ws = pills.map((p) => ctx.measureText(p.text).width + padX * 2);
  const total = ws.reduce((a, b) => a + b, 0) + gap * (pills.length - 1);
  const scale = total > maxW ? maxW / total : 1;
  let x = centerX - (total * scale) / 2;
  pills.forEach((p, i) => {
    const w = ws[i] * scale;
    rr(ctx, x, cy - h / 2, w, h, h / 2);
    ctx.fillStyle = p.accent ? pal.accentSoft : pal.card;
    ctx.fill();
    ctx.strokeStyle = p.accent ? pal.accent : pal.border;
    ctx.globalAlpha = p.accent ? 0.5 : 1;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = font(600, size * scale);
    ctx.fillStyle = p.accent ? pal.accent : pal.muted;
    ctx.fillText(p.text, x + padX * scale, cy + 7 * scale);
    x += w + gap * scale;
  });
}

// ---------- 整图渲染 ----------
const W = 1080;
const P = 72;
const INNER = W - P * 2;

async function renderCard(
  o: ShareImageOptions,
  startId: string,
  endId: string,
  theme: ThemeId,
): Promise<HTMLCanvasElement> {
  const pal = PALETTES[theme];
  const teams = o.teams;
  const path = o.arg.path;
  const multi = path.length > 1;
  const logos = await loadLogos([startId, endId]);
  const aName = teamName(teams, startId);
  const bName = teamName(teams, endId);

  // ---- 布局（无折行，全部整行缩放，高度可精确预算） ----
  let y = 10;
  y += 56;
  const brandY = y;
  y += 76;
  const docY = y;
  y += 44;
  const caseY = y;
  y += 30;
  const div1Y = y;
  y += 56;
  const findsY = y;
  y += 24;
  const claimCY = y + 62;
  y += 126;
  let chainMapY = 0;
  if (multi) {
    y += 42;
    chainMapY = y;
    y += 12;
  }
  y += 32;
  const pillsCY = y;
  y += 46;
  const sectionY = y + 18;
  y = sectionY + 32;
  const stepYs: { y: number; h: number }[] = [];
  for (let i = 0; i < path.length; i++) {
    if (i > 0) y += 38;
    const h = stepHeight(path[i]);
    stepYs.push({ y, h });
    y += h;
  }
  y += 34;
  const bandY = y;
  y += 84;
  y += 44;
  const footY = y;
  const ctaY = footY + 46;
  const line2Y = ctaY + 38;
  const H = line2Y + 44;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.textBaseline = "alphabetic";

  // ---- 背景 ----
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, -80, 60, W / 2, -80, 720);
  glow.addColorStop(0, pal.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 560);
  const bar = ctx.createLinearGradient(0, 0, W, 0);
  bar.addColorStop(0, pal.accent);
  bar.addColorStop(1, pal.accentDeep);
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, W, 10);

  // ---- 抬头 ----
  setSpacing(ctx, 4);
  drawSegs(ctx, [{ text: t("img.brand"), size: 20, weight: 700, color: pal.muted }], W / 2, brandY, {
    align: "center",
  });
  setSpacing(ctx, 10);
  drawSegs(ctx, [{ text: t("img.docType"), size: 46, weight: 800, color: pal.text, serif: true }], W / 2, docY, {
    align: "center",
  });
  setSpacing(ctx, 0);
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  drawSegs(
    ctx,
    [
      {
        text: t("img.caseNo", { y: now.getFullYear(), n: iso.slice(5, 7) + iso.slice(8, 10) }),
        size: 20,
        color: pal.muted,
        serif: true,
      },
    ],
    W / 2,
    caseY,
    { align: "center" },
  );
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(P, div1Y);
  ctx.lineTo(W - P, div1Y);
  ctx.stroke();
  setSpacing(ctx, 8);
  drawSegs(ctx, [{ text: t("img.finds"), size: 21, weight: 700, color: pal.muted, serif: true }], W / 2, findsY, {
    align: "center",
  });
  setSpacing(ctx, 0);

  // ---- 主张行：logo A ＞ B logo ----
  const logoSize = 96;
  const logoGap = 22;
  const claimSegs: Seg[] = [
    { text: aName, size: 62, weight: 800, color: pal.accent },
    { text: " ＞ ", size: 58, weight: 800, color: pal.accent },
    { text: bName, size: 62, weight: 800, color: pal.muted },
  ];
  {
    const maxTextW = INNER - 2 * (logoSize + logoGap);
    let scale = 1;
    const w0 = segsWidth(ctx, claimSegs);
    if (w0 > maxTextW) scale = Math.max(0.4, maxTextW / w0);
    const textW = segsWidth(ctx, claimSegs, scale);
    const groupW = textW + 2 * (logoSize + logoGap);
    const left = (W - groupW) / 2;
    drawLogo(ctx, pal, logos.get(startId), aName, left, claimCY - logoSize / 2, logoSize);
    drawSegs(
      ctx,
      claimSegs.map((s) => ({ ...s, size: s.size * scale })),
      left + logoSize + logoGap,
      claimCY + 22 * scale,
    );
    drawLogo(ctx, pal, logos.get(endId), bName, left + groupW - logoSize, claimCY - logoSize / 2, logoSize);
  }

  // ---- 传递链示意（多跳时）：A ＞ C ＞ B ----
  if (multi) {
    const segs: Seg[] = [];
    const ids = [path[0].from, ...path.map((e) => e.to)];
    ids.forEach((id, i) => {
      if (i > 0) segs.push({ text: " ＞ ", size: 26, weight: 800, color: pal.accent });
      const color = i === 0 ? pal.accent : i === ids.length - 1 ? pal.muted : pal.text;
      segs.push({ text: teamName(teams, id), size: 26, weight: 700, color });
    });
    drawSegs(ctx, segs, W / 2, chainMapY, { align: "center", maxW: INNER });
  }

  // ---- 徽章行 ----
  const score = (o.arg.chainStrength * 100).toFixed(0);
  const pills: { text: string; accent?: boolean }[] = [
    { text: argKind(path), accent: true },
    { text: t("arg.score", { score }) },
  ];
  const f = o.filters;
  if (f?.end) {
    pills.push({
      text: f.start ? t("img.window", { start: f.start, end: f.end }) : t("img.windowTo", { end: f.end }),
    });
  }
  if (f && f.scope !== "all") pills.push({ text: scopeLabel(f.scope) });
  if (f && f.tally === "game") pills.push({ text: t("img.tallyGame") });
  drawPillRow(ctx, pal, pills, W / 2, pillsCY, INNER);

  // ---- 证据链标题 ----
  setSpacing(ctx, 6);
  ctx.font = font(700, 20);
  const secText = t("img.evidence");
  const secW = ctx.measureText(secText).width;
  setSpacing(ctx, 0);
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(P, sectionY - 7);
  ctx.lineTo(W / 2 - secW / 2 - 18, sectionY - 7);
  ctx.moveTo(W / 2 + secW / 2 + 18, sectionY - 7);
  ctx.lineTo(W - P, sectionY - 7);
  ctx.stroke();
  setSpacing(ctx, 6);
  drawSegs(ctx, [{ text: secText, size: 20, weight: 700, color: pal.muted }], W / 2, sectionY, {
    align: "center",
  });
  setSpacing(ctx, 0);

  // ---- 证据步骤 ----
  path.forEach((e, i) => {
    if (i > 0) drawConnector(ctx, pal, W / 2, stepYs[i - 1].y + stepYs[i - 1].h, stepYs[i].y);
    drawStep(ctx, pal, teams, e, i, P, stepYs[i].y, INNER);
  });

  // ---- 结论条 ----
  rr(ctx, P, bandY, INNER, 84, 14);
  ctx.fillStyle = pal.accentSoft;
  ctx.fill();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  // 靠左排，给右侧印章留出落章位（公文式：正文在左，章压右侧）
  drawSegs(
    ctx,
    [
      {
        text: t("img.therefore", { a: aName, b: bName }),
        size: 33,
        weight: 800,
        color: pal.accent,
        serif: true,
      },
    ],
    P + 28,
    bandY + 54,
    { maxW: INNER - 250 },
  );

  // ---- 页脚 ----
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(P, footY);
  ctx.lineTo(W - P, footY);
  ctx.stroke();
  const url = (location.host + location.pathname).replace(/\/$/, "");
  drawSegs(
    ctx,
    [{ text: t("img.cta", { url }), size: 23, weight: 800, color: pal.accent }],
    P,
    ctaY,
    { maxW: INNER },
  );
  drawSegs(
    ctx,
    [{ text: t("img.disclaimer"), size: 19, color: pal.muted }],
    P,
    line2Y,
    { maxW: INNER * 0.62 },
  );
  drawSegs(
    ctx,
    [{ text: t("img.source", { date: iso }), size: 19, color: pal.muted }],
    W - P,
    line2Y,
    { align: "right", maxW: INNER * 0.36 },
  );

  // ---- 印章（最后画，压在结论/页脚上） ----
  if (getLocale() === "zh") drawSealZh(ctx, pal, W - P - 98, bandY + 98, 94);
  else drawStampEn(ctx, pal, W - P - 158, bandY + 66);

  // 外框
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  return canvas;
}

// ---------- 弹窗 ----------
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function sanitizeName(s: string): string {
  return s.replace(/[^\w一-鿿-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function openShareImage(o: ShareImageOptions): void {
  const startId = o.arg.path[0].from;
  const endId = o.arg.path[o.arg.path.length - 1].to;
  let theme: ThemeId = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  let canvas: HTMLCanvasElement | null = null;
  let seq = 0;

  const overlay = el("div", "share-overlay");
  const dialog = el("div", "share-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  overlay.append(dialog);

  const head = el("div", "share-head");
  head.append(el("h3", "", t("share.title")));
  const seg = el("div", "segmented share-theme");
  const themeBtns = (["light", "dark"] as ThemeId[]).map((id) => {
    const b = el("button", id === theme ? "active" : "", t(`share.${id}`));
    b.addEventListener("click", () => {
      if (theme === id) return;
      theme = id;
      themeBtns.forEach((x) => x.classList.toggle("active", x === b));
      void render();
    });
    seg.append(b);
    return b;
  });
  head.append(seg);
  const closeBtn = el("button", "share-close", "✕");
  closeBtn.setAttribute("aria-label", t("share.close"));
  head.append(closeBtn);
  dialog.append(head);

  const preview = el("div", "share-preview");
  const status = el("p", "share-status", t("share.rendering"));
  preview.append(status);
  dialog.append(preview);

  const actions = el("div", "share-actions");
  const downloadBtn = el("button", "btn primary small", t("share.download"));
  downloadBtn.disabled = true;
  actions.append(downloadBtn);
  const canCopy = typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write;
  const copyBtn = el("button", "btn ghost small", t("share.copy"));
  if (canCopy) {
    copyBtn.disabled = true;
    actions.append(copyBtn);
  }
  actions.append(el("span", "share-hint", t("share.hint")));
  dialog.append(actions);

  async function render() {
    const my = ++seq;
    downloadBtn.disabled = true;
    copyBtn.disabled = true;
    const c = await renderCard(o, startId, endId, theme);
    if (my !== seq || !overlay.isConnected) return;
    canvas = c;
    preview.replaceChildren(c);
    downloadBtn.disabled = false;
    copyBtn.disabled = false;
  }

  downloadBtn.addEventListener("click", () => {
    canvas?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeName(teamName(o.teams, startId))}-vs-${sanitizeName(teamName(o.teams, endId))}-verdict.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }, "image/png");
  });

  copyBtn.addEventListener("click", async () => {
    if (!canvas) return;
    const c = canvas;
    try {
      const item = new ClipboardItem({
        "image/png": new Promise<Blob>((res, rej) =>
          c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
        ),
      });
      await navigator.clipboard.write([item]);
      o.toast(t("share.copied"));
    } catch {
      o.toast(t("share.copyFail"));
    }
  });

  const close = () => {
    overlay.remove();
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  document.body.append(overlay);
  document.body.style.overflow = "hidden";
  void render();
}
