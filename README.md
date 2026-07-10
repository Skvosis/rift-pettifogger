# Rift Pettifogger · 赢学联盟

> LOL 战队论据生成器 —— 输入战队 A 和 B，在真实比赛数据中搜索「A 比 B 强」的论据链，一键生成带出处、可直接粘贴到贴吧 / NGA 的论证文本。

**本工具是辩护律师，不是法官。** 不做客观排名、不做评分；允许「A>B」与「B>A」在同一份数据下同时成立。

线上地址：`https://skvosis.github.io/rift-pettifogger/`

## 它怎么工作

纯静态网站，无后端、无数据库：

- **数据**：主数据源为 [Oracle's Elixir](https://oracleselixir.com/tools/downloads) 按年 CSV（覆盖 2014 至今、所有主要联赛，每日更新）。GitHub Actions 每日只增量拉取**当年** CSV，重建当年 JSON 并提交 `public/data/*.json`；历史年份 JSON 已入库，无需重复下载。队标来自 Leaguepedia 图片 API（浏览器端按需解析）。
- **规则引擎**：所有规则计算与图搜索都在浏览器端运行（边依赖过滤器状态，必须运行时生成）。
- **可复现**：全部过滤器状态编码进 URL，一条链接即可复现判案结果。

### 规则

| 规则 | 含义 |
| --- | --- |
| 1 直接交手 | 时间窗内最近一次 series 的胜者得一条边（Bo1 计入） |
| 2 共同对手 | 经由共同对手 C 比较：同赛制比比分，跨赛制比表现档位（可开严格模式） |
| 3 历史战绩 | A vs B 胜率严格 > 2/3 得边；范围可自动从宽到窄降级并强制标注口径 |
| 4 传递链 | 在规则 1–3 的有向图上做 BFS，枚举 A→B 路径，按（长度、链强度）排序 |
| 反方视角 | 每次判案同时反向搜索 B>A，折叠展示「对方可能这样反驳你」 |
| 嘴硬模式 | 自动搜索能让 A>B 成立的过滤器组合并推荐一键套用 |

## 开发

```bash
npm install
npm run dev        # 本地开发服务器
npm test           # 规则引擎单元测试（vitest）
npm run build      # 类型检查 + 生产构建
npm run preview    # 预览生产构建
```

### 更新数据

```bash
npm run data:fetch                   # 下载当年 OE CSV 到 data/（增量）
npm run data:fetch -- --year=2025    # 指定年份
npm run data:build                   # data/*.csv 全量重建 public/data JSON
npm run data:build -- --years=2026   # 只重建指定年份（teams/index 自动全局合并）
```

> 每日增量由 GitHub Actions（`.github/workflows/scrape.yml`）自动执行：拉当年 CSV → 重建当年 JSON → 有变化则提交（随后自动触发 Pages 部署）。OE 的 Drive 托管偶发下载配额超限，脚本会跳过当天、次日重试。历史年份 JSON 已入库，无需重复抓取；如需全量重建，把各年 CSV 放入 `data/` 后跑 `npm run data:build`。
>
> `npm run scrape:cargo` 保留了 Leaguepedia Cargo API 的备用抓取管道（限速较严，不作为默认路径）。

### 实体归并（换血不换队）

1. OE 对“页面移动型”改名已自动统一（DAMWON Gaming → Dplus Kia、DRX → Kiwoom DRX、Misfits → Team Heretics）。
2. `public/data/overrides.json` 处理其余分页型改名 / 收购（如 SK Telecom T1 → T1、Samsung Galaxy → Gen.G、Suning → Weibo Gaming）。发现该合并而未合并的实体，在 `merge` 补一行并重跑 `data:build` 即可；`teams[].aliases` 控制选择器里展示的曾用名。

### 已知数据边界

- OE 对 LPL 的覆盖从 2016 年中开始，2014–2015 年 LPL 缺失；2014 年韩国赛区缺失（2015 年在 OGN 标签下）。
- 弃权 / 重赛在 OE 中不单独标注，按官方计分结果计入。

## 目录

```text
scripts/     数据管道（OE CSV 解析、series 重建、增量下载；cargo* 为 Leaguepedia 备用）
shared/      前后端共用数据模型类型
src/engine/  规则引擎（纯函数）+ 图搜索 + 过滤器 + 嘴硬模式
src/ui/      论据描述、一键复制文本
src/         数据加载、主应用、两级选择器、队标解析
tests/       规则引擎单元测试
public/data/ 构建产物 JSON（series/games 按年分片 + teams + index + overrides）
```

## 免责声明

娱乐工具，论据 ≠ 真理。输出结果与对立结论可能同时成立，所有出处均可点击核验。
