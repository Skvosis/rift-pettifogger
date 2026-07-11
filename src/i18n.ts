// 极简 i18n：默认中文，localStorage 记忆用户选择，右上角切换不刷新页面。
export type Locale = "zh" | "en";

const STORAGE_KEY = "rp-lang";

type Dict = Record<string, string>;

const zh: Dict = {
  "meta.title": "Rift Pettifogger · 赢学联盟 — LOL 战队论据生成器",
  "meta.description": "输入战队 A 和 B，在真实比赛数据中搜索「A 比 B 强」的论据链，一键生成带出处的论证文本。",
  "app.title": "赢学联盟",
  tagline:
    "你是一个云观众，你甚至记不清有哪些比赛……<br />但你真的很爱哥哥，今天却有人说滔博不如T1……<br />来吧，寻找哥哥更强的证据！",

  "picker.teamA": "战队 A",
  "picker.teamB": "战队 B",
  "picker.selectTeam": "选择战队…",
  "picker.filterPlaceholder": "筛选（可输入曾用名）…",
  "picker.noMatch": "无匹配战队",
  "picker.formerNames": "（曾用名 {names}）",
  "picker.inactive": "（已不活跃）",

  "filter.title": "全局过滤器",
  "filter.start": "起始时间",
  "filter.end": "截止时间",
  "filter.scope": "赛事范围",
  "filter.tally": "统计口径",
  "filter.proximity": "邻近窗口（天）",
  "filter.crossFormat": "跨赛制对比（Bo3 vs Bo5）",
  "filter.maxChainLen": "传递链长度上限",
  "filter.unlimited": "不限",

  "scope.all": "全部赛事",
  "scope.international": "国际赛",
  "scope.worlds": "仅 Worlds",
  "tally.series": "大局",
  "tally.game": "小局",
  "xf.off": "关闭",
  "xf.strict": "仅零封＞打满",
  "xf.loose": "全档位",

  "action.judge": "判案",
  "action.share": "复制链接",
  "action.shareTitle": "复制可复现链接",
  "action.reset": "重置",

  "status.loading": "加载数据中…",
  "status.loadFailed": "数据加载失败：{error}",
  "status.loaded": "已载入 {series} 场对阵、{teams} 支战队（{y0}–{y1}）。",

  "footer.disclaimer": "娱乐工具，论据 ≠ 真理：在同一份数据下，「A>B」与「B>A」可能同时成立。所有出处均可点击核验。",
  "footer.source": "数据来源 Oracle's Elixir（比赛数据）与 Leaguepedia（队标），每日自动更新。",

  "toast.selectBoth": "请先选择两支战队",
  "toast.sameTeam": "A、B 不能是同一支战队",
  "toast.copied": "论据已复制到剪贴板",
  "toast.linkCopied": "可复现链接已复制",

  "verdict.strongerThan": " 强于 ",
  "verdict.countPill": "{n} 条论据",
  "verdict.copyButton": "一键复制论据",
  "verdict.emptyHeadline": "暂时找不到「{a} > {b}」的论据链。",
  "verdict.reverseSummary": "对方可能这样反驳你：{b} 强于 {a}（{n} 条）",
  "verdict.moreButton": "展开其余 {n} 条论据",

  "rule.1": "直接交手",
  "rule.2": "共同对手",
  "rule.3": "历史战绩",
  "arg.chainKind": "传递链 · {n} 环",
  "arg.score": "含金量 {score}",
  "arg.scoreTooltip": "综合规则可信度、赛事级别、阶段、赛制与新旧的含金量评分",

  "stage.regular": "常规赛",
  "stage.groups": "小组赛",
  "stage.knockout": "淘汰赛",
  "stage.playoffs": "季后赛",
  "stage.final": "决赛",

  "league.WLDs": "世界赛",
  "league.FST": "先锋赛",
  "league.OGN": "LCK",

  "verb.beat": "击败",
  "verb.lostTo": "负于",
  "flag.ff": "含弃权",
  "flag.nullified": "含重赛/无效局",

  "link.source": "出处↗",
  "link.sourceTitle": "查看出处",
  "link.games": "逐局",
  "link.noGames": "暂无逐局数据",
  "link.rule3Summary": "历史战绩 {wins}-{losses}（按{tally}，胜率 {rate}%）",
  "link.rule3ScopeNote": "（口径已收窄：{scope}）",
  "link.moreMatches": "…共 {n} 场交手",

  "edge.rule1.title": "{from} 直接击败 {to}",
  "edge.rule2.title": "经由共同对手 {via}：{from} 强于 {to}",
  "edge.rule2.sameFormat": "（同赛制）",
  "edge.rule2.crossFormat": "（跨赛制档位）",
  "edge.rule2.line": "{team}：{detail}",
  "edge.rule3.title": "{from} 对 {to} 历史战绩占优{scopeNote}",
  "edge.rule3.scopeNote": "（口径：{scope}）",
  "edge.rule3.detail": "{wins}-{losses}（胜率 {rate}%，按{tally}{downgrade}）",
  "edge.rule3.downgrade": "，已收窄到 {scope}",

  "note.sameWinFewerLosses": "同样击败共同对手，丢局更少",
  "note.sameLossMoreWins": "同样负于共同对手，拿下更多局",
  "note.crossFormatTier": "跨赛制对比对手表现更强（档位 {higher} vs {lower}）",

  "hint.missingData": "数据中缺少其中一支战队的比赛记录，请确认选择或等待数据更新。",
  "hint.exhausted": "当前过滤器下找不到任何论据链——已是最宽松设置，这盘确实不好洗。",
  "hint.prefix": "找不到论据链。可尝试：",
  "hint.sep": "；",
  "hint.suffix": "。",
  "tip.clearStart": "清除“起始时间”以纳入更早的交手（默认只看最近三个月）",
  "tip.widenChainLen": "放宽“链长上限”",
  "tip.widenScope": "把“赛事范围”放宽到全部",
  "tip.widenCrossFormat": "把“跨赛制对比”放宽到全档位",
  "tip.widenProximity": "调大“邻近窗口”让共同对手更易匹配",
  "tip.switchTally": "切换到“小局”口径",

  "mouthhard.title": "嘴硬模式",
  "mouthhard.sub": "当前设置洗不动？让我自动找出能让你赢的过滤器组合。",
  "mouthhard.button": "帮我找赢面",
  "mouthhard.searching": "搜索中…",
  "mouthhard.exhausted": "穷尽所有过滤器组合仍找不到赢面——这盘是真的没法洗。",
  "mouthhard.apply": "套用并判案",
  "mouthhard.adjustFallback": "调整过滤器",
  "mouthhard.meta": "{n} 条论据 · 最短 {shortest} 跳",
  "mouthhard.change.scope": "赛事范围→{value}",
  "mouthhard.change.tally": "口径→{value}",
  "mouthhard.change.proximity": "邻近窗口→{days}天",
  "mouthhard.change.crossFormat": "跨赛制→{value}",
  "mouthhard.change.maxChainLen": "链长→{value}",
  "mouthhard.change.startSet": "起始→{date}",
  "mouthhard.change.startClear": "清除起始时间",

  "copy.header": "【赢学联盟判案】{a} > {b}",
  "copy.argHeader": "■ 论据 {i}（{kind}）",
  "copy.source": "  出处：{url}",
  "copy.notShown": "（另有 {n} 条论据未列出）",
  "copy.emptyMessage": "目前找不到支持「{a} > {b}」的论据链。",
  "copy.reverseHeader": "—— 对方可能这样反驳（{b} > {a}）——",
  "copy.shareUrl": "一键复现：{url}",
  "copy.disclaimer": "（本工具为娱乐性质，论据 ≠ 真理，正反结论可能同时成立。出处均可点击核验。）",

  "region.LPL": "LPL 中国",
  "region.LCK": "LCK 韩国",
  "region.LEC": "LEC 欧洲",
  "region.LCS_LTA": "LCS/LTA 美洲",
  "region.VCS": "VCS 越南",
  "region.PCS": "PCS 亚太",
  "region.CBLOL": "CBLOL 巴西",
  "region.LLA": "LLA 拉美",
  "region.LJL": "LJL 日本",
  "region.LCO": "LCO 大洋洲",
  "region.TCL": "TCL 土耳其",
  "region.LMS": "LMS 台湾",
  "region.GPL": "GPL 东南亚",
  "region.LCL": "LCL 独联体",
  "region.other": "其他",
};

