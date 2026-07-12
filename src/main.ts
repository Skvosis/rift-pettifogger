import "./styles.css";
import { loadDataset, type Dataset } from "./data";
import { resolveLogos } from "./logos";
import type { Team } from "../shared/types";
import type { Argument, Edge, Filters, Scope, SeriesEvidence, Tally, Verdict } from "./engine/types";
import { CHAIN_LEN_UNLIMITED, defaultFilters, encodeState, decodeState, resolvedEnd } from "./engine/filters";
import { judge } from "./engine/graph";
import { findWinningFilters } from "./engine/mouthhard";
import { verdictToText } from "./ui/copy";
import { openShareImage } from "./ui/sharecard";
import {
  argKind,
  formatFilterChange,
  formatHint,
  formatRule2Note,
  leagueLabel,
  name as teamName,
  ruleName,
  scopeLabel,
  stageLabel,
} from "./ui/describe";
import { gamesOfSeries } from "./games";
import { getLocale, onLocaleChange, setLocale, t, tc, type Locale } from "./i18n";

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
/** 中/英文列表连接符（曾用名、嘴硬改动项等枚举文本）。 */
const listJoiner = () => (getLocale() === "en" ? ", " : "、");

// ---------- 状态 ----------
let dataset: Dataset;
let regionGroups: { region: string; label: string; teams: Team[]; inactive: boolean }[] = [];
/** 近 365 天无比赛的战队（灰显、排区内末尾）。 */
let inactiveTeams = new Set<string>();
const selected: { a: string | null; b: string | null } = { a: null, b: null };
let lastVerdict: Verdict | null = null;
let lastFilters: Filters | null = null;
let datasetSummary: { series: number; teams: number; y0: number; y1: number } | null = null;
let loadError: string | null = null;

/** 默认判案：滔博 > T1。 */
const DEFAULT_A = "Top Esports";
const DEFAULT_B = "T1";

// ---------- 启动 ----------
init();

async function init() {
  applyStaticTranslations();
  setupLangSwitch();
  updateDataStatus();
  try {
    dataset = await loadDataset();
  } catch (e) {
    loadError = String(e);
    updateDataStatus();
    return;
  }
  // 活跃度：最近一场比赛在 365 天内
  const lastPlayed = new Map<string, number>();
  for (const s of dataset.series) {
    const ts = Date.parse(s.date);
    if ((lastPlayed.get(s.t1) ?? 0) < ts) lastPlayed.set(s.t1, ts);
    if ((lastPlayed.get(s.t2) ?? 0) < ts) lastPlayed.set(s.t2, ts);
  }
  const activeCutoff = Date.now() - 365 * 24 * 3.6e6;
  inactiveTeams = new Set(
    dataset.teams.filter((tm) => (lastPlayed.get(tm.canonical_id) ?? 0) < activeCutoff).map((tm) => tm.canonical_id),
  );
  regionGroups = groupByRegion(dataset.teams);
  const { years, counts } = dataset.index;
  datasetSummary = { series: counts.series, teams: counts.teams, y0: years[0], y1: years[years.length - 1] };
  updateDataStatus();

  setupCombo("a");
  setupCombo("b");
  setupFilters();
  $<HTMLButtonElement>("#judge").addEventListener("click", onJudge);
  $<HTMLButtonElement>("#share").addEventListener("click", onShare);
  $<HTMLButtonElement>("#reset").addEventListener("click", onReset);

  restoreFromUrl();
}

// ---------- i18n 应用 ----------
function applyStaticTranslations() {
  document.documentElement.lang = getLocale() === "zh" ? "zh-CN" : "en";
  document.title = t("meta.title");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("meta.description"));
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml!);
  });
  document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder!);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle!);
  });
  document.querySelectorAll<HTMLButtonElement>(".lang-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === getLocale());
  });
}

function setupLangSwitch() {
  document.querySelectorAll<HTMLButtonElement>(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => setLocale(btn.dataset.lang as Locale));
  });
  onLocaleChange(() => {
    applyStaticTranslations();
    onLocaleUpdated();
  });
}

