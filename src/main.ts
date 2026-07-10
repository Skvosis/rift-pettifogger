import "./styles.css";
import { loadDataset, buildSearchIndex, searchTeams, type Dataset, type SearchEntry } from "./data";
import type { Team } from "../shared/types";
import type { Argument, Filters, Scope, Tally, Verdict } from "./engine/types";
import { defaultFilters, encodeState, decodeState, resolvedEnd } from "./engine/filters";
import { judge } from "./engine/graph";
import { findWinningFilters } from "./engine/mouthhard";
import { verdictToText } from "./ui/copy";
import { RULE_NAME, chainSummary, describeEdge, name as teamName } from "./ui/describe";
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
let searchIndex: SearchEntry[];
const selected: { a: string | null; b: string | null } = { a: null, b: null };
let lastVerdict: Verdict | null = null;

// ---------- 启动 ----------
init();

async function init() {
  try {
    dataset = await loadDataset();
  } catch (e) {
    $("#data-status").textContent = "数据加载失败：" + String(e);
    return;
  }
  searchIndex = buildSearchIndex(dataset.teams);
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

// ---------- 战队选择器 ----------
function setupCombo(side: "a" | "b") {
  const root = $<HTMLElement>(`.combo[data-side="${side}"]`);
  const input = $<HTMLInputElement>(".combo-input", root);
  const list = $<HTMLUListElement>(".combo-list", root);
  let activeIdx = -1;
  let current: Team[] = [];

  const close = () => {
    list.hidden = true;
    activeIdx = -1;
  };
  const render = () => {
    current = searchTeams(searchIndex, input.value, 8);
    list.replaceChildren(
      ...current.map((t, i) =>
        h("li", { class: i === activeIdx ? "active" : "", onclick: () => pick(t) } as any, [
          h("span", {}, [t.display_name]),
          h("span", { class: "region" }, [t.region || ""]),
        ]),
      ),
    );
    list.hidden = current.length === 0;
  };
  const pick = (t: Team) => {
    selected[side] = t.canonical_id;
    input.value = t.display_name;
    root.classList.add("selected");
    close();
  };

  input.addEventListener("input", () => {
    selected[side] = null;
    root.classList.remove("selected");
    activeIdx = -1;
    render();
  });
  input.addEventListener("focus", () => {
    if (input.value && !selected[side]) render();
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, current.length - 1);
      render();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (current[activeIdx]) pick(current[activeIdx]);
      else if (current[0]) pick(current[0]);
    } else if (e.key === "Escape") {
      close();
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
  f.strict = $<HTMLInputElement>("#f-strict").checked;
  return f;
}

function writeFilters(f: Filters) {
  $<HTMLInputElement>("#f-start").value = f.start ?? "";
  $<HTMLInputElement>("#f-end").value = f.end ?? "";
  setSeg("scope", f.scope);
  setSeg("tally", f.tally);
  $<HTMLInputElement>("#f-prox").value = String(f.proximityDays);
  $<HTMLInputElement>("#f-strict").checked = f.strict;
  if (f.start || f.end || f.scope !== "all" || f.tally !== "series" || f.proximityDays !== 90 || f.strict) {
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
  const kind = arg.path.length === 1 ? RULE_NAME[arg.path[0].rule] : "传递链";
  const headText =
    arg.path.length > 1
      ? chainSummary(dataset.teamById, arg)
      : describeEdge(dataset.teamById, arg.path[0]).title;
  card.append(
    h("div", { class: "arg-chain" }, [h("span", { class: "arg-kind" }, [kind]), document.createTextNode(headText)]),
  );
  for (const e of arg.path) {
    const d = describeEdge(dataset.teamById, e);
    const hop = h("div", { class: "hop" }, [h("div", { class: "hop-title" }, [d.title])]);
    for (const detail of d.details) hop.append(h("div", { class: "hop-detail" }, [detail]));
    if (d.url) hop.append(h("a", { href: d.url, target: "_blank", rel: "noreferrer" } as any, ["查看原始出处 ↗"]));
    if (e.evidence.kind === "rule1") appendGameExpand(hop, e.evidence.series.id, e.evidence.series.date);
    card.append(hop);
  }
  return card;
}

/** 规则 1 证据卡上的“逐局”按需展开。 */
function appendGameExpand(hop: HTMLElement, seriesId: string, date: string) {
  const btn = h("a", { href: "javascript:void 0", class: "games-toggle" } as any, [" · 逐局"]);
  btn.addEventListener("click", async () => {
    btn.remove();
    const games = await gamesOfSeries(seriesId, date);
    const text = games.length
      ? games
          .map((g) => `G${g.game_n} ${teamName(dataset.teamById, g.winner)} 胜`)
          .join(" / ")
      : "暂无逐局数据";
    hop.append(h("div", { class: "hop-detail" }, [`逐局：${text}`]));
  });
  hop.append(btn);
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
            h("div", { class: "meta" }, [`${s.count} 条论据 · 最短 ${s.shortest} 跳`]),
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
  document.querySelectorAll<HTMLInputElement>(".combo-input").forEach((i) => (i.value = ""));
  document.querySelectorAll(".combo").forEach((c) => c.classList.remove("selected"));
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
  const { a, b, filters } = decodeState(location.search);
  writeFilters(filters);
  if (a && dataset.teamById.has(a)) {
    selected.a = a;
    const input = $<HTMLInputElement>('.combo[data-side="a"] .combo-input');
    input.value = teamName(dataset.teamById, a);
    $<HTMLElement>('.combo[data-side="a"]').classList.add("selected");
  }
  if (b && dataset.teamById.has(b)) {
    selected.b = b;
    const input = $<HTMLInputElement>('.combo[data-side="b"] .combo-input');
    input.value = teamName(dataset.teamById, b);
    $<HTMLElement>('.combo[data-side="b"]').classList.add("selected");
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