const en: Dict = {
  "meta.title": "Rift Pettifogger · Winology League — LoL Team Argument Generator",
  "meta.description":
    "Pick Team A and B, and search real match data for evidence chains proving “A beats B” — generate sourced argument text with one click.",
  "app.title": "Winology League",
  tagline:
    "You're a cloud-watcher who can barely remember which games happened…<br />But you truly love your bias — and today someone said Top Esports is worse than T1…<br />Come on, let's find proof your bias is better!",

  "picker.teamA": "Team A",
  "picker.teamB": "Team B",
  "picker.selectTeam": "Select a team…",
  "picker.filterPlaceholder": "Filter (former names too)…",
  "picker.noMatch": "No matching teams",
  "picker.formerNames": " (formerly {names})",
  "picker.inactive": " (inactive)",

  "filter.title": "Global Filters",
  "filter.start": "Start date",
  "filter.end": "End date",
  "filter.scope": "Tournament Scope",
  "filter.tally": "Tally",
  "filter.proximity": "Proximity Window (days)",
  "filter.crossFormat": "Cross-Format Comparison (Bo3 vs Bo5)",
  "filter.maxChainLen": "Max Chain Length",
  "filter.unlimited": "Unlimited",

  "scope.all": "All Events",
  "scope.international": "International",
  "scope.worlds": "Worlds Only",
  "tally.series": "Series",
  "tally.game": "Games",
  "xf.off": "Off",
  "xf.strict": "Sweep > Full only",
  "xf.loose": "All tiers",

  "action.judge": "Judge",
  "action.share": "Copy Link",
  "action.shareTitle": "Copy a reproducible link",
  "action.reset": "Reset",

  "status.loading": "Loading data…",
  "status.loadFailed": "Failed to load data: {error}",
  "status.loaded": "{series} matches loaded across {teams} teams ({y0}–{y1}).",

  "footer.disclaimer":
    "For entertainment only — arguments ≠ truth. Under the same data, “A>B” and “B>A” may both hold. Every source is clickable and verifiable.",
  "footer.source": "Data from Oracle's Elixir (match data) and Leaguepedia (team logos), updated daily.",

  "toast.selectBoth": "Please select both teams first",
  "toast.sameTeam": "Team A and B must be different",
  "toast.copied": "Arguments copied to clipboard",
  "toast.linkCopied": "Reproducible link copied",

  "verdict.strongerThan": " is stronger than ",
  "verdict.countPill.one": "{n} argument",
  "verdict.countPill.other": "{n} arguments",
  "verdict.copyButton": "Copy Arguments",
  "verdict.emptyHeadline": "No argument chain found for “{a} > {b}” yet.",
  "verdict.reverseSummary.one": "Your opponent might counter: {b} > {a} ({n} argument)",
  "verdict.reverseSummary.other": "Your opponent might counter: {b} > {a} ({n} arguments)",
  "verdict.moreButton.one": "Show {n} more argument",
  "verdict.moreButton.other": "Show {n} more arguments",

  "rule.1": "Head-to-Head",
  "rule.2": "Common Opponent",
  "rule.3": "Track Record",
  "arg.chainKind": "Chain · {n} links",
  "arg.score": "Quality {score}",
  "arg.scoreTooltip":
    "Composite score of rule reliability, tournament tier, stage, match format, and recency",

  "stage.regular": "Regular Season",
  "stage.groups": "Groups",
  "stage.knockout": "Knockout",
  "stage.playoffs": "Playoffs",
  "stage.final": "Final",

  "league.WLDs": "Worlds",
  "league.FST": "First Stand",
  "league.OGN": "LCK",

  "verb.beat": "def.",
  "verb.lostTo": "lost to",
  "flag.ff": "forfeit",
  "flag.nullified": "rematch/void game",

  "link.source": "Source ↗",
  "link.sourceTitle": "View source",
  "link.games": "Games",
  "link.noGames": "No game-by-game data",
  "link.rule3Summary": "Track record {wins}-{losses} (by {tally}, {rate}% win rate)",
  "link.rule3ScopeNote": " (scope narrowed: {scope})",
  "link.moreMatches.one": "…{n} meeting total",
  "link.moreMatches.other": "…{n} meetings total",

  "edge.rule1.title": "{from} beat {to} head-to-head",
  "edge.rule2.title": "Via common opponent {via}: {from} > {to}",
  "edge.rule2.sameFormat": " (same format)",
  "edge.rule2.crossFormat": " (cross-format tier)",
  "edge.rule2.line": "{team}: {detail}",
  "edge.rule3.title": "{from} leads the head-to-head record vs {to}{scopeNote}",
  "edge.rule3.scopeNote": "(scope: {scope})",
  "edge.rule3.detail": "{wins}-{losses} ({rate}% win rate, by {tally}{downgrade})",
  "edge.rule3.downgrade": ", narrowed to {scope}",

  "note.sameWinFewerLosses": "Both beat the common opponent; fewer games dropped",
  "note.sameLossMoreWins": "Both lost to the common opponent; more games won",
  "note.crossFormatTier": "Stronger performance in cross-format comparison (tier {higher} vs {lower})",

  "hint.missingData":
    "One of the selected teams has no match data yet — check your selection or wait for the next data update.",
  "hint.exhausted":
    "No argument chain exists even under the loosest settings — this one's genuinely not winnable.",
  "hint.prefix": "No argument chain found. Try: ",
  "hint.sep": "; ",
  "hint.suffix": ".",
  "tip.clearStart": "Clear the start date to include older meetings (default is last 3 months only)",
  "tip.widenChainLen": "Raise the chain length limit",
  "tip.widenScope": "Widen tournament scope to All",
  "tip.widenCrossFormat": "Widen cross-format comparison to All tiers",
  "tip.widenProximity": "Increase the proximity window to match common opponents more easily",
  "tip.switchTally": "Switch to game-level tally",

  "mouthhard.title": "Stubborn Mode",
  "mouthhard.sub": "Current settings won't budge? Let me auto-find a filter combo that gets you the win.",
  "mouthhard.button": "Find Me a Win",
  "mouthhard.searching": "Searching…",
  "mouthhard.exhausted": "Exhausted every filter combo and still no win — this one's genuinely unwinnable.",
  "mouthhard.apply": "Apply & Judge",
  "mouthhard.adjustFallback": "Adjust filters",
  "mouthhard.meta.one": "{n} argument · {shortest}-hop shortest",
  "mouthhard.meta.other": "{n} arguments · {shortest}-hop shortest",
  "mouthhard.change.scope": "Scope → {value}",
  "mouthhard.change.tally": "Tally → {value}",
  "mouthhard.change.proximity": "Proximity → {days}d",
  "mouthhard.change.crossFormat": "Cross-format → {value}",
  "mouthhard.change.maxChainLen": "Chain length → {value}",
  "mouthhard.change.startSet": "Start → {date}",
  "mouthhard.change.startClear": "Clear start date",

  "copy.header": "[Winology League Verdict] {a} > {b}",
  "copy.argHeader": "■ Argument {i} ({kind})",
  "copy.source": "  Source: {url}",
  "copy.notShown.one": "({n} more argument not shown)",
  "copy.notShown.other": "({n} more arguments not shown)",
  "copy.emptyMessage": "No argument chain currently supports “{a} > {b}”.",
  "copy.reverseHeader": "—— Your opponent might counter ({b} > {a}) ——",
  "copy.shareUrl": "Reproduce with one click: {url}",
  "copy.disclaimer":
    "(This tool is for entertainment only. Arguments ≠ truth; both conclusions may hold simultaneously. All sources are verifiable.)",

  "region.LPL": "LPL China",
  "region.LCK": "LCK Korea",
  "region.LEC": "LEC Europe",
  "region.LCS_LTA": "LCS/LTA Americas",
  "region.VCS": "VCS Vietnam",
  "region.PCS": "PCS Asia-Pacific",
  "region.CBLOL": "CBLOL Brazil",
  "region.LLA": "LLA Latin America",
  "region.LJL": "LJL Japan",
  "region.LCO": "LCO Oceania",
  "region.TCL": "TCL Turkey",
  "region.LMS": "LMS Taiwan",
  "region.GPL": "GPL Southeast Asia",
  "region.LCL": "LCL CIS",
  "region.other": "Other",
};

