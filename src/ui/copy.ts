// 生成论坛可直接粘贴的纯文本（含全部出处）。
import type { Argument, Verdict } from "../engine/types";
import { argKind, chainSummary, describeEdge, formatHint, name, type Teams } from "./describe";
import { t, tc } from "../i18n";

function argToText(teams: Teams, arg: Argument, i: number): string {
  const lines: string[] = [];
  lines.push(t("copy.argHeader", { i, kind: argKind(arg.path) }));
  if (arg.path.length > 1) lines.push(chainSummary(teams, arg));
  for (const e of arg.path) {
    const d = describeEdge(teams, e);
    lines.push(`· ${d.title}`);
    for (const detail of d.details) lines.push(`  ${detail}`);
    if (d.url) lines.push(t("copy.source", { url: d.url }));
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
  out.push(t("copy.header", { a, b }));
  out.push("");

  if (verdict.forward.length) {
    verdict.forward.slice(0, limit).forEach((arg, idx) => {
      out.push(argToText(teams, arg, idx + 1));
      out.push("");
    });
    if (verdict.forward.length > limit) {
      out.push(tc("copy.notShown", verdict.forward.length - limit));
      out.push("");
    }
  } else {
    out.push(t("copy.emptyMessage", { a, b }));
    if (verdict.hint) out.push(formatHint(verdict.hint));
    out.push("");
  }

  if (opts.includeReverse && verdict.reverse.length) {
    out.push(t("copy.reverseHeader", { a, b }));
    verdict.reverse.slice(0, 3).forEach((arg, idx) => {
      out.push(argToText(teams, arg, idx + 1));
      out.push("");
    });
  }

  if (opts.shareUrl) {
    out.push(t("copy.shareUrl", { url: opts.shareUrl }));
    out.push("");
  }
  out.push(t("copy.disclaimer"));
  return out.join("\n");
}
