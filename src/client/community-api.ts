export async function communityApi<T>(path:string,body?:unknown):Promise<T> {
  const response=await fetch(path,body===undefined ? undefined : {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const value=await response.json().catch(()=>({error:"服务器暂时没有响应。"}));
  if(!response.ok) throw new Error(value && typeof value==="object" && "error" in value && typeof value.error==="string" ? value.error : `请求失败（${response.status}）`);
  return value as T;
}
export const money=(minor:number)=>new Intl.NumberFormat("zh-CN",{style:"currency",currency:"CNY",maximumFractionDigits:2}).format(minor/100);
export const date=(value:string)=>new Date(value).toLocaleString("zh-CN",{timeZone:"Asia/Hong_Kong",hour12:false});
