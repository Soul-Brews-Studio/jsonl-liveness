import { createHash } from "node:crypto";
import { openSessionFile } from "./details";
import { statRevision } from "./liveness";
export interface Fingerprint {path:string;algorithm:"sha256";hash:string;revision:string;mtimeMs:number;size:number;hashedAt:string;cached:boolean}
/** Never called by the poller. Time+size is the cheap gate; full hashing is explicit. */
export class FingerprintCache {
  private values=new Map<string,{revision:string;value:Fingerprint}>();
  private pending=new Map<string,Promise<Fingerprint>>();
  read(root:string,path:string,force=false):Promise<Fingerprint> {
    const pendingKey=`${path}:${force}`;
    const inFlight=this.pending.get(pendingKey);if(inFlight)return inFlight;
    const task=this.compute(root,path,force).finally(()=>this.pending.delete(pendingKey));
    this.pending.set(pendingKey,task);return task;
  }
  private async compute(root:string,path:string,force:boolean):Promise<Fingerprint> {
    const file=await openSessionFile(root,path);
    try {
      const before=await file.stat();if(!before.isFile())throw new Error("Session is not a regular file");
      const key=statRevision(before),cached=this.values.get(path);
      if(!force&&cached?.revision===key)return {...cached.value,cached:true};
      const hash=createHash("sha256"),buffer=Buffer.alloc(Math.min(1024*1024,before.size));
      let position=0;
      while(position<before.size) {
        const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,before.size-position),position);
        if(!bytesRead)throw new Error("File changed while hashing; retry when writing settles");
        hash.update(buffer.subarray(0,bytesRead));position+=bytesRead;
      }
      if(statRevision(await file.stat())!==key)throw new Error("File changed while hashing; retry when writing settles");
      const value:Fingerprint={path,algorithm:"sha256",hash:hash.digest("hex"),revision:key,mtimeMs:before.mtimeMs,size:before.size,hashedAt:new Date().toISOString(),cached:false};
      if(this.values.size>=200)this.values.delete(this.values.keys().next().value!);
      this.values.set(path,{revision:key,value});return value;
    }finally{await file.close();}
  }
}
