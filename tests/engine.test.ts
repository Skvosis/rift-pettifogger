import { describe, it, expect } from "vitest";
import type { Series, Tier } from "../shared/types";
import type { Filters } from "../src/engine/types";
import { defaultFilters } from "../src/engine/filters";
import { rule1, rule2, rule2All, rule3, performanceTier } from "../src/engine/rules";
import { judge, buildEdges, findArguments } from "../src/engine/graph";

let idc = 0;
function s(
  t1: string,
  t2: string,
  s1: number,
  s2: number,
  opts: Partial<Series> = {},
): Series {
  return {
    id: opts.id ?? `s${idc++}`,
    date: opts.date ?? "2024-06-01",
    tournament: opts.tournament ?? "Test/2024",
    tier: (opts.tier ?? "domestic") as Tier,
    best_of: opts.best_of ?? 3,
    t1,
    t2,
    s1,
    s2,
    flags: opts.flags ?? [],
  };
}
// 测试基线：固定时间窗（测试数据为 2024 年）、跨赛制全档位、链长不限；单测各自覆盖收紧场景
const F = (o: Partial<Filters> = {}): Filters => ({
  ...defaultFilters(),
  start: null,
  crossFormat: "loose",
  maxChainLen: 7,
  ...o,
});

describe("performanceTier 跨赛制档位表", () => {
  it("胜方档位", () => {
    expect(performanceTier(2, 0)).toBe(2); // 横扫
    expect(performanceTier(3, 0)).toBe(2);
    expect(performanceTier(3, 1)).toBe(1); // 有丢局未打满
    expect(performanceTier(2, 1)).toBe(0); // 决胜局险胜
    expect(performanceTier(3, 2)).toBe(0);
  });
  it("负方档位", () => {
    expect(performanceTier(0, 2)).toBe(0); // 被横扫
    expect(performanceTier(0, 3)).toBe(0);
    expect(performanceTier(1, 3)).toBe(1); // 拿局未进决胜
    expect(performanceTier(1, 2)).toBe(2); // 打满决胜
    expect(performanceTier(2, 3)).toBe(2);
  });
});

describe("规则 1 直接交手", () => {
  it("取最近一次交手的胜者", () => {
    const data = [
      s("A", "B", 2, 0, { date: "2024-01-01" }), // A 早期赢
      s("B", "A", 2, 1, { date: "2024-05-01" }), // B 最近赢 -> 边 B>A
    ];
    const e = rule1(data, "A", "B", F());
    expect(e?.from).toBe("B");
    expect(e?.to).toBe("A");
  });
  it("Bo1 计入", () => {
    const e = rule1([s("A", "B", 1, 0, { best_of: 1 })], "A", "B", F());
    expect(e?.from).toBe("A");
  });
  it("平局不产边", () => {
    const e = rule1([s("A", "B", 1, 1, { best_of: 2 })], "A", "B", F());
    expect(e).toBeNull();
  });
});

describe("规则 3 历史战绩", () => {
  it("胜率严格大于 2/3 才产边", () => {
    // 2 胜 1 负 = 66.7%，不严格大于 2/3
    const data = [
      s("A", "B", 2, 0),
      s("A", "B", 2, 1),
      s("B", "A", 2, 0),
    ];
    expect(rule3(data, "A", "B", F())).toBeNull();
    // 3 胜 1 负 = 75% > 2/3
    const data2 = [...data, s("A", "B", 2, 0)];
    expect(rule3(data2, "A", "B", F())?.from).toBe("A");
  });
  it("1 战 1 胜 = 100% 成立", () => {
    expect(rule3([s("A", "B", 2, 0)], "A", "B", F())?.from).toBe("A");
  });
  it("Bo2 平局大局剔除、小局计入", () => {
    // A vs B：一场 1-1，一场 A 2-0
    const data = [s("A", "B", 1, 1, { best_of: 2 }), s("A", "B", 2, 0)];
    // 大局：剔除平局 -> 1 战 1 胜 = 100% 产边
    expect(rule3(data, "A", "B", F({ tally: "series" }))?.from).toBe("A");
    // 小局：A 3 胜(1+2) / 总 4 = 75% > 2/3 产边
    const g = rule3(data, "A", "B", F({ tally: "game" }));
    expect(g?.from).toBe("A");
    if (g?.evidence.kind === "rule3") expect(g.evidence.total).toBe(4);
  });
  it("范围自动降级：全部不产边则收窄到仅 Worlds", () => {
    const data = [
      s("A", "B", 2, 0, { tier: "worlds" }), // 仅 Worlds: A 1-0
      s("B", "A", 2, 0, { tier: "international" }), // 国际赛(非worlds) B 赢
      s("B", "A", 2, 1, { tier: "international" }),
    ];
    // 全部/国际赛口径：A 1 胜 2 负，不产边；降级到 worlds：A 1-0 = 100%
    const e = rule3(data, "A", "B", F({ scope: "all" }));
    expect(e?.from).toBe("A");
    if (e?.evidence.kind === "rule3") {
      expect(e.evidence.scopeUsed).toBe("worlds");
      expect(e.evidence.downgraded).toBe(true);
    }
  });
});

