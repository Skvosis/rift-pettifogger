import "./styles.css";
import { loadDataset, type Dataset } from "./data";
import { resolveLogos } from "./logos";
import type { Team } from "../shared/types";
import type { Argument, Filters, Scope, Tally, Verdict } from "./engine/types";
import { defaultFilters, encodeState, decodeState, resolvedEnd } from "./engine/filters";
import { judge } from "./engine/graph";
import { findWinningFilters } from "./engine/mouthhard";
import { verdictToText } from "./ui/copy";
import { RULE_NAME, leagueLabel, name as teamName, stageLabel } from "./ui/describe";
import type { SeriesEvidence } from "./engine/types";
import type { Edge } from "./engine/types";
import { gamesOfSeries } from "./games";

// ---------- 小工具 ----------
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, ...rest } = props as any;
  if (cls) el.className = cls;
  Object.assign(el, rest);
  for (const c of children) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}
const $ = <T extends Element>(sel: string, root: ParentNode = document): T => root.querySelector(sel) as T;

// ---------- 状态 ----------
let dataset: Dataset;
let regionGroups: { region: string; label: string; teams: Team[]; inactive: boolean }[] = [];
/** 近 365 天无比赛的战队（灰显、排区内末尾）。 */
let inactiveTeams = new Set<string>();
const selected: { a: string | null; b: string | null } = { a: null, b: null };
let lastVerdict: Verdict | null = null;

/** 默认判案：滔博 > T1。 */
const DEFAULT_A = "Top Esports";
const DEFAULT_B = "T1";

// ---------- 启动 ----------
init();

async function init() {
  try {
    dataset = await loadDataset();
  } catch (e) {
    $("#data-status").textContent = "数据加载失败：" + String(e);
    return;
  }
  // 活跃度：最近一场比赛在 365 天内
  const lastPlayed = new Map<string, number>();
  for (const s of dataset.series) {
    const t = Date.parse(s.date);
    if ((lastPlayed.get(s.t1) ?? 0) < t) lastPlayed.set(s.t1, t);
    if ((lastPlayed.get(s.t2) ?? 0) < t) lastPlayed.set(s.t2, t);
  }
  const activeCutoff = Date.now() - 365 * 24 * 3.6e6;
  inactiveTeams = new Set(
    dataset.teams.filter((t) => (lastPlayed.get(t.canonical_id) ?? 0) < activeCutoff).map((t) => t.canonical_id),
  );
  regionGroups = groupByRegion(dataset.teams);
  const { years, counts } = dataset.index;
  $("#data-status").textContent = `已载入 ${counts.series.toLocaleString()} 场对阵、${counts.teams} 支战队（${years[0]}–${years[years.length - 1]}）。`;

  setupCombo("a");
  setupCombo("b");
  setupFilters();
  $<HTMLButtonElement>("#judge").addEventListener("click", onJudge);
  $<HTMLButtonElement>("#share").addEventListener("click", onShare);
  $<HTMLButtonElement>("#reset").addEventListener("click", onReset);

  restoreFromUrl();
}

// ---------- 战队选择器（两级：赛区 → 战队） ----------

/** 赛区排序与中文标签。 */
const REGION_META: { match: string[]; label: string }[] = [
  { match: ["China"], label: "LPL 中国" },
  { match: ["Korea"], label: "LCK 韩国" },
  { match: ["EMEA", "Europe"], label: "LEC 欧洲" },
  { match: ["North America", "Americas"], label: "LCS/LTA 美洲" },
  { match: ["Vietnam"], label: "VCS 越南" },
  { match: ["Asia-Pacific", "PCS"], label: "PCS 亚太" },
  { match: ["Brazil"], label: "CBLOL 巴西" },
  { match: ["Latin America", "Latin America North", "Latin America South"], label: "LLA 拉美" },
  { match: ["Japan"], label: "LJL 日本" },
  { match: ["Oceania"], label: "LCO 大洋洲" },
  { match: ["Turkey", "Türkiye (Turkey)"], label: "TCL 土耳其" },
  { match: ["Taiwan"], label: "LMS 台湾" },
  { match: ["Southeast Asia"], label: "GPL 东南亚" },
  { match: ["CIS"], label: "LCL 独联体" },
];

