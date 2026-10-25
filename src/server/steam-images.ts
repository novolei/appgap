import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FILE_LIMIT=256*1024, WEEK=7*86400000;
type Image = {bytes:Buffer;mime:string;etag:string;state:"HIT"|"MISS"|"STALE"};
function mime(bytes:Buffer) {
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return "image/png";
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return "image/jpeg";
  if(bytes.subarray(0,4).toString()==="RIFF"&&bytes.subarray(8,12).toString()==="WEBP")return "image/webp";
  return null;
}
export function imageSource(id:string,source:unknown):string|null {
  if(!/^\d{1,20}$/.test(id)||typeof source!=="string"||source.length>2048)return null;
  try{
    const url=new URL(source);
    if(url.protocol!=="https:"||url.hostname!=="shared.fastly.steamstatic.com"||url.port||url.username||url.password||url.hash)return null;
    if(!new RegExp(`^/store_item_assets/(?:steam/)?apps/${id}/[A-Za-z0-9_./-]+\\.(?:jpg|jpeg|png|webp)$`).test(url.pathname))return null;
    return url.href;
  }catch{return null;}
}
export class SteamImageCache {
  private pending=new Map<string,Promise<Image|null>>();
  private failures=new Map<string,number>();
  private active=0;
  private queue:(()=>void)[]=[];
  private writes=Promise.resolve();
  constructor(private directory:string,private budget=32*1024*1024){}
  private async slot<T>(make:()=>Promise<T>):Promise<T>{
    if(this.active>=2)await new Promise<void>(resolve=>this.queue.push(resolve));else this.active++;
    try{return await make();}finally{const next=this.queue.shift();if(next)next();else this.active--;}
  }
  private async stored(path:string){
    try{
      const info=await stat(path);if(!info.isFile()||info.size>FILE_LIMIT)return null;
      const bytes=await readFile(path),type=mime(bytes);if(!type)return null;
      return {bytes,mime:type,etag:`"${createHash("sha256").update(bytes).digest("hex")}"`,modified:info.mtimeMs};
    }catch{return null;}
  }
  private async save(name:string,bytes:Buffer){
    const write=this.writes.then(async()=>{
      await mkdir(this.directory,{recursive:true,mode:0o700});
      const entries=[];
      for(const file of await readdir(this.directory)){
        if(!/^\d{1,20}-[a-f0-9]{64}\.img(?:\.tmp)?$/.test(file)||file===name)continue;
        const path=join(this.directory,file),info=await stat(path);
        if(!info.isFile())continue;
        if(info.mtimeMs<Date.now()-30*86400000 || file.endsWith(".tmp")&&info.mtimeMs<Date.now()-3600000){await unlink(path);continue;}
        entries.push({path,size:info.size,modified:info.mtimeMs});
      }
      let total=entries.reduce((n,file)=>n+file.size,0),count=entries.length;
      for(const file of entries.sort((a,b)=>a.modified-b.modified)){
        if(total+bytes.length<=this.budget&&count<1000)break;
        await unlink(file.path);total-=file.size;count--;
      }
      if(bytes.length>this.budget)throw Error("image exceeds cache budget");
      const temporary=join(this.directory,name+".tmp");
      try{await writeFile(temporary,bytes,{mode:0o600});await rename(temporary,join(this.directory,name));}
      finally{await unlink(temporary).catch(()=>{});}
    });
    this.writes=write.catch(()=>{});return write;
  }
  async get(id:string,source:unknown):Promise<Image|null>{
    const url=imageSource(id,source);if(!url)return null;
    const key=createHash("sha256").update(url).digest("hex"),name=`${id}-${key}.img`;
    const cached=await this.stored(join(this.directory,name));
    if(cached&&cached.modified>Date.now()-WEEK)return {...cached,state:"HIT"};
    const stale=cached?{...cached,state:"STALE" as const}:null;
    if((this.failures.get(key)||0)>Date.now())return stale;
    if(this.pending.has(key))return stale||this.pending.get(key)!;
    if(this.pending.size>=64)return stale;
    const task=this.slot(async()=>{
      try{
        const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(8000),headers:{"User-Agent":"AppGap-Steam-Image-Cache/1.0 (+https://appgap.if2.ai)"}});
        if(!response.ok||!response.body||Number(response.headers.get("content-length"))>FILE_LIMIT)throw Error("invalid image response");
        const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
        while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>FILE_LIMIT){await reader.cancel();throw Error("image too large");}chunks.push(part.value);}
        const bytes=Buffer.concat(chunks),type=mime(bytes);if(!type)throw Error("unsupported image bytes");
        await this.save(name,bytes);this.failures.delete(key);
        return {bytes,mime:type,etag:`"${createHash("sha256").update(bytes).digest("hex")}"`,state:"MISS" as const};
      }catch{
        for(const [failed,until] of this.failures)if(until<Date.now())this.failures.delete(failed);
        if(this.failures.size>=1000)this.failures.delete(this.failures.keys().next().value!);
        this.failures.set(key,Date.now()+10*60000);return stale;
      }finally{this.pending.delete(key);}
    });
    this.pending.set(key,task);
    return stale||task;
  }
}