describe("规则 2 共同对手", () => {
  it("同胜：丢局少者强", () => {
    // A 2-0 胜 C，B 2-1 胜 C -> A>B
    const data = [s("A", "C", 2, 0), s("B", "C", 2, 1)];
    const es = rule2(data, "A", "B", F());
    expect(es.length).toBe(1);
    expect(es[0].from).toBe("A");
  });
  it("同负：拿局多者强", () => {
    // A 1-2 负 C，B 0-2 负 C -> A>B（拿了局）
    const data = [s("A", "C", 1, 2), s("B", "C", 0, 2)];
    const es = rule2(data, "A", "B", F());
    expect(es[0]?.from).toBe("A");
  });
  it("比分完全相同不产边", () => {
    const data = [s("A", "C", 2, 0), s("B", "C", 2, 0)];
    expect(rule2(data, "A", "B", F()).length).toBe(0);
  });
  it("Bo1 排除", () => {
    const data = [s("A", "C", 1, 0, { best_of: 1 }), s("B", "C", 1, 0, { best_of: 1 })];
    expect(rule2(data, "A", "B", F()).length).toBe(0);
  });
  it("跨赛制三档：off 不产边；strict 要求档位差=2（零封 vs 打满）；loose 档位不同即可", () => {
    // A 被横扫 0-3 (Bo5, 档0)，B 打满 1-2 (Bo3, 档2) 同负于 C -> B>A，档差2
    const data = [
      s("A", "C", 0, 3, { best_of: 5 }),
      s("B", "C", 1, 2, { best_of: 3 }),
    ];
    expect(rule2(data, "A", "B", F({ crossFormat: "loose" }))[0]?.from).toBe("B");
    expect(rule2(data, "A", "B", F({ crossFormat: "strict" }))[0]?.from).toBe("B");
    expect(rule2(data, "A", "B", F({ crossFormat: "off" })).length).toBe(0);
    // 档差=1：loose 产边，strict 不产边 —— Bo3 1-2(档2) vs Bo5 1-3(档1)
    const data2 = [
      s("A", "C", 1, 2, { best_of: 3 }), // 档2
      s("B", "C", 1, 3, { best_of: 5 }), // 档1
    ];
    expect(rule2(data2, "A", "B", F({ crossFormat: "loose" })).length).toBe(1);
    expect(rule2(data2, "A", "B", F({ crossFormat: "strict" })).length).toBe(0);
  });
  it("跨赛制 off 不影响同赛制比较", () => {
    const data = [s("A", "C", 2, 0), s("B", "C", 2, 1)];
    expect(rule2(data, "A", "B", F({ crossFormat: "off" }))[0]?.from).toBe("A");
  });
  it("邻近窗口外不产边（跨赛事）", () => {
    const data = [
      s("A", "C", 2, 0, { tournament: "T1", date: "2024-01-01" }),
      s("B", "C", 2, 1, { tournament: "T2", date: "2024-09-01" }),
    ];
    expect(rule2(data, "A", "B", F({ proximityDays: 90 })).length).toBe(0);
    expect(rule2(data, "A", "B", F({ proximityDays: 365 }))[0]?.from).toBe("A");
  });
  it("rule2All 与逐对 rule2 一致", () => {
    const data = [s("A", "C", 2, 0), s("B", "C", 2, 1)];
    const all = rule2All(data, F());
    expect(all.length).toBe(1);
    expect(all[0].from).toBe("A");
  });
});

