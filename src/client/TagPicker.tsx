import { useMemo, useRef, useState } from "react";

const common = ["Action", "Adventure", "RPG", "Simulation", "Strategy", "Indie", "Co-op", "Racing", "Survival", "Roguelike"];
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().trim();
export function tagSuggestions(tags: string[], value: string) {
  const parts = value.split("+"), query = normalize(parts.pop() || "");
  const used = new Set(parts.map(normalize));
  const matches = [...new Set(tags)].filter(tag => !used.has(normalize(tag)) && normalize(tag).includes(query));
  matches.sort((a,b) => {
    const rank = (tag: string) => query ? (normalize(tag).startsWith(query) ? 0 : 1) : (common.includes(tag) ? common.indexOf(tag) : common.length);
    return rank(a)-rank(b) || a.localeCompare(b);
  });
  return { items: matches.slice(0,40), total: matches.length };
}
export function pickedTag(value: string, tag: string) {
  return [...value.split("+").slice(0,-1).map(s=>s.trim()).filter(Boolean),tag].join(" + ");
}
export function TagPicker({value,tags,onChange}:{value:string;tags:string[];onChange:(value:string)=>void}) {
  const input=useRef<HTMLInputElement>(null),[open,setOpen]=useState(false),[active,setActive]=useState(-1);
  const suggestions=useMemo(()=>tagSuggestions(tags,value),[tags,value]);
  const choose=(tag:string)=>{onChange(pickedTag(value,tag));setOpen(false);setActive(-1);input.current?.focus();};
  return <div className="steam-tag-picker" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node | null))setOpen(false);}}>
    <div className="steam-tag-control">
      <input ref={input} id="steam-tag-input" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls="steam-tag-results"
        aria-activedescendant={open&&suggestions.items[active] ? `steam-tag-option-${active}` : undefined} aria-describedby="steam-tag-help"
        value={value} maxLength={100} placeholder="搜索标签或输入关键词" autoComplete="off"
        onFocus={()=>setOpen(true)} onChange={e=>{onChange(e.target.value);setActive(-1);setOpen(true);}}
        onKeyDown={e=>{
          if(e.nativeEvent.isComposing)return;
          if(e.key==="ArrowDown"||e.key==="ArrowUp"){
            e.preventDefault();setOpen(true);
            const next=!open || active<0 ? (e.key==="ArrowDown"?0:suggestions.items.length-1) : Math.max(0,Math.min(suggestions.items.length-1,active+(e.key==="ArrowDown"?1:-1)));
            setActive(next);requestAnimationFrame(()=>document.getElementById(`steam-tag-option-${next}`)?.scrollIntoView({block:"nearest"}));
          }else if(e.key==="Escape"){e.preventDefault();e.stopPropagation();setOpen(false);setActive(-1);}
          else if(e.key==="Enter"&&open&&suggestions.items[active]){e.preventDefault();choose(suggestions.items[active]);}
        }}/>
      <button type="button" className="steam-tag-toggle" aria-label={open?"收起游戏标签":"展开游戏标签"} aria-expanded={open}
        onMouseDown={e=>e.preventDefault()} onClick={()=>{input.current?.focus();setOpen(!open);setActive(-1);}}><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>
    </div>
    {open&&<div className="steam-tag-popup"><div className="steam-tag-caption"><span>Steam 标签</span><span>{suggestions.total} 项匹配</span></div>
      <div id="steam-tag-results" role="listbox" aria-label="游戏标签建议">{suggestions.items.map((tag,index)=><button key={tag} type="button" role="option" tabIndex={-1} id={`steam-tag-option-${index}`} aria-selected={index===active}
        onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>choose(tag)}>{tag}</button>)}</div>
      <p>{suggestions.total===0 ? "没有匹配标签，可直接应用为关键词。" : suggestions.total>40 ? "显示前 40 项，输入文字可缩小范围。" : "选择后点击应用；也可以输入自定义关键词。"}</p>
    </div>}
  </div>;
}
