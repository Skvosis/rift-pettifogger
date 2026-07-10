# Rift Pettifogger · 赢学联盟

> LOL 战队论据生成器 —— 输入战队 A 和 B，在真实比赛数据中搜索「A 比 B 强」的论据链，一键生成带出处、可直接粘贴到贴吧 / NGA 的论证文本。

**本工具是辩护律师，不是法官。** 不做客观排名、不做评分；允许「A>B」与「B>A」在同一份数据下同时成立。

线上地址：`https://skvosis.github.io/rift-pettifogger/`

## 它怎么工作

纯静态网站，无后端、无数据库：

- **数据**：GitHub Actions 每日抓取 [Leaguepedia](https://lol.fandom.com) Cargo API，把 series（大局）/ teams / 逐局数据提交为 `public/data/*.json`。
- **规则引擎**：所有规则计算与图搜索都在浏览器端运行（边依赖过滤器状态，必须运行时生成）。
- **可复现**：全部过滤器状态编码进 URL，一条链接即可复现判案结果。

### 规则

| 规则 | 含义 |
|---|---|
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

### 抓取数据

```bash
npm run scrape                       # 增量更新当年
npm run scrape -- --from=2021 --to=2025   # 指定年份区间
npm run scrape -- --full             # 全量 2013 至今
npm run scrape -- --no-games         # 跳过逐局数据
```

> Leaguepedia 匿名接口限速较严，脚本内置指数退避 + 抖动。本地大批量抓取可能较慢；生产数据由 GitHub Actions（`.github/workflows/scrape.yml`）每日自动更新，或用 workflow_dispatch 手动全量重建。

### 别名归并

战队以品牌为单位、换血不换队。归并来源：

1. `TeamRedirects._pageName` —— Leaguepedia 页面移动型改名（如 DAMWON Gaming → Dplus Kia）。
2. `public/data/overrides.json` —— Leaguepedia 分成两页的改名 / 收购兜底（如 SK Telecom T1 → T1）。抓取后若发现明显该合并而未合并的实体，补进 `merge`。

## 目录

```
scripts/     数据管道（Cargo 客户端、赛事筛选、别名、转换、主入口）
shared/      前后端共用数据模型类型
src/engine/  规则引擎（纯函数）+ 图搜索 + 过滤器 + 嘴硬模式
src/ui/      论据描述、一键复制文本
src/         数据加载、主应用
tests/       规则引擎单元测试
public/data/ 抓取产物 JSON
```

## 免责声明

娱乐工具，论据 ≠ 真理。输出结果与对立结论可能同时成立，所有出处均可点击核验。
