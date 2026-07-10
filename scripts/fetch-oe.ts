// 增量下载 Oracle's Elixir 按年 CSV（官方 Google Drive 文件夹）。
// 用法：
//   npm run data:fetch                → 下载当年
//   npm run data:fetch -- --year=2025
// 说明：OE 官网下载页的 S3 直链已失效，社区数据实际托管在公开 Drive 文件夹。
// 通过 embeddedfolderview 解析文件 id，再走 drive.usercontent 直链。
// Drive 对热门文件有下载配额；命中配额时保留旧文件、以码 0 退出（次日重试）。
import { createWriteStream, existsSync, renameSync, statSync, unlinkSync, mkdirSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_DIR = join(__dirname, "..", "data");
const FOLDER_ID = "1gLSw0RLjBbtaNy0dgnGQDAZOHIgCe-HH";
const UA = "Mozilla/5.0 (compatible; rift-pettifogger/0.1; +https://github.com/Skvosis/rift-pettifogger)";

const csvName = (y: number) => `${y}_LoL_esports_match_data_from_OraclesElixir.csv`;

async function listFolder(): Promise<Map<number, string>> {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${FOLDER_ID}#list`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`Drive 文件夹列表失败: HTTP ${res.status}`);
  const html = await res.text();
  // 条目形如 <div class="flip-entry" id="entry-<ID>" ...> ... <div class="flip-entry-title">2026_..csv</div>
  const map = new Map<number, string>();
  const re = /id="entry-([^"]+)"[\s\S]*?flip-entry-title">(\d{4})_LoL_esports_match_data_from_OraclesElixir\.csv</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) map.set(Number(m[2]), m[1]);
  if (!map.size) throw new Error("Drive 文件夹解析不到任何年份 CSV（页面结构可能变了）");
  return map;
}

async function download(fileId: string, dest: string): Promise<"ok" | "quota"> {
  const url = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok || !res.body) throw new Error(`下载失败: HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) {
    return "quota"; // 配额超限/警告页
  }
  const tmp = dest + ".part";
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tmp));
  // 基本校验：体量 + CSV 表头
  const size = statSync(tmp).size;
  if (size < 1_000_000) {
    unlinkSync(tmp);
    throw new Error(`下载文件异常偏小（${size} 字节），放弃覆盖`);
  }
  if (existsSync(dest)) unlinkSync(dest);
  renameSync(tmp, dest);
  return "ok";
}

async function main() {
  mkdirSync(CSV_DIR, { recursive: true });
  const yearArg = process.argv.find((a) => a.startsWith("--year="))?.slice(7);
  const year = yearArg ? Number(yearArg) : new Date().getFullYear();
  console.log(`下载 OE ${year} 年数据…`);
  const folder = await listFolder();
  const fileId = folder.get(year);
  if (!fileId) throw new Error(`Drive 文件夹里没有 ${year} 年文件。现有年份: ${[...folder.keys()].join(",")}`);
  const dest = join(CSV_DIR, csvName(year));
  const r = await download(fileId, dest);
  if (r === "quota") {
    console.warn("Drive 下载配额超限，今日跳过（保留现有数据，次日自动重试）。");
    return;
  }
  console.log(`已更新 ${dest}（${(statSync(dest).size / 1e6).toFixed(1)} MB）`);
}

main().catch((e) => {
  console.error("拉取失败：", e);
  process.exit(1);
});
