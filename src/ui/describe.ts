// 把边/证据描述成文本，供论据卡与一键复制共用。
import type { Team } from "../../shared/types";
import type { Argument, Edge, Scope, SeriesEvidence } from "../engine/types";

export type Teams = Map<string, Team>;

export function name(teams: Teams, id: string): string {
  return teams.get(id)?.display_name ?? id;
}

export const RULE_NAME: Record<number, string> = {
  1: "直接交手",
  2: "共同对手",
  3: "历史战绩",
};

export const SCOPE_LABEL: Record<Scope, string> = {
  all: "全部赛事",
  international: "国际赛",
  worlds: "仅 Worlds",
};

/** 赛事页短名：去掉冗长前缀，尽量可读。 */
export function tournamentLabel(page: string): string {
  return page.replace(/\//g, " · ");
}

function bo(n: number): string {
  return n === 1 ? "Bo1" : `Bo${n}`;
}

function flagNote(ev: SeriesEvidence): string {
  const notes: string[] = [];
  if (ev.flags.includes("ff")) notes.push("含弃权");
  if (ev.flags.includes("nullified")) notes.push("含重赛/无效局");
  return notes.length ? `（${notes.join("、")}）` : "";
}

/** "T1 3-2 击败 Gen.G · 2024-09-08 · LCK … · Bo5" */
export function describeSeries(teams: Teams, ev: SeriesEvidence): string {
  const self = name(teams, ev.self);
  const opp = name(teams, ev.opp);
  const verb = ev.selfScore > ev.oppScore ? "击败" : "负于";
  const score = ev.selfScore > ev.oppScore ? `${ev.selfScore}-${ev.oppScore}` : `${ev.selfScore}-${ev.oppScore}`;
  const day = ev.date.slice(0, 10);
  return `${self} ${score} ${verb} ${opp} · ${day} · ${tournamentLabel(ev.tournament)} · ${bo(ev.best_of)}${flagNote(ev)}`;
}

/** 一条边的标题与明细（明细可多行）。 */
export function describeEdge(teams: Teams, e: Edge): { title: string; details: string[]; url: string } {
  const from = name(teams, e.from);
  const to = name(teams, e.to);
  if (e.evidence.kind === "rule1") {
    const ev = e.evidence.series;
    return {
      title: `${from} 直接击败 ${to}`,
      details: [describeSeries(teams, ev)],
      url: ev.url,
    };
  }
  if (e.evidence.kind === "rule2") {
    const via = name(teams, e.evidence.via);
    return {
      title: `经由共同对手 ${via}：${from} 强于 ${to}`,
      details: [
        e.evidence.note + (e.evidence.sameFormat ? "（同赛制）" : "（跨赛制档位）"),
        `${from}：${describeSeries(teams, e.evidence.aSeries)}`,
        `${to}：${describeSeries(teams, e.evidence.bSeries)}`,
      ],
      url: e.evidence.aSeries.url,
    };
  }
  // rule3
  const ev = e.evidence;
  const rate = (ev.rate * 100).toFixed(0);
  const caption = ev.tally === "game" ? "小局" : "大局";
  const scopeNote = ev.downgraded ? `（口径：${SCOPE_LABEL[ev.scopeUsed]}）` : "";
  return {
    title: `${from} 对 ${to} 历史战绩占优 ${scopeNote}`,
    details: [
      `${ev.wins}-${ev.total - ev.wins}（胜率 ${rate}%，按${caption}${ev.downgraded ? "，已收窄到 " + SCOPE_LABEL[ev.scopeUsed] : ""}）`,
      ...ev.series.slice(0, 6).map((s) => "· " + describeSeries(teams, s)),
    ],
    url: ev.series[0]?.url ?? "",
  };
}

/** 链路示意："A —直接交手→ C —历史战绩→ B" */
export function chainSummary(teams: Teams, arg: Argument): string {
  const parts: string[] = [name(teams, arg.path[0].from)];
  for (const e of arg.path) {
    parts.push(`—${RULE_NAME[e.rule]}→`);
    parts.push(name(teams, e.to));
  }
  return parts.join(" ");
}
