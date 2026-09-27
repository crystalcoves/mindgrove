/** Turn Web Share Target query params (title / text / url) into one capture line. */
export function shareToText(params: URLSearchParams): string | null {
  const title = params.get("title")?.trim() ?? "";
  const text = params.get("text")?.trim() ?? "";
  const url = params.get("url")?.trim() ?? "";
  const parts: string[] = [];
  if (title) parts.push(title);
  // Many apps put the link inside `text`; don't repeat it.
  if (text && text !== title) parts.push(text);
  if (url && !parts.some((p) => p.includes(url))) parts.push(url);
  const line = parts.join(" — ").replace(/\s+/g, " ").trim();
  return line || null;
}
