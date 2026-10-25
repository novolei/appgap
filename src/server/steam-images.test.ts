import { afterEach,expect,it,vi } from "vitest";
import { mkdtempSync,readdirSync,rmSync,utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve,sep } from "node:path";
import { imageSource,SteamImageCache } from "./steam-images";

const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6T8AAAAASUVORK5CYII=","base64");
const source=(id="440")=>`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/capsule_231x87.jpg?t=1`;
const directories:string[]=[];
function directory(){const path=mkdtempSync(join(tmpdir(),"appgap-image-test-"));directories.push(path);return path;}
afterEach(()=>{
  vi.unstubAllGlobals();
  for(const path of directories.splice(0)){
    if(!resolve(path).startsWith(resolve(tmpdir())+sep+"appgap-image-test-"))throw Error("unsafe temporary path");
    rmSync(path,{recursive:true});
  }
});
it("restricts image requests to the matching game's Steam CDN asset",async()=>{
  expect(imageSource("440",source())).toBe(source());
  const upstream=vi.fn();vi.stubGlobal("fetch",upstream);
  const cache=new SteamImageCache(directory());
  for(const url of [source("730"),source().replace("https:","http:"),source().replace("shared.fastly.steamstatic.com","127.0.0.1"),source().replace(".com/",".com.evil.test/"),source().replace("https://","https://user:secret@"),source()+"#fragment",source().replace("capsule_231x87.jpg","../../730/capsule.jpg"),"file:///etc/passwd"]){
    expect(await cache.get("440",url)).toBeNull();
  }
  expect(await cache.get("../440",source())).toBeNull();
  expect(upstream).not.toHaveBeenCalled();
});
it("merges concurrent downloads, survives restart, and versions image URLs",async()=>{
  const path=directory(),upstream=vi.fn(async()=>new Response(png));vi.stubGlobal("fetch",upstream);
  const cache=new SteamImageCache(path);
  const results=await Promise.all(Array.from({length:8},()=>cache.get("440",source())));
  expect(results.every(result=>result?.bytes.equals(png))).toBe(true);expect(upstream).toHaveBeenCalledTimes(1);
  expect(upstream.mock.calls[0]).toBeDefined();
  expect(await new SteamImageCache(path).get("440",source())).toMatchObject({state:"HIT",mime:"image/png",etag:results[0]!.etag});
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(await cache.get("440",source().replace("t=1","t=2"))).toMatchObject({state:"MISS"});
  expect(upstream).toHaveBeenCalledTimes(2);
});
it("rejects invalid and oversized images and backs off repeated failures",async()=>{
  const upstream=vi.fn().mockResolvedValueOnce(new Response("<html>not an image</html>"))
    .mockResolvedValueOnce(new Response(Buffer.alloc(256*1024+1)))
    .mockResolvedValueOnce(new Response(png,{headers:{"content-length":String(256*1024+1)}}));
  vi.stubGlobal("fetch",upstream);const path=directory(),cache=new SteamImageCache(path);
  for(const id of ["1","2","3"]){expect(await cache.get(id,source(id))).toBeNull();expect(await cache.get(id,source(id))).toBeNull();}
  expect(upstream).toHaveBeenCalledTimes(3);expect(readdirSync(path)).toEqual([]);
});
it("evicts the oldest file before exceeding its disk budget",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(png)));
  const path=directory(),cache=new SteamImageCache(path,png.length*2);
  await cache.get("1",source("1"));const old=join(path,readdirSync(path)[0]);utimesSync(old,new Date(),new Date(Date.now()-1000));
  await cache.get("2",source("2"));await cache.get("3",source("3"));
  expect(readdirSync(path)).toHaveLength(2);expect(readdirSync(path).some(file=>file.startsWith("1-"))).toBe(false);
});
it("serves stale images during a failed refresh without retrying each visit",async()=>{
  const upstream=vi.fn().mockResolvedValueOnce(new Response(png)).mockRejectedValueOnce(Error("CDN unavailable"));vi.stubGlobal("fetch",upstream);
  const path=directory(),cache=new SteamImageCache(path);await cache.get("440",source());
  const old=join(path,readdirSync(path)[0]);utimesSync(old,new Date(),new Date(Date.now()-8*86400000));
  expect(await cache.get("440",source())).toMatchObject({state:"STALE",bytes:png});
  await vi.waitFor(()=>expect(upstream).toHaveBeenCalledTimes(2));
  expect(await cache.get("440",source())).toMatchObject({state:"STALE"});expect(upstream).toHaveBeenCalledTimes(2);
});
it("limits parallel CDN requests to two",async()=>{
  let active=0,maximum=0;
  vi.stubGlobal("fetch",vi.fn(async()=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return new Response(png);}));
  const cache=new SteamImageCache(directory());
  expect((await Promise.all(Array.from({length:6},(_,i)=>cache.get(String(i),source(String(i)))))).every(Boolean)).toBe(true);
  expect(maximum).toBe(2);
});
