import { useEffect,useState,type FormEvent } from "react";
import type { Dashboard,Donation } from "../shared/community";
import { useAccount } from "./SiteShell";
import { communityApi,date,money } from "./community-api";
import { Markdown } from "./Markdown";

const safeNext=()=>{const value=new URLSearchParams(location.search).get("next")||"/steam";return value.startsWith("/")&&!value.startsWith("//")&&!value.includes("\\") ? value:"/steam";};
export function LoginPage(){
  const register=location.pathname==="/register",initial=new URLSearchParams(location.search).get("mode");
  const [mode,setMode]=useState(register?"register":initial==="recover"?"recover":"login"),[error,setError]=useState(""),[busy,setBusy]=useState(false),[recovery,setRecovery]=useState("");
  const {refresh}=useAccount();
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setError("");
    try{
      if(mode==="admin"){await communityApi("/api/login",{password:form.get("password")});location.assign(safeNext());return;}
      if(mode!=="login" && form.get("password")!==form.get("confirm"))throw Error("两次输入的密码不一致。");
      const body=mode==="recover"?{username:form.get("username"),recoveryCode:form.get("code"),newPassword:form.get("password")}:{username:form.get("username"),password:form.get("password"),displayName:form.get("displayName")||form.get("username")};
      const result=await communityApi<{recoveryCode?:string}>(`/api/account/${mode}`,body);await refresh();
      if(result.recoveryCode)setRecovery(result.recoveryCode);else location.assign(safeNext());
    }catch(e){setError(e instanceof Error?e.message:"操作失败。");}finally{setBusy(false);}
  }
  return <div className="auth-layout"><section className="auth-story"><span className="eyebrow">A PLACE FOR YOUR NEXT IDEA</span><h1>下一次机会，<br/>从一个好问题开始。</h1><p>把榜单中的信号、玩家的抱怨与自己的设想，整理成可以验证的下一步。</p><div className="story-notes"><span>01 <b>看见需求</b><small>App Store 与 Steam 的真实榜单线索</small></span><span>02 <b>保留判断</b><small>属于你的候选、立项与研究记录</small></span><span>03 <b>减少重复</b><small>共享已有分析，把成本留给新问题</small></span></div></section>
    <section className="auth-card"><span className="eyebrow">YOUR RESEARCH DESK</span><h2>{recovery?"保存你的恢复码":mode==="register"?"创建研究账号":mode==="recover"?"找回账号":mode==="admin"?"站点管理员登录":"欢迎回来"}</h2>
      {recovery ? <Recovery code={recovery} onContinue={()=>location.assign("/account")}/> : <form onSubmit={submit}>
        {mode!=="admin"&&<label>用户名<input name="username" autoComplete="username" required minLength={3} maxLength={24} pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,23}" placeholder="3–24 位字母、数字、_ 或 -"/></label>}
        {mode==="register"&&<label>昵称<input name="displayName" autoComplete="nickname" maxLength={32} placeholder="你的研究者名字（可选）"/></label>}
        {mode==="recover"&&<label>一次性恢复码<input name="code" type="password" autoComplete="off" required maxLength={43}/></label>}
        <label>{mode==="recover"?"新密码":"密码"}<input name="password" type="password" autoComplete={mode==="register"||mode==="recover"?"new-password":"current-password"} required minLength={mode==="login"||mode==="admin"?1:12} maxLength={128} placeholder={mode==="register"?"至少 12 个字符":"输入密码"}/></label>
        {(mode==="register"||mode==="recover")&&<label>确认密码<input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label>}
        <p className="form-error" role="alert">{error}</p><button className="button primary" disabled={busy}>{busy?"处理中…":mode==="register"?"创建账号":mode==="recover"?"恢复账号": "登录"}</button>
        <p className="form-note">{mode==="register"?"不需要邮箱。注册后请保存一次性恢复码；它是忘记密码时的找回凭据。收藏和私人研究仅对你可见。":"登录后可以管理自己的收藏、研究记录和支持记录。"}</p>
      </form>}
      {!recovery&&<div className="auth-links"><a href={register?"/login":"/register"}>{register?"已有账号？登录":"还没有账号？创建一个"}</a><button className="text-button" onClick={()=>{setMode(mode==="recover"?"login":"recover");setError("");}}>恢复账号</button><button className="text-button muted" onClick={()=>{setMode(mode==="admin"?"login":"admin");setError("");}}>管理员入口</button></div>}
    </section></div>;
}
export function Recovery({code,onContinue}:{code:string;onContinue:()=>void}){
  const [saved,setSaved]=useState(false);
  return <div className="recovery-box"><p>只展示这一次。请离线保管，不要把它发给其他人。使用后会生成新恢复码，并使旧登录失效。</p><code>{code}</code><button type="button" className="button" onClick={()=>void navigator.clipboard.writeText(code).then(()=>setSaved(true))}>{saved?"已复制，请妥善保存":"复制恢复码"}</button><label className="check-label"><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/>我已妥善保存</label><button type="button" className="button primary" disabled={!saved} onClick={onContinue}>进入用户中心</button></div>;
}
export function AccountPage(){
  const {user,loading,refresh}=useAccount(),[data,setData]=useState<Dashboard|null>(null),[donations,setDonations]=useState<Donation[]>([]),[message,setMessage]=useState(""),[error,setError]=useState(""),[report,setReport]=useState<{title:string;markdown:string}|null>(null),[recovery,setRecovery]=useState("");
  const load=async()=>{const [d,s]=await Promise.all([communityApi<Dashboard>("/api/account/dashboard"),communityApi<{items:Donation[]}>("/api/donations/mine")]);setData(d);setDonations(s.items);};
  useEffect(()=>{if(!loading&&!user)location.assign("/login?next=/account");if(user)void load().catch(e=>setError(e.message));},[user,loading]);
  async function save(event:FormEvent<HTMLFormElement>,path:string){event.preventDefault();setError("");setMessage("");const form=new FormData(event.currentTarget);try{const result=await communityApi<{recoveryCode?:string}>(path,Object.fromEntries(form.entries()));if(result.recoveryCode)setRecovery(result.recoveryCode);await refresh();await load();setMessage("已保存。");}catch(e){setError((e as Error).message);}}
  if(!user||!data)return <div className="community-page"><p role="status">{error||"正在准备你的研究桌…"}</p></div>;
  return <div className="community-page"><header className="community-hero"><div><span className="eyebrow">YOUR RESEARCH DESK</span><h1>{user.displayName} 的研究桌</h1><p>把发现留住，把下一步想清楚。</p></div><a className="button primary" href="/steam">继续研究 ↗</a></header>
    <div className="metric-cards"><article><small>候选收藏</small><strong>{data.pools.find(p=>p.pool==="watch")?.n||0}</strong><span className="record-links"><a href="/#lens=watch">App Store →</a><a href="/steam?pool=watch">Steam →</a></span></article><article><small>正在立项</small><strong>{data.pools.find(p=>p.pool==="build")?.n||0}</strong><span className="record-links"><a href="/#lens=build">App Store →</a><a href="/steam?pool=build">Steam →</a></span></article><article><small>今日个人新研究</small><strong>{data.personalRemaining}<span>/ 5</span></strong><small>全站剩余 {data.budget.remaining}/{data.budget.limit} · 缓存读取不扣额度</small></article><article><small>累计支持</small><strong>{money(donations.filter(d=>d.status==="confirmed").reduce((n,d)=>n+d.amountMinor,0))}</strong><a href="/support">支持研究站 →</a></article></div>
    <p className="form-error" role="alert">{error}</p><p className="success-note" role="status">{message}</p>
    {recovery&&<section className="panel"><h2>更新后的恢复码</h2><Recovery code={recovery} onContinue={()=>setRecovery("")}/></section>}
    <div className="account-columns"><section className="panel"><div className="section-heading"><h2>最近研究</h2><span>{data.history.length} 条</span></div><p className="muted">私人研究随账号保存至缓存到期；到期后需重新生成。这里展示最近 30 条。</p>{data.history.length ? data.history.map(item=><button className="history-row" key={item.id} onClick={()=>void communityApi<{title:string;markdown:string}>(`/api/account/research/${encodeURIComponent(item.id)}`).then(setReport).catch(e=>setError(e.message))}><span><b>{item.title}</b><small>{date(item.createdAt)} · {item.visibility==="shared"?"共享报告":"私人研究"}</small></span><span>{Date.parse(item.expiresAt)<Date.now()?"已过期":"阅读 ↗"}</span></button>):<div className="empty-card">还没有研究记录。去工作台阅读一份分析，或提出自己的问题。</div>}</section>
    <section className="panel"><h2>个人资料</h2><form onSubmit={e=>void save(e,"/api/account/profile")}><label>用户名<input value={user.username} readOnly/></label><label>昵称<input name="displayName" defaultValue={user.displayName} required maxLength={32}/></label><button className="button">保存昵称</button></form><p className="form-note">{user.role==="admin"?"站点管理员":"研究者"} · 收藏和私人研究按账号隔离。</p></section></div>
    <div className="account-columns"><section className="panel"><h2>支持记录</h2><p className="muted">仅已确认到账的支持计入累计；公开展示由你决定。</p>{donations.length?donations.map(item=><div className="history-row" key={item.id}><span><b>{money(item.amountMinor)}</b><small>{date(item.createdAt)} · {{pending:"待确认",confirmed:"已到账",rejected:"未通过",refunded:"已退款"}[item.status]}</small></span><button className="text-button" onClick={()=>void communityApi(`/api/donations/${item.id}/privacy`,{public:!item.public}).then(load).catch(e=>setError(e.message))}>{item.public?"改为不公开":"允许公开昵称、金额与留言"}</button></div>):<div className="empty-card">还没有支持记录。你的每次认真研究，也让这里更有意义。</div>}</section>
    <section className="panel"><h2>账号安全</h2>{user.id!=="owner"?<form onSubmit={e=>void save(e,"/api/account/password")}><label>当前密码<input type="password" name="password" autoComplete="current-password" required maxLength={128}/></label><label>新密码<input type="password" name="newPassword" autoComplete="new-password" required minLength={12} maxLength={128}/></label><button className="button">更新密码与恢复码</button></form>:<p className="muted">管理员沿用服务器站点口令，不在网页修改。原有候选与立项已保留在此账号。</p>}<hr/><p className="form-note">{user.id==="owner"?"管理员登录最长 30 天；更换服务器口令可使全部旧登录失效。":`${data.sessions} 个有效账号会话 · 会话最长 30 天。`}</p><button className="text-button danger" onClick={()=>void communityApi("/api/account/revoke-sessions",{}).then(()=>location.assign("/login"))}>{user.id==="owner"?"退出管理员登录":"退出所有设备"}</button></section></div>
    {report&&<ReportDialog report={report} close={()=>setReport(null)}/>}
  </div>;
}
function ReportDialog({report,close}:{report:{title:string;markdown:string};close:()=>void}){
  useEffect(()=>{const dialog=document.getElementById("report-dialog") as HTMLDialogElement;dialog.showModal();return()=>dialog.close();},[]);
  return <dialog id="report-dialog" className="report-dialog" onCancel={close}><div className="section-heading"><h2>{report.title}</h2><button className="button" onClick={close}>关闭</button></div><Markdown text={report.markdown}/></dialog>;
}