function regionLabel(region: string): { label: string; order: number } {
  for (let i = 0; i < REGION_META.length; i++) {
    if (REGION_META[i].match.includes(region)) return { label: REGION_META[i].label, order: i };
  }
  return { label: region || "其他", order: REGION_META.length + (region ? 0 : 1) };
}

function groupByRegion(
  teams: Team[],
): { region: string; label: string; teams: Team[]; inactive: boolean }[] {
  const map = new Map<string, Team[]>();
  for (const t of teams) {
    const key = t.region || "";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  const isInactive = (t: Team) => inactiveTeams.has(t.canonical_id);
  return [...map.entries()]
    .map(([region, list]) => ({
      region,
      ...regionLabel(region),
      // 活跃在前、不活跃灰显在后，各自按名称排序
      teams: list.sort(
        (a, b) =>
          Number(isInactive(a)) - Number(isInactive(b)) || a.display_name.localeCompare(b.display_name),
      ),
      inactive: list.every(isInactive),
    }))
    // 含活跃战队的赛区在前，全员不活跃的赛区灰显垫底
    .sort(
      (a, b) =>
        Number(a.inactive) - Number(b.inactive) || a.order - b.order || a.label.localeCompare(b.label),
    )
    .map(({ region, label, teams, inactive }) => ({ region, label, teams, inactive }));
}

/** 曾用名列表（去重、剔除与显示名相同者，最多 3 个）。 */
function formerNames(t: Team): string[] {
  const seen = new Set<string>([t.display_name.toLowerCase()]);
  const out: string[] = [];
  for (const a of t.aliases) {
    const k = a.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
    if (out.length >= 3) break;
  }
  return out;
}

function teamRow(t: Team, onPick: (t: Team) => void): HTMLElement {
  const former = formerNames(t);
  const inactive = inactiveTeams.has(t.canonical_id);
  const li = h("li", { class: "team-row" + (inactive ? " inactive" : "") } as any, [
    logoEl(t.canonical_id, t.display_name),
    h("span", { class: "team-name" }, [
      t.display_name,
      ...(inactive ? [h("span", { class: "former" }, ["（已不活跃）"])] : []),
      ...(former.length ? [h("span", { class: "former" }, [`（曾用名 ${former.join("、")}）`])] : []),
    ]),
  ]);
  li.addEventListener("click", () => onPick(t));
  return li;
}

/** 队标元素：先放首字母头像，异步解析到 URL 后替换（同队可同时出现在多处）。 */
function logoEl(teamId: string, display: string): HTMLElement {
  const known = logoUrls.get(teamId);
  if (known) return logoImg(known);
  const holder = h("span", { class: "team-logo" }, [display.slice(0, 2)]);
  pendingLogoIds.add(teamId);
  let holders = logoHolders.get(teamId);
  if (!holders) logoHolders.set(teamId, (holders = []));
  holders.push(holder);
  scheduleLogoResolve();
  return holder;
}

function logoImg(url: string): HTMLElement {
  const img = h("img", { src: url, alt: "", loading: "lazy" } as any);
  img.className = "team-logo img";
  return img;
}

const pendingLogoIds = new Set<string>();
const logoHolders = new Map<string, HTMLElement[]>();
const logoUrls = new Map<string, string>();
let logoTimer: number | undefined;
function scheduleLogoResolve() {
  clearTimeout(logoTimer);
  logoTimer = window.setTimeout(async () => {
    const ids = [...pendingLogoIds];
    pendingLogoIds.clear();
    if (!ids.length) return;
    const urls = await resolveLogos(ids);
    for (const [id, url] of urls) {
      logoUrls.set(id, url);
      for (const holder of logoHolders.get(id) ?? []) {
        if (holder.isConnected) holder.replaceWith(logoImg(url));
      }
      logoHolders.delete(id);
    }
  }, 80);
}

function setTrigger(side: "a" | "b", team: Team | null) {
  const root = $<HTMLElement>(`.combo[data-side="${side}"]`);
  const trigger = $<HTMLButtonElement>(".combo-trigger", root);
  if (team) {
    trigger.replaceChildren(logoEl(team.canonical_id, team.display_name), h("span", {}, [team.display_name]));
    root.classList.add("selected");
  } else {
    trigger.replaceChildren(h("span", { class: "placeholder" }, ["选择战队…"]));
    root.classList.remove("selected");
  }
}

function setupCombo(side: "a" | "b") {
  const root = $<HTMLElement>(`.combo[data-side="${side}"]`);
  const trigger = $<HTMLButtonElement>(".combo-trigger", root);
  const panel = $<HTMLElement>(".combo-panel", root);
  const filter = $<HTMLInputElement>(".combo-filter", root);
  const regionList = $<HTMLUListElement>(".region-list", root);
  const teamList = $<HTMLUListElement>(".team-list", root);
  let activeRegion = 0;

  const pick = (t: Team) => {
    selected[side] = t.canonical_id;
    setTrigger(side, t);
    close();
  };

  const renderRegions = () => {
    regionList.replaceChildren(
      ...regionGroups.map((g, i) => {
        const cls = [i === activeRegion ? "active" : "", g.inactive ? "inactive" : ""]
          .filter(Boolean)
          .join(" ");
        const li = h("li", { class: cls } as any, [
          g.label,
          h("span", { class: "count" }, [String(g.teams.length)]),
        ]);
        li.addEventListener("click", (e) => {
          // 重渲染会把被点元素移出 DOM，阻止冒泡以免"点击面板外关闭"误判
          e.stopPropagation();
          activeRegion = i;
          renderRegions();
          renderTeams();
        });
        return li;
      }),
    );
  };

  const renderTeams = () => {
    const q = filter.value.trim().toLowerCase();
    if (q) {
      // 过滤模式：跨赛区全量筛（支持曾用名）
      const matched: Team[] = [];
      for (const g of regionGroups) {
        for (const t of g.teams) {
          const hay = [t.display_name, t.canonical_id, ...t.aliases].join(" ").toLowerCase();
          if (hay.includes(q)) matched.push(t);
          if (matched.length >= 40) break;
        }
      }
      teamList.replaceChildren(
        ...(matched.length ? matched.map((t) => teamRow(t, pick)) : [h("li", { class: "none" }, ["无匹配战队"])]),
      );
    } else {
      const g = regionGroups[activeRegion];
      teamList.replaceChildren(...(g ? g.teams.map((t) => teamRow(t, pick)) : []));
    }
  };

  const open = () => {
    panel.hidden = false;
    filter.value = "";
    renderRegions();
    renderTeams();
    filter.focus();
  };
  const close = () => {
    panel.hidden = true;
  };

  trigger.addEventListener("click", () => (panel.hidden ? open() : close()));
  filter.addEventListener("input", renderTeams);
  filter.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Enter") {
      const first = teamList.querySelector<HTMLElement>(".team-row");
      first?.click();
    }
  });
  document.addEventListener("click", (e) => {
    if (!root.contains(e.target as Node)) close();
  });
}

