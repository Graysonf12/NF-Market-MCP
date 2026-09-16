/** Shared formatting helpers. */

export const CHARACTER_LIMIT = 25000;

export function enforceCharLimit(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n\n…[truncated at ${CHARACTER_LIMIT} characters — narrow the request (fewer markets, a player filter, limit/offset) or use response_format='json' with pagination]`
  );
}

export function fmtOdds(o: number | null | undefined): string {
  if (o == null || Number.isNaN(o)) return "n/a";
  return o > 0 ? `+${o}` : `${o}`;
}

export function pct(p: number | null | undefined, digits = 1): string {
  if (p == null || Number.isNaN(p)) return "n/a";
  return `${(100 * p).toFixed(digits)}%`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function toolText(markdown: string, structured: Record<string, unknown>, format: "markdown" | "json") {
  const text = format === "json" ? JSON.stringify(structured, null, 2) : markdown;
  return {
    content: [{ type: "text" as const, text: enforceCharLimit(text) }],
    structuredContent: structured,
  };
}

export function toolError(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
