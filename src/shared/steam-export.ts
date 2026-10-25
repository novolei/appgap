export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const safe =
    typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
