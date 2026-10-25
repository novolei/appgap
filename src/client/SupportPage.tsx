import { useEffect,useState,type FormEvent } from "react";
import type { DonationFeed } from "../shared/community";
import { useAccount } from "./SiteShell";
import { communityApi,date,money } from "./community-api";

type ReviewRow={id:string;username:string;amount_minor:number;status:string;created_at:string;public_name:string};
export function SupportPage(){
  const {user}=useAccount(),[feed,setFeed]=useState<DonationFeed|null>(null),[records,setRecords]=useState<ReviewRow[]>([]),[error,setError]=useState(""),[message,setMessage]=useState(""),[reference,setReference]=useState(""),[busy,setBusy]=useState(false);
  const load=async()=>{setFeed(await communityApi<DonationFeed>("/api/donations/public"));if(user?.role==="admin")setRecords((await communityApi<{items:ReviewRow[]}>("/api/donations/admin/records")).items);};
  useEffect(()=>{void load().catch(e=>setError(e.message));const timer=setInterval(()=>{if(!document.hidden)void load().catch(()=>{});},30000);return()=>clearInterval(timer);},[user?.id]);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setMessage("");setError("");const form=new FormData(event.currentTarget);try{const result=await communityApi<{id:string}>("/api/donations/intent",{amount:form.get("amount"),name:form.get("name"),message:form.get("message"),public:form.get("public")==="on"});setReference(result.id);setMessage("已登记为待确认记录。请在支付宝付款备注中填写下方编号。管理员核对真实到账后才会计入累计；本次登记不会扣款。");await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function review(event:FormEvent<HTMLFormElement>,id:string){event.preventDefault();const form=new FormData(event.currentTarget);setError("");try{await communityApi(`/api/donations/admin/${id}/review`,Object.fromEntries(form.entries()));setMessage("记录已更新，累计榜与动态已同步。");await load();}catch(e){setError((e as Error).message);}}
  return <div className="community-page support-page">
    <header className="community-hero">
      <div><h1>支持 AppGap</h1><p>DeepSeek 分析会产生额外的 Token 费用。<br/>如果 AppGap 对你有帮助，欢迎自愿支持，用于支付这部分费用。</p></div>
      <div className="support-total"><small>累计支持 · 人民币</small><strong>{feed ? money(feed.totals.amountMinor) : "—"}</strong><span>{feed ? `${feed.totals.supporters} 位支持者` : "正在读取…"}</span></div>
    </header>
    <div className="support-layout">
      <section className="panel donate-card" id="donate">
        <h2>支付宝支持</h2><p className="muted">使用支付宝扫描下方收款码。</p>
        {!feed ? <p className="muted">正在读取收款码…</p> : feed.qrUrl ? <figure className="donation-qr"><img src={feed.qrUrl} alt="AppGap 作者的支付宝收款码" width="220" height="259"/><figcaption>人民币收款</figcaption><a href={feed.qrUrl} download="AppGap-支付宝收款码.png">保存收款码</a></figure> : feed.paymentUrl ? <a className="button primary" href={feed.paymentUrl} target="_blank" rel="noopener noreferrer">打开收款页面 ↗</a> : <div className="notice">暂未配置收款方式。</div>}
        <p className="form-note">如需登记支持记录，请先在下方获取编号，并在付款备注中填写。</p>
      </section>
      <section className="panel leaderboard">
        <div className="section-heading"><h2>累计支持榜</h2><span>人民币</span></div><p className="muted">按已确认到账的累计金额排序。</p>
        {feed?.rankings.length ? <ol>{feed.rankings.map((item,index)=><li key={item.id}><span className={`rank-number rank-${index+1}`}>{String(index+1).padStart(2,"0")}</span><span className="avatar">{item.name.slice(0,1)}</span><span><b>{item.name}</b><small>{item.times} 次支持</small></span><strong>{money(item.amountMinor)}</strong></li>)}</ol> : <div className="empty-support"><p>{feed ? "暂无公开的支持记录。" : "正在读取支持记录…"}</p></div>}
        <p className="support-ranking-note">仅展示同意公开的记录，已退款金额不计入。</p>
      </section>
    </div>
    <section className="panel support-registration">
      <div className="section-heading"><h2>登记支持记录</h2><span>到账后由管理员核对</span></div>
      {user ? <form className="support-form" onSubmit={submit}>
        <label>支持金额 · 人民币<input name="amount" type="text" inputMode="decimal" required pattern={"[1-9][0-9]{0,5}(\\.[0-9]{1,2})?"} placeholder="例如 20.00"/></label>
        <label>展示昵称<input name="name" defaultValue={user.displayName} required maxLength={32}/></label>
        <label className="support-form-wide">留言（可选）<textarea name="message" rows={2} maxLength={120} placeholder="最多 120 字"/></label>
        <label className="check-label support-form-wide"><input type="checkbox" name="public"/>允许公开昵称、金额和留言，加入支持榜与滚动动态</label>
        <div className="support-form-actions support-form-wide"><button className="button primary" disabled={busy}>{busy ? "登记中…" : "登记支持记录"}</button><p className="form-note">登记不会扣款。默认不公开，可在用户中心修改。</p></div>
      </form> : <div className="support-signin"><p className="muted">登录后可登记支持记录，并选择是否公开。</p><a className="button primary" href="/login?next=/support">登录后登记</a></div>}
      <p className="form-error" role="alert">{error}</p><p className="success-note" role="status">{message}</p>
      {reference&&<div className="notice">付款备注编号：<code className="donation-reference">{reference}</code><button className="text-button" onClick={()=>void navigator.clipboard.writeText(reference).then(()=>setMessage("登记编号已复制，请粘贴到付款备注。"))}>复制编号</button></div>}
    </section>
    <section className="panel support-recent"><div className="section-heading"><h2>最近支持</h2><small>每 30 秒更新</small></div><div className="support-notes">{feed?.recent.length ? feed.recent.map(item=><article key={item.id}>{item.message&&<p>{item.message}</p>}<footer><b>{item.name}</b><span>{money(item.amountMinor)} · {date(item.confirmedAt)}</span></footer></article>) : <p className="muted">{feed ? "暂无公开的支持记录。" : "正在读取支持记录…"}</p>}</div></section>
    {user?.role==="admin"&&<section className="panel admin-support"><h2>管理员 · 到账核对</h2><p className="muted">请先在真实收款渠道核实金额与流水号。此处操作只更新站内账本，不执行收款或退款；退款必须先在渠道完成。</p>{records.map(row=><details key={row.id}><summary>{row.public_name} · {money(row.amount_minor)} · {row.status} <small>{date(row.created_at)}</small></summary><p className="form-note">账号：{row.username} · 记录 {row.id}</p><form onSubmit={e=>void review(e,row.id)}><label>核对动作<select name="action"><option value="">请选择</option>{row.status==="pending"&&<><option value="confirm">已核实到账，确认入账</option><option value="reject">未核实到账，驳回</option></>}{row.status==="confirmed"&&<option value="refund">已在渠道全额退款，从累计中移除</option>}</select></label>{row.status==="pending"&&<><label>实际到账金额<input name="amount" defaultValue={(row.amount_minor/100).toFixed(2)}/></label><label>唯一收款流水号<input name="reference" minLength={3} maxLength={120}/></label></>}<button className="button">提交核对结果</button></form></details>)}</section>}
  </div>;
}
