// 生成论坛可直接粘贴的纯文本（含全部出处）。
import type { Argument, Verdict } from "../engine/types";
import { RULE_NAME, chainSummary, describeEdge, name, type Teams } from "./describe";

const DISCLAIMER = "（本工具为娱乐性质，论据 ≠ 真理，正反结论可能同时成立。出处均可点击核验。）";

function argToText(teams: Teams, arg: Argument, i: number): string {
  const lines: string[] = [];
  const kind = arg.path.length === 1 ? RULE_NAME[arg.path[0].rule] : "传递链";
  lines.push(`■ 论据 ${i}（${kind}）`);
  if (arg.path.length > 1) lines.push(chainSummary(teams, arg));
  for (const e of arg.path) {
    const d = describeEdge(teams, e);
    lines.push(`· ${d.title}`);
    for (const detail of d.details) lines.push(`  ${detail}`);
    if (d.url) lines.push(`  出处：${d.url}`);
  }
  return lines.join("\n");
}

export function verdictToText(
  teams: Teams,
  verdict: Verdict,
  opts: { shareUrl?: string; includeReverse?: boolean; limit?: number } = {},
): string {
  const a = name(teams, verdict.a);
  const b = name(teams, verdict.b);
  const limit = opts.limit ?? 5;
  const out: string[] = [];
  out.push(`【赢学联盟判案】${a} > ${b}`);
  out.push("");

  if (verdict.forward.length) {
    verdict.forward.slice(0, limit).forEach((arg, idx) => {
      out.push(argToText(teams, arg, idx + 1));
      out.push("");
    });
    if (verdict.forward.length > limit) {
      out.push(`（另有 ${verdict.forward.length - limit} 条论据未列出）`);
      out.push("");
    }
  } else {
    out.push(`目前找不到支持「${a} > ${b}」的论据链。`);
    if (verdict.hint) out.push(verdict.hint);
    out.push("");
  }

  if (opts.includeReverse && verdict.reverse.length) {
    out.push(`—— 对方可能这样反驳（${b} > ${a}）——`);
    verdict.reverse.slice(0, 3).forEach((arg, idx) => {
      out.push(argToText(teams, arg, idx + 1));
      out.push("");
    });
  }

  if (opts.shareUrl) {
    out.push(`一键复现：${opts.shareUrl}`);
    out.push("");
  }
  out.push(DISCLAIMER);
  return out.join("\n");
}
