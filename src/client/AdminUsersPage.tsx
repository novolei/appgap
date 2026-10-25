import { useEffect,useRef,useState,type FormEvent } from "react";
import type { AdminUser,AdminUsers } from "../shared/community";
import { useAccount } from "./SiteShell";
import { communityApi,date,money } from "./community-api";

const when=(value:string|null)=>value?date(value):"暂无记录";
export function AdminUsersPage(){
  const {user,loading}=useAccount(),[data,setData]=useState<AdminUsers|null>(null),[search,setSearch]=useState(""),[params,setParams]=useState({q:"",page:1}),[revision,setRevision]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState(""),[selected,setSelected]=useState<AdminUser|null>(null);
  useEffect(()=>{
    if(!loading&&!user)location.assign("/login?next=/admin/users");
    if(user?.role!=="admin")return;
    let live=true;setBusy(true);setError("");setSelected(null);
    void communityApi<AdminUsers>(`/api/account/admin/users?${new URLSearchParams({q:params.q,page:String(params.page)})}`)
      .then(value=>{if(live)setData(value);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setBusy(false);});
    return()=>{live=false;};
  },[user,loading,params,revision]);
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setParams({q:search.trim(),page:1});}
  if(loading||!user)return <div className="community-page"><p role="status">正在核对登录状态…</p></div>;
  if(user.role!=="admin")return <div className="community-page"><h1>仅管理员可访问</h1><p>注册用户资料仅供站点管理员查看。</p><a className="button" href="/account">返回用户中心</a></div>;
  return <div className="community-page admin-users-page">
    <header className="community-hero"><div><span className="eyebrow">账号管理</span><h1>注册用户</h1><p>查看账号资料、注册时间和使用情况。时间均为香港时间。</p></div><a className="button" href="/account">返回用户中心</a></header>
    <section className="metric-cards" aria-label="用户概览">{[["注册用户",data?.summary.registered],["近 7 天注册",data?.summary.newThisWeek],["近 7 天登录",data?.summary.loggedInThisWeek],["管理员",data?.summary.admins]].map(([label,count])=><article key={label}><small>{label}</small><strong>{count??"—"}</strong></article>)}</section>
    <section className="panel admin-users-panel" aria-busy={busy}>
      <div className="admin-users-toolbar"><form role="search" onSubmit={submit}><label htmlFor="admin-user-search">搜索用户<input id="admin-user-search" value={search} onChange={e=>setSearch(e.target.value)} maxLength={64} placeholder="用户名、昵称或完整用户 ID"/></label><button className="button primary" disabled={busy}>搜索</button></form><button className="button" disabled={busy} onClick={()=>setRevision(value=>value+1)}>刷新</button></div>
      <p className="form-error" role="alert">{error}</p>
      {busy&&<p className="muted" role="status">正在读取用户列表…</p>}
      {data&&!error&&<><div className="admin-users-table-wrap"><table className="admin-users-table"><caption>{params.q?`搜索“${params.q}” · `:""}共 {data.total} 个账号，按注册时间倒序</caption><thead><tr><th scope="col">用户</th><th scope="col">角色</th><th scope="col">注册时间</th><th scope="col">最近登录</th><th scope="col">候选 / 立项</th><th scope="col">操作</th></tr></thead><tbody>
        {data.items.map(item=><tr key={item.id}><th scope="row"><span className="admin-user-name"><span className="avatar" aria-hidden="true">{Array.from(item.displayName)[0]}</span><span><strong>{item.displayName}</strong><small>@{item.username}</small></span></span></th><td><span className={`admin-role ${item.role==="admin"?"is-admin":""}`}>{item.role==="admin"?"管理员":"普通用户"}</span></td><td>{when(item.createdAt)}</td><td>{when(item.lastLoginAt)}</td><td>{item.watchCount} / {item.buildCount}</td><td><button className="button small" aria-label={`查看 ${item.username} 的详情`} disabled={busy} onClick={()=>setSelected(item)}>查看详情</button></td></tr>)}
        {!data.items.length&&<tr><td colSpan={6} className="admin-users-empty">没有找到匹配的用户。</td></tr>}
      </tbody></table></div><nav className="admin-users-pagination" aria-label="用户列表分页"><span>第 {data.page} / {Math.max(1,Math.ceil(data.total/data.pageSize))} 页 · 每页 {data.pageSize} 个</span><div><button className="button small" disabled={busy||data.page<=1} onClick={()=>setParams({...params,page:data.page-1})}>上一页</button><button className="button small" disabled={busy||data.page*data.pageSize>=data.total} onClick={()=>setParams({...params,page:data.page+1})}>下一页</button></div></nav></>}
    </section>
    {selected&&<UserDetails user={selected} close={()=>setSelected(null)}/>}
  </div>;
}
function UserDetails({user,close}:{user:AdminUser;close:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const element=dialog.current!;element.showModal();return()=>element.close();},[]);
  return <dialog ref={dialog} className="report-dialog admin-user-dialog" aria-labelledby="admin-user-title" onCancel={close}>
    <div className="section-heading"><h2 id="admin-user-title">{user.displayName} 的账号详情</h2><button className="button small" onClick={close}>关闭</button></div>
    <dl className="admin-user-fields"><div><dt>用户名</dt><dd>{user.username}</dd></div><div><dt>角色</dt><dd>{user.role==="admin"?"管理员":"普通用户"}</dd></div><div className="admin-user-id"><dt>用户 ID</dt><dd>{user.id}</dd></div><div><dt>注册时间</dt><dd>{when(user.createdAt)}</dd></div><div><dt>最近登录</dt><dd>{when(user.lastLoginAt)}</dd></div></dl>
    <div className="admin-user-usage">{[["候选收藏",user.watchCount],["准备立项",user.buildCount],["研究记录",user.researchCount],["有效账号会话",user.activeSessions]].map(([label,count])=><div key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
    <p className="admin-user-support">累计已确认支持 <strong>{money(user.donatedMinor)}</strong></p>
    <p className="form-note">研究记录包含已过期报告；支持金额只统计已确认到账且未退款的记录。有效会话不代表用户当前在线。早期账号没有登录记录时显示“暂无记录”。</p>
  </dialog>;
}
