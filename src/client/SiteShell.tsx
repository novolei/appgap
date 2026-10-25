import { createContext,useContext,useEffect,useState,type ReactNode } from "react";
import type { Actor,DonationFeed } from "../shared/community";
import { communityApi,money } from "./community-api";
import "./community.css";

const AccountContext=createContext<{user:Actor|null;loading:boolean;refresh:()=>Promise<void>}>({user:null,loading:true,refresh:async()=>{}});
export const useAccount=()=>useContext(AccountContext);
export function SiteShell({children}:{children:ReactNode}) {
  const [user,setUser]=useState<Actor|null>(null),[loading,setLoading]=useState(true);
  async function refresh(){try{setUser((await communityApi<{user:Actor|null}>("/api/account/me")).user);}finally{setLoading(false);}}
  useEffect(()=>{void refresh().catch(()=>setLoading(false));},[]);
  const path=window.location.pathname;
  useEffect(()=>{document.title=`AppGap · ${{"/login":"登录","/register":"创建账号","/account":"用户中心","/support":"支持者与捐赠","/steam":"Steam 机会研究"}[path]||"App Store 机会研究"}`;},[path]);
  return <AccountContext.Provider value={{user,loading,refresh}}><div className="site-shell">
    <a className="skip-link" href="#main-content">跳至内容</a>
    <header className="site-header"><a className="site-brand" href="/"><span className="brand-mark">a<span>g</span></span><span>AppGap<small>发现需求，验证机会</small></span></a>
      <nav aria-label="主导航"><a aria-current={path==="/"?"page":undefined} href="/">App Store</a><a aria-current={path==="/steam"?"page":undefined} href="/steam">Steam 研究</a><a aria-current={path==="/support"?"page":undefined} href="/support">支持者</a></nav>
      <div className="account-nav">{user ? <><a className="user-pill" href="/account"><span className="avatar">{user.displayName.slice(0,1)}</span><span>{user.displayName}</span></a><button className="text-button" onClick={()=>void communityApi("/api/account/logout",{}).then(()=>location.assign("/login"))}>退出</button></> : <><a href="/login">登录</a><a className="button primary small" href="/register">创建账号</a></>}</div>
    </header>
    {!path.match(/^\/(login|register)/) && <SupportTicker />}
    <main id="main-content">{children}</main>
    <footer className="site-footer"><span>AppGap · App Store 与 Steam 数据研究</span><span><a href="/support">支持 AppGap</a> · <a href="/account">用户中心</a></span><small>榜单提供研究线索，机会仍需真实用户与原型验证。</small></footer>
  </div></AccountContext.Provider>;
}
function SupportTicker(){
  const [feed,setFeed]=useState<DonationFeed|null>(null),[paused,setPaused]=useState(false),[hovered,setHovered]=useState(false);
  useEffect(()=>{let live=true;const load=()=>{if(!document.hidden)void communityApi<DonationFeed>("/api/donations/public").then(v=>{if(live)setFeed(v);}).catch(()=>{});};load();const timer=setInterval(load,30000);return()=>{live=false;clearInterval(timer);};},[]);
  const entries=feed?.recent || [];
  const content=entries.length ? entries.map(item=><span className="ticker-item" key={item.id}><strong>{item.name}</strong> 支持了 <b>{money(item.amountMinor)}</b>{item.message && <span>“{item.message}”</span>}</span>) : <span className="ticker-item">DeepSeek 分析会产生 Token 费用，欢迎自愿支持。</span>;
  return <aside className="support-strip" aria-label="支持者动态"><span className="live-label"><i/>支持动态</span>
    <a href="/support" className={`ticker-link ${paused||hovered?"paused":""}`} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocus={()=>setHovered(true)} onBlur={()=>setHovered(false)} aria-label="查看支持者动态与捐赠入口">
      <span className={`ticker-track ${entries.length?"moving":""}`}><span className="ticker-group">{content}</span>{entries.length>0&&<span className="ticker-group" aria-hidden="true">{content}</span>}</span>
    </a>{entries.length>0&&<button className="ticker-pause" aria-pressed={paused} onClick={()=>setPaused(!paused)}>{paused?"继续":"暂停"}</button>}<a className="ticker-cta" href="/support">支持一下 ↗</a>
  </aside>;
}