describe("图搜索与判案", () => {
  it("传递链 A>C>B", () => {
    // A 最近击败 C（规则1），C vs B 历史 100%（规则3）-> 链 A->C->B
    const data = [
      s("A", "C", 2, 0, { date: "2024-05-01" }),
      s("C", "B", 2, 0, { date: "2024-03-01" }),
    ];
    const v = judge(data, "A", "B", F());
    const chain = v.forward.find((a) => a.path.length === 2);
    expect(chain).toBeTruthy();
    expect(chain?.path[0].from).toBe("A");
    expect(chain?.path[1].to).toBe("B");
  });
  it("正反可同时成立", () => {
    // A 2-0 C, B 2-1 C -> A>B(规则2)；同时 B 2-0 D, A 2-1 D -> B>A(规则2)
    const data = [
      s("A", "C", 2, 0),
      s("B", "C", 2, 1),
      s("B", "D", 2, 0),
      s("A", "D", 2, 1),
    ];
    const v = judge(data, "A", "B", F());
    expect(v.forward.length).toBeGreaterThan(0);
    expect(v.reverse.length).toBeGreaterThan(0);
  });
  it("链长上限生效", () => {
    const data = [
      s("A", "C", 2, 0, { date: "2024-05-01" }),
      s("C", "B", 2, 0, { date: "2024-03-01" }),
    ];
    expect(judge(data, "A", "B", F({ maxChainLen: 2 })).forward.some((x) => x.path.length === 2)).toBe(true);
    expect(judge(data, "A", "B", F({ maxChainLen: 1 })).forward.length).toBe(0);
  });
  it("规则 2 计为 2 层：链长上限 1 排除，2 纳入；折扣按有效层数", () => {
    // A 2-0 胜 C，B 2-1 胜 C -> 规则 2 直接边 A>B（有效层数 2）
    const data = [s("A", "C", 2, 0), s("B", "C", 2, 1)];
    expect(judge(data, "A", "B", F({ maxChainLen: 1 })).forward.length).toBe(0);
    const v2 = judge(data, "A", "B", F({ maxChainLen: 2 }));
    expect(v2.forward.length).toBe(1);
    // 得分含一次链衰减：等于边强度 × chainDecay
    const e = v2.forward[0].path[0];
    expect(v2.forward[0].chainStrength).toBeCloseTo(e.strength * 0.7, 10);
  });
  it("规则1+规则2 两环链有效层数为 3", () => {
    // A -规则1-> X（X 直接输给 A），X 与 B 经共同对手 C 比较 -> X>B
    const data = [
      s("A", "X", 2, 0, { date: "2024-06-01" }),
      s("X", "C", 2, 0, { date: "2024-05-01" }),
      s("B", "C", 2, 1, { date: "2024-05-02" }),
    ];
    const hit = (len: number) =>
      judge(data, "A", "B", F({ maxChainLen: len })).forward.some((x) => x.path.length === 2);
    expect(hit(2)).toBe(false); // 有效层 3 > 上限 2
    expect(hit(3)).toBe(true);
  });
  it("无路径给出提示", () => {
    const data = [s("X", "Y", 2, 0)];
    const v = judge(data, "X", "Y", F());
    // X 直接赢 Y，forward 有；反向 Y>X 无
    expect(v.reverse.length).toBe(0);
    const v2 = judge(data, "Y", "X", F());
    expect(v2.forward.length).toBe(0);
    expect(v2.hint).toBeTruthy();
  });
  it("单边强度：规则 1 > 规则 2 > 规则 3（同长度论证排序）", () => {
    // A 直接击败 B（规则1，较早）；A、B 与 C 的共同对手比较（规则2，较晚）
    const data = [
      s("A", "B", 2, 1, { date: "2024-01-10" }),
      s("A", "C", 2, 0, { date: "2024-06-01" }),
      s("B", "C", 2, 1, { date: "2024-06-02" }),
    ];
    const edges = buildEdges(data, F());
    const args = findArguments("A", "B", edges);
    const direct = args.filter((a) => a.path.length === 1);
    expect(direct.length).toBeGreaterThanOrEqual(2);
    // 尽管规则 2 的边时间更近，规则 1 仍应排在最前
    expect(direct[0].path[0].rule).toBe(1);
  });
  it("直接边按规则拆成多条论证", () => {
    // A 规则1 和 规则3 都指向 B
    const data = [s("A", "B", 2, 0), s("A", "B", 2, 1), s("A", "B", 2, 0)];
    const edges = buildEdges(data, F());
    const args = findArguments("A", "B", edges);
    const directRules = args.filter((a) => a.path.length === 1).map((a) => a.path[0].rule);
    expect(directRules).toContain(1);
    expect(directRules).toContain(3);
  });
});
