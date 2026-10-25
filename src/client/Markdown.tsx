import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https:\/\/[^\s)]+\))/g).map((part, index) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return part;
  });
}
const heading = /^#{1,6}\s+/;
const list = /^\s*(?:[-*•]|\d+\.)\s+/;
const separator = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const tableDivider = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

// shortcut: a safe Markdown subset for analysis prose; use a full parser if code blocks or nested lists become needed.
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").trim().split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index], key = index;
    if (!line.trim()) { index++; continue; }
    if (heading.test(line)) { blocks.push(<h3 key={key}>{inline(line.replace(heading, ""))}</h3>); index++; continue; }
    if (separator.test(line)) { blocks.push(<hr key={key} />); index++; continue; }
    if (line.includes("|") && tableDivider.test(lines[index + 1] || "")) {
      const headers = cells(line), rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|")) rows.push(cells(lines[index++]));
      blocks.push(<div className="md-table" key={key}><table><thead><tr>{headers.map((cell, i) => <th scope="col" key={i}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{headers.map((_, j) => <td key={j}>{inline(row[j] || "")}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (list.test(line)) {
      const ordered = /^\s*\d+\./.test(line), items: string[] = [];
      while (index < lines.length && list.test(lines[index]) && /^\s*\d+\./.test(lines[index]) === ordered) items.push(lines[index++].replace(list, ""));
      const content = items.map((item, i) => <li key={i}>{inline(item)}</li>);
      blocks.push(ordered ? <ol key={key}>{content}</ol> : <ul key={key}>{content}</ul>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={key}>{inline(quote.join("\n"))}</blockquote>);
      continue;
    }
    const paragraph = [lines[index++]];
    while (index < lines.length && lines[index].trim() && !heading.test(lines[index]) && !list.test(lines[index]) && !separator.test(lines[index]) && !/^>/.test(lines[index]) && !(lines[index].includes("|") && tableDivider.test(lines[index + 1] || ""))) paragraph.push(lines[index++]);
    blocks.push(<p key={key}>{paragraph.map((value, i) => <span key={i}>{i > 0 ? <br /> : null}{inline(value)}</span>)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