// ---------- 过滤器 ----------
function setupFilters() {
  document.querySelectorAll<HTMLElement>(".segmented").forEach((seg) => {
    seg.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        seg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  });
}

function readFilters(): Filters {
  const f = defaultFilters();
  f.start = $<HTMLInputElement>("#f-start").value || null;
  f.end = $<HTMLInputElement>("#f-end").value || null;
  f.scope = activeSeg("scope") as Scope;
  f.tally = activeSeg("tally") as Tally;
  f.proximityDays = Number($<HTMLInputElement>("#f-prox").value) || 90;
  f.crossFormat = activeSeg("xf") as Filters["crossFormat"];
  f.maxChainLen = Number(activeSeg("len")) || 3;
  return f;
}

function writeFilters(f: Filters) {
  $<HTMLInputElement>("#f-start").value = f.start ?? "";
  $<HTMLInputElement>("#f-end").value = f.end ?? "";
  setSeg("scope", f.scope);
  setSeg("tally", f.tally);
  $<HTMLInputElement>("#f-prox").value = String(f.proximityDays);
  setSeg("xf", f.crossFormat);
  setSeg("len", String(f.maxChainLen));
  // 与默认值有差异时自动展开过滤器面板
  const d = defaultFilters();
  if (
    f.start !== d.start ||
    f.end !== d.end ||
    f.scope !== d.scope ||
    f.tally !== d.tally ||
    f.proximityDays !== d.proximityDays ||
    f.crossFormat !== d.crossFormat ||
    f.maxChainLen !== d.maxChainLen
  ) {
    $<HTMLDetailsElement>(".filters").open = true;
  }
}

