// 原始 Cargo 行 -> 数据模型。
import type { Series, SeriesFlag, Game } from "../shared/types";
import type { CargoRow } from "./cargo.ts";
import type { TournamentInfo } from "./tournaments.ts";
import type { Resolver } from "./aliases.ts";

/** "2024-02-17 08:30:00" -> "2024-02-17T08:30:00Z"；空/异常返回 null。 */
export function toIso(dt: string | undefined): string | null {
  if (!dt) return null;
  const m = dt.trim().match(/^(\d{4}-\d{2}-\d{2})[ T]?(\d{2}:\d{2}:\d{2})?/);
  if (!m) return null;
  return `${m[1]}T${m[2] ?? "00:00:00"}Z`;
}

export function rowToSeries(
  row: CargoRow,
  tinfo: TournamentInfo,
  resolve: Resolver,
): Series | null {
  const date = toIso(row["DateTime UTC"]);
  if (!date) return null;
  const t1 = resolve.resolve((row.Team1 ?? "").trim());
  const t2 = resolve.resolve((row.Team2 ?? "").trim());
  if (!t1 || !t2 || t1 === t2) return null;

  const s1 = Number(row.Team1Score);
  const s2 = Number(row.Team2Score);
  const flags: SeriesFlag[] = [];
  if ((row.FF ?? "").trim()) flags.push("ff");
  if (row.IsNullified === "1") flags.push("nullified");

  // 未开打/无效（0-0 且非弃权）跳过
  if (!Number.isFinite(s1) || !Number.isFinite(s2)) return null;
  if (s1 === 0 && s2 === 0 && !flags.includes("ff")) return null;

  const best_of = Number(row.BestOf) || Math.max(1, s1 + s2);
  const id = (row.MatchId ?? "").trim() || `${tinfo.overviewPage}__${row.Team1}_${row.Team2}_${date}`;

  return {
    id,
    date,
    tournament: tinfo.overviewPage,
    tier: tinfo.tier,
    best_of,
    t1,
    t2,
    s1,
    s2,
    flags,
  };
}

export function rowToGame(row: CargoRow, resolve: Resolver): Game | null {
  const seriesId = (row.MatchId ?? "").trim();
  if (!seriesId) return null;
  const blue = resolve.resolve((row.Blue ?? "").trim());
  const red = resolve.resolve((row.Red ?? "").trim());
  const w = row.Winner; // "1" = Blue, "2" = Red
  const winner = w === "1" ? blue : w === "2" ? red : "";
  if (!winner) return null;
  return {
    series_id: seriesId,
    game_n: Number(row["N GameInMatch"]) || 0,
    winner,
    blue,
    red,
  };
}
