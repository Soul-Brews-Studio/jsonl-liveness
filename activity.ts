import { readSessionDetail } from "./details";

export interface MessageSummary {
  text:string; role:string|null; timestamp:string|null; truncated:boolean;
  lastEventAt:string|null; unavailable?:boolean;
}
/** Bounded message evidence cached by stat revision; never hashes or reads a head. */
export class ActivityCache {
  private entries=new Map<string,{revision:string;value:MessageSummary}>();
  reads=0;
  constructor(private root:string) {}
  async read(path:string,revision:string):Promise<MessageSummary> {
    const cached=this.entries.get(path);
    if(cached?.revision===revision)return cached.value;
    this.reads++;
    try {
      const detail=await readSessionDetail(this.root,path,64*1024,false);
      const message=detail.events.findLast(event=>event.kind==="message" && ["user","assistant"].includes(event.role));
      const value:MessageSummary={text:message?.text.slice(0,240)??"",role:message?.role??null,timestamp:message?.timestamp??null,
        truncated:!!message&&(message.truncated||message.text.length>240),lastEventAt:detail.lastEventAt};
      this.entries.set(path,{revision,value});return value;
    }catch {
      // Cache failures for this revision too: don't hammer unreadable files every tick.
      const value:MessageSummary={text:"",role:null,timestamp:null,truncated:false,lastEventAt:null,unavailable:true};
      this.entries.set(path,{revision,value});return value;
    }
  }
  prune(paths:Set<string>) {for(const path of this.entries.keys())if(!paths.has(path))this.entries.delete(path);}
}
