// 分享图：把一条论据渲染成适合贴吧 / Reddit 传播的证据图 PNG。
// 设计目标：单位面积信息量最大——大标题给结论（A ＞ B），正文全是可核验的
// 比赛证据（比分/日期/赛事），额外元素只有站点地址与作者署名；方形章可选。
// 纯 Canvas 2D 手绘，零运行时依赖；队标以 CORS 方式加载，失败退化为首字母
// 头像，保证画布永不被污染、始终可导出。
import type { Argument, Edge, SeriesEvidence } from "../engine/types";
import { t, tc } from "../i18n";
import {
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
// 印章用宋体系，保留篆刻味
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
/** 规则 3 实际列出的场次数（证据优先，最多 3 场）。 */
function rule3Lines(e: Edge): number {
  return e.evidence.kind === "rule3" ? Math.min(3, e.evidence.series.length) : 0;
}

function stepHeight(e: Edge): number {
  if (e.evidence.kind === "rule2") return 172;
  if (e.evidence.kind === "rule3") return 112 + 32 * rule3Lines(e);
  return 112;
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

/** 每张证据卡右侧的结论区宽度：竖排「甲 ＞ 乙」，扫一眼右列即得完整逻辑链。 */
const ZONE_W = 240;

function drawEdgeVerdict(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  teams: Teams,
  e: Edge,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const zx = x + w - ZONE_W - 18;
  rr(ctx, zx, y + 12, ZONE_W, h - 24, 10);
  ctx.fillStyle = pal.accentSoft;
  ctx.globalAlpha = 0.6;
  ctx.fill();
  ctx.globalAlpha = 1;
  const cx = zx + ZONE_W / 2;
  const cy = y + h / 2;
  drawSegs(
    ctx,
    [{ text: teamName(teams, e.from), size: 23, weight: 800, color: pal.text }],
    cx,
    cy - 26,
    { align: "center", maxW: ZONE_W - 20 },
  );
  drawSegs(ctx, [{ text: "＞", size: 30, weight: 800, color: pal.accent }], cx, cy + 9, {
    align: "center",
  });
  drawSegs(
    ctx,
    [{ text: teamName(teams, e.to), size: 23, weight: 700, color: pal.muted }],
    cx,
    cy + 42,
    { align: "center", maxW: ZONE_W - 20 },
  );
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
  rr(ctx, x, y, w, h, 14);
  ctx.fillStyle = pal.card;
  ctx.fill();
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 序号圆
  ctx.beginPath();
  ctx.arc(x + 38, y + 40, 18, 0, Math.PI * 2);
  ctx.fillStyle = pal.accent;
  ctx.fill();
  ctx.font = font(800, 18);
  ctx.fillStyle = "#ffffff";
  const num = String(idx + 1);
  ctx.fillText(num, x + 38 - ctx.measureText(num).width / 2, y + 46);

  // 右侧结论区
  drawEdgeVerdict(ctx, pal, teams, e, x, y, w, h);

  const x0 = x + 68;
  const maxW = w - 92 - ZONE_W - 26;

  if (e.evidence.kind === "rule1") {
    const ev = e.evidence.series;
    drawSegs(ctx, scoreLineSegs(teams, pal, ev, 30), x0, y + 50, { maxW });
    drawSegs(
      ctx,
      [{ text: `${seriesMeta(ev)} · ${ruleName(1)}`, size: 20, color: pal.muted }],
      x0,
      y + 86,
      { maxW },
    );
  } else if (e.evidence.kind === "rule2") {
    const ev = e.evidence;
    drawSegs(
      ctx,
      [{ text: t("img.rule2Line", { via: teamName(teams, ev.via) }), size: 23, weight: 700, color: pal.text }],
      x0,
      y + 46,
      { maxW },
    );
    drawSegs(ctx, scoreLineSegs(teams, pal, ev.aSeries, 25, true), x0, y + 82, { maxW });
    drawSegs(ctx, scoreLineSegs(teams, pal, ev.bSeries, 25, true), x0, y + 116, { maxW });
    drawSegs(
      ctx,
      [{ text: `→ ${formatRule2Note(ev.note)}`, size: 20, weight: 600, color: pal.accent }],
      x0,
      y + 148,
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
      y + 50,
      { maxW },
    );
    const scopeNote = ev.downgraded ? t("link.rule3ScopeNote", { scope: scopeLabel(ev.scopeUsed) }) : "";
    const more = ev.series.length > 3 ? ` ${tc("link.moreMatches", ev.series.length)}` : "";
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
            }) +
            scopeNote +
            more,
          size: 20,
          color: pal.muted,
        },
      ],
      x0,
      y + 86,
      { maxW },
    );
    // 实际场次：证据本体，尽量多列
    ev.series.slice(0, 3).forEach((s, i) => {
      const segs = scoreLineSegs(teams, pal, s, 22, true);
      const lg = leagueLabel(s.league);
      if (lg) segs.push({ text: ` · ${lg}`, size: 18, color: pal.muted });
      drawSegs(ctx, segs, x0, y + 118 + 32 * i, { maxW });
    });
  }
}

function drawConnector(ctx: CanvasRenderingContext2D, pal: Palette, cx: number, y0: number, y1: number) {
  const cy = (y0 + y1) / 2;
  ctx.strokeStyle = pal.muted;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, y0 + 4);
  ctx.lineTo(cx, cy + 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy);
  ctx.lineTo(cx + 6, cy);
  ctx.lineTo(cx, cy + 9);
  ctx.closePath();
  ctx.fillStyle = pal.muted;
  ctx.fill();
}

