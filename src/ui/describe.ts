// 把边/证据描述成文本，供论据卡与一键复制共用。全部经 i18n 的 t()/tc()，随语言切换自动生效。
import type { Team } from "../../shared/types";
import type { Argument, Edge, FilterChange, Hint, RuleId, Rule2Note, Scope, SeriesEvidence } from "../engine/types";
import { CHAIN_LEN_UNLIMITED } from "../engine/filters";
import { t } from "../i18n";

export type Teams = Map<string, Team>;

export function name(teams: Teams, id: string): string {
  return teams.get(id)?.display_name ?? id;
}

export function ruleName(rule: RuleId): string {
  return t(`rule.${rule}`);
}

export function scopeLabel(scope: Scope): string {
  return t(`scope.${scope}`);
}

/** 赛事页短名：去掉冗长前缀，尽量可读。 */
export function tournamentLabel(page: string): string {
  return page.replace(/\//g, " · ");
}

/** 联赛代码 -> 展示标签。多数赛区代码（LPL/LCK/LEC…）在中英文下相同，未登记的直接原样返回。 */
export function leagueLabel(league: string | undefined): string {
  if (!league) return "";
  const key = `league.${league}`;
  const translated = t(key);
  return translated === key ? league : translated;
}

/** 阶段 -> 展示标签。 */
export function stageLabel(stage: string | undefined): string {
  if (!stage) return "";
  const key = `stage.${stage}`;
  const translated = t(key);
  return translated === key ? "" : translated;
}

function bo(n: number): string {
  return `Bo${n}`;
}

function flagNote(ev: SeriesEvidence): string {
  const notes: string[] = [];
  if (ev.flags.includes("ff")) notes.push(t("flag.ff"));
  if (ev.flags.includes("nullified")) notes.push(t("flag.nullified"));
  return notes.length ? `（${notes.join("、")}）` : "";
}

/** "T1 3-2 击败 Gen.G · 2024-09-08 · LCK 2024 Summer Playoffs · 决赛 · Bo5" */
export function describeSeries(teams: Teams, ev: SeriesEvidence): string {
  const self = name(teams, ev.self);
  const opp = name(teams, ev.opp);
  const verb = ev.selfScore > ev.oppScore ? t("verb.beat") : t("verb.lostTo");
  const day = ev.date.slice(0, 10);
  // 决赛始终标注；国际赛标注小组赛/淘汰赛（标签本身不含阶段）
  const stage =
    ev.stage === "final" ? ` · ${t("stage.final")}` : ev.tier !== "domestic" && ev.stage ? ` · ${stageLabel(ev.stage)}` : "";
  return `${self} ${ev.selfScore}-${ev.oppScore} ${verb} ${opp} · ${day} · ${tournamentLabel(ev.tournament)}${stage} · ${bo(ev.best_of)}${flagNote(ev)}`;
}

/** 规则 2 比较结论格式化。 */
export function formatRule2Note(note: Rule2Note): string {
  if (note.kind === "sameWinFewerLosses") return t("note.sameWinFewerLosses");
  if (note.kind === "sameLossMoreWins") return t("note.sameLossMoreWins");
  return t("note.crossFormatTier", { higher: note.higher, lower: note.lower });
}

/** 无路径放宽建议格式化。 */
export function formatHint(hint: Hint): string {
  if (hint.kind === "missingData") return t("hint.missingData");
  if (hint.kind === "exhausted") return t("hint.exhausted");
  return t("hint.prefix") + hint.tips.map((k) => t(`tip.${k}`)).join(t("hint.sep")) + t("hint.suffix");
}

/** 一条边的标题与明细（明细可多行）。 */
export function describeEdge(teams: Teams, e: Edge): { title: string; details: string[]; url: string } {
  const from = name(teams, e.from);
  const to = name(teams, e.to);
  if (e.evidence.kind === "rule1") {
    const ev = e.evidence.series;
    return {
      title: t("edge.rule1.title", { from, to }),
      details: [describeSeries(teams, ev)],
      url: ev.url,
    };
  }
  if (e.evidence.kind === "rule2") {
    const via = name(teams, e.evidence.via);
    return {
      title: t("edge.rule2.title", { via, from, to }),
      details: [
        formatRule2Note(e.evidence.note) + t(e.evidence.sameFormat ? "edge.rule2.sameFormat" : "edge.rule2.crossFormat"),
        t("edge.rule2.line", { team: from, detail: describeSeries(teams, e.evidence.aSeries) }),
        t("edge.rule2.line", { team: to, detail: describeSeries(teams, e.evidence.bSeries) }),
      ],
      url: e.evidence.aSeries.url,
    };
  }
  // rule3
  const ev = e.evidence;
  const rate = (ev.rate * 100).toFixed(0);
  const tally = t(`tally.${ev.tally}`);
  const scopeNoteRaw = ev.downgraded ? t("edge.rule3.scopeNote", { scope: scopeLabel(ev.scopeUsed) }) : "";
  const scopeNote = scopeNoteRaw ? " " + scopeNoteRaw : "";
  const downgrade = ev.downgraded ? t("edge.rule3.downgrade", { scope: scopeLabel(ev.scopeUsed) }) : "";
  return {
    title: t("edge.rule3.title", { from, to, scopeNote }),
    details: [
      t("edge.rule3.detail", { wins: ev.wins, losses: ev.total - ev.wins, rate, tally, downgrade }),
      ...ev.series.slice(0, 6).map((s) => "· " + describeSeries(teams, s)),
    ],
    url: ev.series[0]?.url ?? "",
  };
}

/** 链路示意："A —直接交手→ C —历史战绩→ B" */
export function chainSummary(teams: Teams, arg: Argument): string {
  const parts: string[] = [name(teams, arg.path[0].from)];
  for (const e of arg.path) {
    parts.push(`—${ruleName(e.rule)}→`);
    parts.push(name(teams, e.to));
  }
  return parts.join(" ");
}

/** 论据卡/复制文本的"类型"标签：单跳显示规则名，多跳显示"传递链 · N 环"。 */
export function argKind(path: Edge[]): string {
  return path.length === 1 ? ruleName(path[0].rule) : t("arg.chainKind", { n: path.length });
}

/** 嘴硬模式：单个过滤器改动项格式化。 */
export function formatFilterChange(c: FilterChange): string {
  switch (c.kind) {
    case "scope":
      return t("mouthhard.change.scope", { value: scopeLabel(c.value) });
    case "tally":
      return t("mouthhard.change.tally", { value: t(`tally.${c.value}`) });
    case "proximity":
      return t("mouthhard.change.proximity", { days: c.days });
    case "crossFormat":
      return t("mouthhard.change.crossFormat", { value: t(`xf.${c.value}`) });
    case "maxChainLen":
      return t("mouthhard.change.maxChainLen", {
        value: c.value >= CHAIN_LEN_UNLIMITED ? t("filter.unlimited") : c.value,
      });
    case "start":
      return c.value ? t("mouthhard.change.startSet", { date: c.value }) : t("mouthhard.change.startClear");
  }
}