/** 语言切换后需要重新生成的动态内容（静态 data-i18n 元素已由 applyStaticTranslations 处理）。 */
function onLocaleUpdated() {
  updateDataStatus();
  updateLenOutput(); // 链长滑块的"不限"文案随语言切换
  if (!dataset) return; // 数据尚未加载完成
  regionGroups = groupByRegion(dataset.teams);
  // 打开中的选择面板内容按旧语言渲染，直接关闭；下次打开会用新语言重建
  document.querySelectorAll<HTMLElement>(".combo-panel").forEach((p) => (p.hidden = true));
  setTrigger("a", selected.a ? dataset.teamById.get(selected.a) ?? null : null);
  setTrigger("b", selected.b ? dataset.teamById.get(selected.b) ?? null : null);
  if (lastVerdict && lastFilters) renderVerdict(lastVerdict, lastFilters);
}

function updateDataStatus() {
  const el = $<HTMLElement>("#data-status");
  if (loadError) {
    el.textContent = t("status.loadFailed", { error: loadError });
    return;
  }
  if (!datasetSummary) {
    el.textContent = t("status.loading");
    return;
  }
  const { series, teams, y0, y1 } = datasetSummary;
  el.textContent = t("status.loaded", { series: series.toLocaleString(), teams, y0, y1 });
}

// ---------- 战队选择器（两级：赛区 → 战队） ----------

/** 赛区排序与展示 key（label 通过 i18n 查表）。 */
const REGION_META: { match: string[]; key: string }[] = [
  { match: ["China"], key: "LPL" },
  { match: ["Korea"], key: "LCK" },
  { match: ["EMEA", "Europe"], key: "LEC" },
  { match: ["North America", "Americas"], key: "LCS_LTA" },
  { match: ["Vietnam"], key: "VCS" },
  { match: ["Asia-Pacific", "PCS"], key: "PCS" },
  { match: ["Brazil"], key: "CBLOL" },
  { match: ["Latin America", "Latin America North", "Latin America South"], key: "LLA" },
  { match: ["Japan"], key: "LJL" },
  { match: ["Oceania"], key: "LCO" },
  { match: ["Turkey", "Türkiye (Turkey)"], key: "TCL" },
  { match: ["Taiwan"], key: "LMS" },
  { match: ["Southeast Asia"], key: "GPL" },
  { match: ["CIS"], key: "LCL" },
];

function regionLabel(region: string): { label: string; order: number } {
  for (let i = 0; i < REGION_META.length; i++) {
    if (REGION_META[i].match.includes(region)) return { label: t(`region.${REGION_META[i].key}`), order: i };
  }
  return { label: region || t("region.other"), order: REGION_META.length + (region ? 0 : 1) };
}