function activeSeg(nameAttr: string): string {
  const seg = $<HTMLElement>(`.segmented[data-name="${nameAttr}"]`);
  return $<HTMLElement>("button.active", seg).dataset.val!;
}
function setSeg(nameAttr: string, val: string) {
  const seg = $<HTMLElement>(`.segmented[data-name="${nameAttr}"]`);
  seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.val === val));
}

// ---------- 判案 ----------
function onJudge() {
  if (!selected.a || !selected.b) return toast("请先选择两支战队");
  if (selected.a === selected.b) return toast("A、B 不能是同一支战队");
  const filters = readFilters();
  const filtered = filterByEnd(filters);
  lastVerdict = judge(dataset.series, selected.a, selected.b, filtered);
  renderVerdict(lastVerdict, filtered);
  updateUrl(filters);
}

/** end=null 归一为今天。 */
function filterByEnd(f: Filters): Filters {
  return f.end ? f : { ...f, end: resolvedEnd(f) };
}

// ---------- 渲染 ----------
function renderVerdict(v: Verdict, filters: Filters) {
  const root = $<HTMLElement>("#results");
  root.replaceChildren();
  const a = teamName(dataset.teamById, v.a);
  const b = teamName(dataset.teamById, v.b);

  // 正方
  const head = h("div", { class: "verdict-head" }, [
    h("h2", {}, [spanCls("a", a), document.createTextNode(" 强于 "), spanCls("b", b)]),
    h("span", { class: "count-pill" }, [`${v.forward.length} 条论据`]),
  ]);
  const copyBtn = h("button", { class: "btn ghost small", onclick: () => onCopy(filters) } as any, ["一键复制论据"]);
  head.append(copyBtn);
  root.append(head);

  if (v.forward.length) {
    root.append(renderArgList(v.forward, "forward"));
  } else {
    root.append(
      h("div", { class: "empty" }, [
        h("strong", {}, [`暂时找不到「${a} > ${b}」的论据链。`]),
        h("br"),
        document.createTextNode(v.hint ?? ""),
      ]),
    );
    root.append(renderMouthHard(v, filters));
  }

  // 反方
  if (v.reverse.length) {
    const details = h("details", { class: "reverse-section reverse" });
    details.append(
      h("summary", {}, [`对方可能这样反驳你：${b} 强于 ${a}（${v.reverse.length} 条）`]),
    );
    details.append(renderArgList(v.reverse, "reverse"));
    root.append(details);
  }

  root.scrollIntoView({ behavior: "smooth", block: "start" });
}

function spanCls(cls: string, text: string) {
  return h("span", { class: cls }, [text]);
}

function renderArgList(args: Argument[], variant: "forward" | "reverse"): HTMLElement {
  const wrap = h("div", { class: variant });
  const limit = 5;
  const initial = args.slice(0, limit);
  for (const arg of initial) wrap.append(renderArg(arg));
  if (args.length > limit) {
    const rest = args.slice(limit);
    const btn = h("button", { class: "more-btn" }, [`展开其余 ${rest.length} 条论据`]);
    btn.addEventListener("click", () => {
      for (const arg of rest) wrap.insertBefore(renderArg(arg), btn);
      btn.remove();
    });
    wrap.append(btn);
  }
  return wrap;
}

function renderArg(arg: Argument): HTMLElement {
  const card = h("div", { class: "arg-card" });
  const kind = arg.path.length === 1 ? RULE_NAME[arg.path[0].rule] : `传递链 · ${arg.path.length} 环`;
  const score = (arg.chainStrength * 100).toFixed(0);
  card.append(
    h("div", { class: "arg-head" }, [
      h("span", { class: "arg-kind" }, [kind]),
      h("span", { class: "arg-score", title: "综合规则可信度、赛事级别、阶段、赛制与新旧的含金量评分" }, [
        `含金量 ${score}`,
      ]),
    ]),
  );
  const chain = h("div", { class: "chain-row" });
  arg.path.forEach((e, i) => {
    if (i > 0) chain.append(h("div", { class: "chain-arrow" }, ["→"]));
    chain.append(renderLinkBox(e));
  });
  card.append(chain);
  return card;
}

