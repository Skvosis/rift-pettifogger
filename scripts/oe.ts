// Oracle's Elixir 按年 CSV 的流式读取：只取 position=="team" 且联赛在白名单内的行。
// 列顺序随年份变化，一律按表头名定位。
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { Tier } from "../shared/types";

/** 联赛白名单：tier + 战队赛区标签。 */
export const LEAGUE_INFO: Record<string, { tier: Tier; region: string }> = {
  // 四大赛区（含历史命名）
  LPL: { tier: "domestic", region: "China" },
  LCK: { tier: "domestic", region: "Korea" },
  OGN: { tier: "domestic", region: "Korea" }, // 2015 Champions Korea 旧标签
  LEC: { tier: "domestic", region: "EMEA" },
  "EU LCS": { tier: "domestic", region: "EMEA" },
  LCS: { tier: "domestic", region: "North America" },
  "NA LCS": { tier: "domestic", region: "North America" },
  LTA: { tier: "domestic", region: "Americas" },
  "LTA N": { tier: "domestic", region: "North America" },
  "LTA S": { tier: "domestic", region: "Brazil" },
  // 三大国际赛
  WLDs: { tier: "worlds", region: "International" },
  MSI: { tier: "international", region: "International" },
  FST: { tier: "international", region: "International" },
  // 小赛区 / 历史主要联赛
  LMS: { tier: "domestic", region: "Taiwan" },
  GPL: { tier: "domestic", region: "Southeast Asia" },
  VCS: { tier: "domestic", region: "Vietnam" },
  PCS: { tier: "domestic", region: "Asia-Pacific" },
  LCP: { tier: "domestic", region: "Asia-Pacific" },
  CBLOL: { tier: "domestic", region: "Brazil" },
  LLA: { tier: "domestic", region: "Latin America" },
  LLN: { tier: "domestic", region: "Latin America" },
  CLS: { tier: "domestic", region: "Latin America" },
  LJL: { tier: "domestic", region: "Japan" },
  OPL: { tier: "domestic", region: "Oceania" },
  LCO: { tier: "domestic", region: "Oceania" },
  TCL: { tier: "domestic", region: "Turkey" },
  LCL: { tier: "domestic", region: "CIS" },
};

export interface OeGameRow {
  gameid: string;
  league: string;
  year: string;
  split: string;
  playoffs: boolean;
  /** "2024-01-17 08:20:00" */
  date: string;
  /** 系列赛内第几局。 */
  game: number;
  side: "Blue" | "Red";
  teamname: string;
  result: 0 | 1;
}

/** 解析一行 CSV（处理引号与转义引号；OE 数据无跨行字段）。 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** 流式读取一个 OE CSV，产出白名单联赛的 team 行。 */
export async function readTeamRows(file: string): Promise<OeGameRow[]> {
  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let idx: Record<string, number> | null = null;
  const rows: OeGameRow[] = [];
  const need = [
    "gameid",
    "league",
    "year",
    "split",
    "playoffs",
    "date",
    "game",
    "side",
    "position",
    "teamname",
    "result",
  ];
  for await (const line of rl) {
    if (!line) continue;
    if (!idx) {
      const header = parseCsvLine(line);
      idx = {};
      for (const name of need) {
        const i = header.indexOf(name);
        if (i < 0) throw new Error(`${file} 缺少列 ${name}`);
        idx[name] = i;
      }
      continue;
    }
    // 快速预筛：team 行才做完整解析（position 是低序号列，简单 split 足够粗筛）
    if (!line.includes("team")) continue;
    const f = parseCsvLine(line);
    if (f[idx.position] !== "team") continue;
    const league = f[idx.league];
    if (!LEAGUE_INFO[league]) continue;
    const side = f[idx.side];
    if (side !== "Blue" && side !== "Red") continue;
    const teamname = (f[idx.teamname] ?? "").trim();
    if (!teamname || teamname === "unknown team") continue;
    rows.push({
      gameid: f[idx.gameid],
      league,
      year: f[idx.year],
      split: f[idx.split] ?? "",
      playoffs: f[idx.playoffs] === "1",
      date: f[idx.date],
      game: Number(f[idx.game]) || 0,
      side,
      teamname,
      result: f[idx.result] === "1" ? 1 : 0,
    });
  }
  return rows;
}
