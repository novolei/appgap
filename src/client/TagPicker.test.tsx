import { expect,it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { pickedTag,tagSuggestions,TagPicker } from "./TagPicker";

it("completes only the active AND term, excludes selected tags, and accepts literal custom text",()=>{
  const tags=["Action","Racing","Co-op","Online Co-Op","Space","Action"];
  expect(tagSuggestions(tags,"Racing + co").items).toEqual(["Co-op","Online Co-Op"]);
  expect(tagSuggestions(tags,"RACING + ").items).not.toContain("Racing");
  expect(pickedTag(" Racing + co","Co-op")).toBe("Racing + Co-op");
  expect(tagSuggestions(tags,"[custom].*").items).toEqual([]);
  expect(tagSuggestions(tags,"ｒａｃ").items).toEqual(["Racing"]);
});
it("bounds the popup and connects keyboard navigation with accessible combobox markup",()=>{
  expect(tagSuggestions(Array.from({length:100},(_,i)=>`Tag ${i}`),"").items).toHaveLength(40);
  const html=renderToStaticMarkup(<TagPicker value="Racing" tags={["Racing"]} onChange={()=>{}}/>);
  expect(html).toContain('role="combobox"');expect(html).toContain('aria-expanded="false"');expect(html).toContain('aria-controls="steam-tag-results"');expect(html).not.toContain('<datalist');
});