/** 队徽 + 下方小字全名。 */
function teamChip(id: string, opts: { dim?: boolean } = {}): HTMLElement {
  const chip = h("div", { class: "team-chip" + (opts.dim ? " dim" : "") });
  chip.append(logoEl(id, teamName(dataset.teamById, id)));
  chip.append(h("span", { class: "chip-name" }, [teamName(dataset.teamById, id)]));
  chip.title = teamName(dataset.teamById, id);
  return chip;
}

/** 一场 series 的比分行：队徽 比分 队徽 + 赛区/阶段/日期徽标。 */
function matchLine(ev: SeriesEvidence): HTMLElement {
  const won = ev.selfScore > ev.oppScore;
  const line = h("div", { class: "match-line" });
  const score = h("div", { class: "score" }, [
    h("span", { class: won ? "win" : "loss" }, [String(ev.selfScore)]),
    h("span", { class: "colon" }, [":"]),
    h("span", { class: won ? "loss" : "win" }, [String(ev.oppScore)]),
  ]);
  const row = h("div", { class: "match-teams" }, [teamChip(ev.self), score, teamChip(ev.opp)]);
  line.append(row);
  const meta = h("div", { class: "match-meta" });
  const lg = leagueLabel(ev.league);
  if (lg) meta.append(h("span", { class: "badge league" + (ev.tier !== "domestic" ? " intl" : "") }, [lg]));
  const st = stageLabel(ev.stage);
  if (st) meta.append(h("span", { class: "badge stage" + (ev.stage === "final" ? " final" : "") }, [st]));
  meta.append(h("span", { class: "badge bo" }, [`Bo${ev.best_of}`]));
  meta.append(h("span", { class: "date" }, [ev.date.slice(0, 10)]));
  if (ev.flags.includes("ff")) meta.append(h("span", { class: "badge warn" }, ["含弃权"]));
  const src = h("a", { href: ev.url, target: "_blank", rel: "noreferrer", title: "查看出处" } as any, ["出处↗"]);
  src.className = "src-link";
  meta.append(src);
  appendGameExpand(meta, ev.id, ev.date);
  line.append(meta);
  return line;
}

/** 一环：上方比赛，下方结论（谁 > 谁 + 规则依据）。 */
function renderLinkBox(e: Edge): HTMLElement {
  const box = h("div", { class: "link-box" });
  const matches = h("div", { class: "link-matches" });
  if (e.evidence.kind === "rule1") {
    matches.append(matchLine(e.evidence.series));
  } else if (e.evidence.kind === "rule2") {
    matches.append(matchLine(e.evidence.aSeries));
    matches.append(matchLine(e.evidence.bSeries));
    matches.append(h("div", { class: "link-note" }, [e.evidence.note]));
  } else {
    const ev = e.evidence;
    const caption = ev.tally === "game" ? "小局" : "大局";
    const scopeNote = ev.downgraded ? `（口径已收窄：${scopeText(ev.scopeUsed)}）` : "";
    matches.append(
      h("div", { class: "link-note strong" }, [
        `历史战绩 ${ev.wins}-${ev.total - ev.wins}（按${caption}，胜率 ${(ev.rate * 100).toFixed(0)}%）${scopeNote}`,
      ]),
    );
    for (const s of ev.series.slice(0, 3)) matches.append(matchLine(s));
    if (ev.series.length > 3) {
      matches.append(h("div", { class: "link-note" }, [`…共 ${ev.series.length} 场交手`]));
    }
  }
  box.append(matches);
  box.append(
    h("div", { class: "link-verdict" }, [
      teamChip(e.from),
      h("span", { class: "gt" }, ["＞"]),
      teamChip(e.to, { dim: true }),
      h("span", { class: "verdict-rule" }, [RULE_NAME[e.rule]]),
    ]),
  );
  return box;
}

function scopeText(s: string): string {
  return s === "worlds" ? "仅 Worlds" : s === "international" ? "国际赛" : "全部";
}

