// 三次探查：确认 TeamRedirects._pageName 能给出“别名 -> 当前队页”的归并映射。
import { cargoQueryOnce } from "./cargo.ts";

async function show(label: string, tables: string, fields: string, where?: string, limit = 30) {
  console.log(`\n===== ${label} =====`);
  try {
    const rows = await cargoQueryOnce({ tables, fields, where, limit });
    if (!rows.length) return console.log("  (无数据)");
    console.log("  字段:", Object.keys(rows[0]).join(", "));
    rows.forEach((r) => console.log("  ", JSON.stringify(r)));
  } catch (e) {
    console.error("  错误:", String(e));
  }
}

// _pageName 必须带非下划线别名
await show(
  "TeamRedirects/_pageName",
  "TeamRedirects",
  "AllName, _pageName=Page",
  'AllName="Damwon Gaming" OR AllName="DWG KIA" OR AllName="DAMWON Gaming" OR AllName="SK Telecom T1" OR AllName="Gen.G esports" OR AllName="kt Rolster"',
);

await show(
  "Tournaments/Worlds-main",
  "Tournaments",
  "Name, OverviewPage, League, Region, TournamentLevel",
  'Region="International" AND Year="2024"',
);
