import { useState } from "react";

export function SteamImage({appId,name,image}:{appId:string;name:string;image?:string}){
  const [failed,setFailed]=useState<string>();
  return <span className="steam-game-thumb" aria-hidden="true">{image&&failed!==image
    ? <img src={`/api/steam/image/${appId}?v=${encodeURIComponent(image)}`} alt="" width={96} height={36} loading="lazy" decoding="async" onError={()=>setFailed(image)}/>
    : <span>{Array.from(name)[0]||"?"}</span>}</span>;
}