/** 比分行上的“逐局”按需展开。 */
function appendGameExpand(meta: HTMLElement, seriesId: string, date: string) {
  const btn = h("a", { href: "javascript:void 0", class: "games-toggle" } as any, ["逐局"]);
  btn.addEventListener("click", async () => {
    const games = await gamesOfSeries(seriesId, date);
    const text = games.length
      ? games.map((g) => `G${g.game_n} ${teamName(dataset.teamById, g.winner)}`).join(" / ")
      : "暂无逐局数据";
    btn.replaceWith(h("span", { class: "games-detail" }, [text]));
  });
  meta.append(btn);
}

// ---------- 嘴硬模式 ----------
function renderMouthHard(v: Verdict, base: Filters): HTMLElement {
  const box = h("div", { class: "mouthhard" });
  box.append(h("h3", {}, ["嘴硬模式"]));
  box.append(h("p", { class: "sub" }, ["当前设置洗不动？让我自动找出能让你赢的过滤器组合。"]));
  const btn = h("button", { class: "btn primary small" }, ["帮我找赢面"]);
  box.append(btn);
  const out = h("div", {});
  box.append(out);
  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = "搜索中…";
    setTimeout(() => {
      const sugs = findWinningFilters(dataset.series, v.a, v.b, base, 6);
      btn.remove();
      if (!sugs.length) {
        out.append(h("p", { class: "sub" }, ["穷尽所有过滤器组合仍找不到赢面——这盘是真的没法洗。"]));
        return;
      }
      for (const s of sugs) {
        const row = h("div", { class: "suggestion" }, [
          h("div", { class: "labels" }, [
            document.createTextNode(s.changeLabels.join("，") || "调整过滤器"),
            h("div", { class: "meta" }, [`${s.count >= 5 ? "5+" : s.count} 条论据 · 最短 ${s.shortest} 跳`]),
          ]),
          h("button", { class: "btn ghost small" }, ["套用并判案"]),
        ]);
        $<HTMLButtonElement>("button", row).addEventListener("click", () => {
          writeFilters(s.filters);
          onJudge();
        });
        out.append(row);
      }
    }, 30);
  });
  return box;
}

// ---------- 复制 / 分享 ----------
async function onCopy(filters: Filters) {
  if (!lastVerdict) return;
  const url = location.origin + location.pathname + "?" + encodeState(selected.a, selected.b, filters);
  const text = verdictToText(dataset.teamById, lastVerdict, {
    shareUrl: url,
    includeReverse: true,
  });
  await copyText(text);
  toast("论据已复制到剪贴板");
}

async function onShare() {
  const filters = readFilters();
  const url = location.origin + location.pathname + "?" + encodeState(selected.a, selected.b, filters);
  await copyText(url);
  updateUrl(filters);
  toast("可复现链接已复制");
}

function onReset() {
  selected.a = selected.b = null;
  lastVerdict = null;
  setTrigger("a", null);
  setTrigger("b", null);
  writeFilters(defaultFilters());
  $<HTMLElement>("#results").replaceChildren();
  history.replaceState(null, "", location.pathname);
}

// ---------- URL 状态 ----------
function updateUrl(filters: Filters) {
  const q = encodeState(selected.a, selected.b, filters);
  history.replaceState(null, "", q ? "?" + q : location.pathname);
}

function restoreFromUrl() {
  const { a: qa, b: qb, filters } = decodeState(location.search);
  writeFilters(filters);
  // 无 URL 参数时的默认判案：滔博 > T1
  const fresh = !qa && !qb;
  const a = qa ?? (fresh ? DEFAULT_A : null);
  const b = qb ?? (fresh ? DEFAULT_B : null);
  if (a && dataset.teamById.has(a)) {
    selected.a = a;
    setTrigger("a", dataset.teamById.get(a)!);
  }
  if (b && dataset.teamById.has(b)) {
    selected.b = b;
    setTrigger("b", dataset.teamById.get(b)!);
  }
  if (selected.a && selected.b) onJudge();
}

// ---------- 通用 UI ----------
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h("textarea", { value: text } as any);
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

let toastTimer: number | undefined;
function toast(msg: string) {
  let el = $<HTMLElement>(".toast");
  if (!el) {
    el = h("div", { class: "toast" });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 2200);
}