// ---------- 方形章（2×2 四字：铁证/如山，英文 FA/CT） ----------
function drawSealSquare(ctx: CanvasRenderingContext2D, pal: Palette, cx: number, cy: number, size: number) {
  const chars = [...t("img.seal")].slice(0, 4);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.1);
  ctx.globalAlpha = 0.82;
  ctx.strokeStyle = pal.seal;
  ctx.fillStyle = pal.seal;
  const half = size / 2;
  ctx.lineWidth = 7;
  rr(ctx, -half, -half, size, size, 6);
  ctx.stroke();
  ctx.lineWidth = 2;
  rr(ctx, -half + 9, -half + 9, size - 18, size - 18, 3);
  ctx.stroke();
  ctx.font = font(800, size * 0.32, true);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const q = size / 4;
  const pos: [number, number][] = [
    [-q, -q],
    [q, -q],
    [-q, q],
    [q, q],
  ];
  chars.forEach((ch, i) => ctx.fillText(ch, pos[i][0], pos[i][1] + 2));
  ctx.restore();
}

// ---------- 整图渲染 ----------
const W = 1080;
const P = 64;
const INNER = W - P * 2;

async function renderCard(
  o: ShareImageOptions,
  startId: string,
  endId: string,
  theme: ThemeId,
  stamp: boolean,
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
  y += 30;
  const claimCY = y + 54;
  y += 112;
  let routeY = 0;
  if (multi) {
    y += 34;
    routeY = y;
    y += 6;
  }
  y += 28;
  const sectionY = y + 14;
  y = sectionY + 30;
  const stepYs: { y: number; h: number }[] = [];
  for (let i = 0; i < path.length; i++) {
    if (i > 0) y += 28;
    const h = stepHeight(path[i]);
    stepYs.push({ y, h });
    y += h;
  }
  y += 28;
  const footY = y;
  const footBase = footY + 42;
  // 盖章时底部加高：章落在页脚右侧空白，不压证据卡的结论区
  const H = footY + (stamp ? 150 : 94);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.textBaseline = "alphabetic";

  // ---- 背景 ----
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, -80, 60, W / 2, -80, 640);
  glow.addColorStop(0, pal.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 420);
  const bar = ctx.createLinearGradient(0, 0, W, 0);
  bar.addColorStop(0, pal.accent);
  bar.addColorStop(1, pal.accentDeep);
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, W, 10);

  // ---- 主张行：logo A ＞ B logo ----
  const logoSize = 88;
  const logoGap = 20;
  const claimSegs: Seg[] = [
    { text: aName, size: 60, weight: 800, color: pal.accent },
    { text: " ＞ ", size: 56, weight: 800, color: pal.accent },
    { text: bName, size: 60, weight: 800, color: pal.muted },
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
      claimCY + 21 * scale,
    );
    drawLogo(ctx, pal, logos.get(endId), bName, left + groupW - logoSize, claimCY - logoSize / 2, logoSize);
  }

  // ---- 传递链示意（多跳时）：A ＞ C ＞ B ----
  if (multi) {
    const segs: Seg[] = [];
    const ids = [path[0].from, ...path.map((e) => e.to)];
    ids.forEach((id, i) => {
      if (i > 0) segs.push({ text: " ＞ ", size: 24, weight: 800, color: pal.accent });
      const color = i === 0 ? pal.accent : i === ids.length - 1 ? pal.muted : pal.text;
      segs.push({ text: teamName(teams, id), size: 24, weight: 700, color });
    });
    drawSegs(ctx, segs, W / 2, routeY, { align: "center", maxW: INNER });
  }

  // ---- 证据标题 ----
  setSpacing(ctx, 6);
  ctx.font = font(700, 19);
  const secText = t("img.evidence");
  const secW = ctx.measureText(secText).width;
  setSpacing(ctx, 0);
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(P, sectionY - 7);
  ctx.lineTo(W / 2 - secW / 2 - 16, sectionY - 7);
  ctx.moveTo(W / 2 + secW / 2 + 16, sectionY - 7);
  ctx.lineTo(W - P, sectionY - 7);
  ctx.stroke();
  setSpacing(ctx, 6);
  drawSegs(ctx, [{ text: secText, size: 19, weight: 700, color: pal.muted }], W / 2, sectionY, {
    align: "center",
  });
  setSpacing(ctx, 0);

  // ---- 证据步骤 ----
  path.forEach((e, i) => {
    if (i > 0) drawConnector(ctx, pal, W / 2, stepYs[i - 1].y + stepYs[i - 1].h, stepYs[i].y);
    drawStep(ctx, pal, teams, e, i, P, stepYs[i].y, INNER);
  });

  // ---- 页脚：只有地址 + 署名 ----
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(P, footY);
  ctx.lineTo(W - P, footY);
  ctx.stroke();
  const url = (location.host + location.pathname).replace(/\/$/, "");
  drawSegs(
    ctx,
    [
      { text: url, size: 22, weight: 800, color: pal.accent },
      { text: "   ·   ", size: 19, color: pal.muted },
      { text: t("img.credit"), size: 19, weight: 600, color: pal.muted },
    ],
    P,
    footBase,
    { maxW: INNER - (stamp ? 190 : 0) },
  );

  // ---- 方形章（可选，落在页脚右侧空白） ----
  if (stamp) drawSealSquare(ctx, pal, W - P - 88, footY + 58, 140);

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
  let stampOn = true;
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
  const stampLabel = el("label", "share-opt");
  const stampCb = el("input");
  stampCb.type = "checkbox";
  stampCb.checked = stampOn;
  stampCb.addEventListener("change", () => {
    stampOn = stampCb.checked;
    void render();
  });
  stampLabel.append(stampCb, document.createTextNode(t("share.stamp")));
  head.append(stampLabel);
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
    const c = await renderCard(o, startId, endId, theme, stampOn);
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