const DICTS: Record<Locale, Dict> = { zh, en };

function loadLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    /* localStorage 不可用（隐私模式等）忽略，默认中文 */
  }
  return "zh";
}

let locale: Locale = loadLocale();
const listeners = new Set<(l: Locale) => void>();

export function getLocale(): Locale {
  return locale;
}

export function setLocale(l: Locale): void {
  if (l === locale) return;
  locale = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* 忽略 */
  }
  for (const cb of listeners) cb(l);
}

export function onLocaleChange(cb: (l: Locale) => void): void {
  listeners.add(cb);
}

function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  let out = s;
  for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

/** 取当前语言的翻译；当前语言缺失则回退中文，再回退 key 本身。 */
export function t(key: string, params?: Record<string, string | number>): string {
  const s = DICTS[locale][key] ?? DICTS.zh[key] ?? key;
  return interpolate(s, params);
}

/**
 * 带单复数的翻译：中文没有单复数区分，直接用 base 键；
 * 英文按 n===1 取 `base.one`，否则取 `base.other`。n 可以是 "5+" 这类字符串（视为复数）。
 */
export function tc(base: string, n: number | string, params?: Record<string, string | number>): string {
  const p = { n, ...params };
  if (locale === "en") {
    const key = n === 1 ? `${base}.one` : `${base}.other`;
    if (DICTS.en[key] !== undefined) return interpolate(DICTS.en[key], p);
  }
  return t(base, p);
}
