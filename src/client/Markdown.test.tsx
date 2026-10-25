import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown";

it("renders analysis tables, emphasis and lists even without blank separators", () => {
  const html = renderToStaticMarkup(<Markdown text={'## 事实\n**范围**\n- 29 地区\n- `430` 游戏\n\n| 标签 | n/N |\n|---|---|\n| 合作 | 21/93 |\n\n> 不是市场份额\n\n---'} />);
  expect(html).toContain('<strong>范围</strong>');
  expect(html).toContain('<code>430</code>');
  expect(html).toContain('<th scope="col">标签</th>');
  expect(html).toContain('<td>21/93</td>');
  expect(html).toContain('<blockquote>不是市场份额</blockquote>');
  expect(html).not.toContain('|---|');
});
it("escapes source HTML and leaves unsafe links as text", () => {
  const html = renderToStaticMarkup(<Markdown text={'<img src=x onerror=alert(1)> **<script>** [bad](javascript:alert(1)) [Steam](https://store.steampowered.com/app/1/)'} />);
  expect(html).not.toContain('<img');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('rel="noopener noreferrer"');
});