function groupByRegion(
  teams: Team[],
): { region: string; label: string; teams: Team[]; inactive: boolean }[] {
  const map = new Map<string, Team[]>();
  for (const team of teams) {
    const key = team.region || "";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(team);
  }
  const isInactive = (team: Team) => inactiveTeams.has(team.canonical_id);
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
function formerNames(team: Team): string[] {
  const seen = new Set<string>([team.display_name.toLowerCase()]);
  const out: string[] = [];
  for (const a of team.aliases) {
    const k = a.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
    if (out.length >= 3) break;
  }
  return out;
}

function teamRow(team: Team, onPick: (team: Team) => void): HTMLElement {
  const former = formerNames(team);
  const inactive = inactiveTeams.has(team.canonical_id);
  const li = h("li", { class: "team-row" + (inactive ? " inactive" : "") } as any, [
    logoEl(team.canonical_id, team.display_name),
    h("span", { class: "team-name" }, [
      team.display_name,
      ...(inactive ? [h("span", { class: "former" }, [t("picker.inactive")])] : []),
      ...(former.length
        ? [h("span", { class: "former" }, [t("picker.formerNames", { names: former.join(listJoiner()) })])]
        : []),
    ]),
  ]);
  li.addEventListener("click", () => onPick(team));
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
  // Fandom CDN 对带 Referer 的热链返回 404 占位图，必须以 no-referrer 请求
  const img = h("img", { src: url, alt: "", loading: "lazy", referrerPolicy: "no-referrer" } as any);
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
    trigger.replaceChildren(h("span", { class: "placeholder" }, [t("picker.selectTeam")]));
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

  const pick = (team: Team) => {
    selected[side] = team.canonical_id;
    setTrigger(side, team);
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
        for (const team of g.teams) {
          const hay = [team.display_name, team.canonical_id, ...team.aliases].join(" ").toLowerCase();
          if (hay.includes(q)) matched.push(team);
          if (matched.length >= 40) break;
        }
      }
      teamList.replaceChildren(
        ...(matched.length
          ? matched.map((team) => teamRow(team, pick))
          : [h("li", { class: "none" }, [t("picker.noMatch")])]),
      );
    } else {
      const g = regionGroups[activeRegion];
      teamList.replaceChildren(...(g ? g.teams.map((team) => teamRow(team, pick)) : []));
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
  // 日期文本框：失焦时归一化（接受 2026/7/1、2026.7.1、2026年7月1日 等写法，非法则清空）
  for (const id of ["#f-start", "#f-end"]) {
    const input = $<HTMLInputElement>(id);
    input.addEventListener("blur", () => {
      input.value = parseDateInput(input.value) ?? "";
    });
  }
  // 链长滑块：滑动时实时更新数值显示
  $<HTMLInputElement>("#f-len").addEventListener("input", updateLenOutput);
}

/** 宽松解析日期输入 -> "yyyy-mm-dd"；无法解析返回 null。 */
function parseDateInput(raw: string): string | null {
  const v = raw
    .trim()
    .replace(/[/.年月]/g, "-")
    .replace(/日/g, "")
    .replace(/-+$/, "");
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (!m) return null;
  const [mo, d] = [Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 滑块位置 1..6 ↔ 链长 1..5 / 不限（引擎值 7）。 */
function lenFromSlider(pos: number): number {
  return pos >= 6 ? CHAIN_LEN_UNLIMITED : Math.max(1, pos);
}
function sliderFromLen(len: number): number {
  return len >= 6 ? 6 : len;
}
function updateLenOutput() {
  const len = lenFromSlider(Number($<HTMLInputElement>("#f-len").value) || 3);
  $<HTMLOutputElement>("#f-len-out").textContent =
    len === CHAIN_LEN_UNLIMITED ? t("filter.unlimited") : String(len);
}

function readFilters(): Filters {
  const f = defaultFilters();
  f.start = parseDateInput($<HTMLInputElement>("#f-start").value);
  f.end = parseDateInput($<HTMLInputElement>("#f-end").value);
  f.scope = activeSeg("scope") as Scope;
  f.tally = activeSeg("tally") as Tally;
  f.proximityDays = Number($<HTMLInputElement>("#f-prox").value) || 90;
  f.crossFormat = activeSeg("xf") as Filters["crossFormat"];
  f.maxChainLen = lenFromSlider(Number($<HTMLInputElement>("#f-len").value) || 3);
  return f;
}

function writeFilters(f: Filters) {
  $<HTMLInputElement>("#f-start").value = f.start ?? "";
  $<HTMLInputElement>("#f-end").value = f.end ?? "";
  setSeg("scope", f.scope);
  setSeg("tally", f.tally);
  $<HTMLInputElement>("#f-prox").value = String(f.proximityDays);
  setSeg("xf", f.crossFormat);
  $<HTMLInputElement>("#f-len").value = String(sliderFromLen(f.maxChainLen));
  updateLenOutput();
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
  if (!selected.a || !selected.b) return toast(t("toast.selectBoth"));
  if (selected.a === selected.b) return toast(t("toast.sameTeam"));
  const filters = readFilters();
  const filtered = filterByEnd(filters);
  lastVerdict = judge(dataset.series, selected.a, selected.b, filtered);
  lastFilters = filtered;
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
    h("h2", {}, [spanCls("a", a), document.createTextNode(t("verdict.strongerThan")), spanCls("b", b)]),
    h("span", { class: "count-pill" }, [tc("verdict.countPill", v.forward.length)]),
  ]);
  const copyBtn = h("button", { class: "btn ghost small", onclick: () => onCopy(filters) } as any, [
    t("verdict.copyButton"),
  ]);
  head.append(copyBtn);
  root.append(head);

  if (v.forward.length) {
    root.append(renderArgList(v.forward, "forward"));
  } else {
    root.append(
      h("div", { class: "empty" }, [
        h("strong", {}, [t("verdict.emptyHeadline", { a, b })]),
        h("br"),
        document.createTextNode(v.hint ? formatHint(v.hint) : ""),
      ]),
    );
    root.append(renderMouthHard(v, filters));
  }

  // 反方
  if (v.reverse.length) {
    const details = h("details", { class: "reverse-section reverse" });
    details.append(h("summary", {}, [tc("verdict.reverseSummary", v.reverse.length, { a, b })]));
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
    const btn = h("button", { class: "more-btn" }, [tc("verdict.moreButton", rest.length)]);
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
  const score = (arg.chainStrength * 100).toFixed(0);
  const imgBtn = h("button", { class: "arg-img-btn" }, [t("arg.image")]);
  imgBtn.addEventListener("click", () =>
    openShareImage({ teams: dataset.teamById, arg, filters: lastFilters, toast }),
  );
  card.append(
    h("div", { class: "arg-head" }, [
      h("span", { class: "arg-kind" }, [argKind(arg.path)]),
      h("span", { class: "arg-score", title: t("arg.scoreTooltip") }, [t("arg.score", { score })]),
      imgBtn,
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
  if (ev.flags.includes("ff")) meta.append(h("span", { class: "badge warn" }, [t("flag.ff")]));
  const src = h(
    "a",
    { href: ev.url, target: "_blank", rel: "noreferrer", title: t("link.sourceTitle") } as any,
    [t("link.source")],
  );
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
    matches.append(h("div", { class: "link-note" }, [formatRule2Note(e.evidence.note)]));
  } else {
    const ev = e.evidence;
    const tally = t(`tally.${ev.tally}`);
    const scopeNote = ev.downgraded ? t("link.rule3ScopeNote", { scope: scopeLabel(ev.scopeUsed) }) : "";
    matches.append(
      h("div", { class: "link-note strong" }, [
        t("link.rule3Summary", {
          wins: ev.wins,
          losses: ev.total - ev.wins,
          tally,
          rate: (ev.rate * 100).toFixed(0),
        }) + scopeNote,
      ]),
    );
    for (const s of ev.series.slice(0, 3)) matches.append(matchLine(s));
    if (ev.series.length > 3) {
      matches.append(h("div", { class: "link-note" }, [tc("link.moreMatches", ev.series.length)]));
    }
  }
  box.append(matches);
  box.append(
    h("div", { class: "link-verdict" }, [
      teamChip(e.from),
      h("span", { class: "gt" }, ["＞"]),
      teamChip(e.to, { dim: true }),
      h("span", { class: "verdict-rule" }, [ruleName(e.rule)]),
    ]),
  );
  return box;
}

/** 比分行上的“逐局”按需展开。 */
function appendGameExpand(meta: HTMLElement, seriesId: string, date: string) {
  const btn = h("a", { href: "javascript:void 0", class: "games-toggle" } as any, [t("link.games")]);
  btn.addEventListener("click", async () => {
    const games = await gamesOfSeries(seriesId, date);
    const text = games.length
      ? games.map((g) => `G${g.game_n} ${teamName(dataset.teamById, g.winner)}`).join(" / ")
      : t("link.noGames");
    btn.replaceWith(h("span", { class: "games-detail" }, [text]));
  });
  meta.append(btn);
}

// ---------- 嘴硬模式 ----------
function renderMouthHard(v: Verdict, base: Filters): HTMLElement {
  const box = h("div", { class: "mouthhard" });
  box.append(h("h3", {}, [t("mouthhard.title")]));
  box.append(h("p", { class: "sub" }, [t("mouthhard.sub")]));
  const btn = h("button", { class: "btn primary small" }, [t("mouthhard.button")]);
  box.append(btn);
  const out = h("div", {});
  box.append(out);
  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = t("mouthhard.searching");
    setTimeout(() => {
      const sugs = findWinningFilters(dataset.series, v.a, v.b, base, 6);
      btn.remove();
      if (!sugs.length) {
        out.append(h("p", { class: "sub" }, [t("mouthhard.exhausted")]));
        return;
      }
      for (const s of sugs) {
        const labels = s.changes.map(formatFilterChange).join(listJoiner()) || t("mouthhard.adjustFallback");
        const row = h("div", { class: "suggestion" }, [
          h("div", { class: "labels" }, [
            document.createTextNode(labels),
            h("div", { class: "meta" }, [
              tc("mouthhard.meta", s.count >= 5 ? "5+" : s.count, { shortest: s.shortest }),
            ]),
          ]),
          h("button", { class: "btn ghost small" }, [t("mouthhard.apply")]),
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
  toast(t("toast.copied"));
}

async function onShare() {
  const filters = readFilters();
  const url = location.origin + location.pathname + "?" + encodeState(selected.a, selected.b, filters);
  await copyText(url);
  updateUrl(filters);
  toast(t("toast.linkCopied"));
}

function onReset() {
  selected.a = selected.b = null;
  lastVerdict = null;
  lastFilters = null;
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
