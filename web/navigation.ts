export function workspaceURL(current:string,view:"table"|"timeline"):string {
  const url=new URL(current);
  for(const key of ["view","session","path"])url.searchParams.delete(key);
  if(view==="timeline")url.searchParams.set("view",view);
  return url.href;
}

/** This local shortcut never accepts credentials or arbitrary redirect origins. */
export function claudeReturnURL(current:string):string {
  const fallback="http://127.0.0.1:4318/#/sessions";
  try{
    const value=new URL(current).searchParams.get("returnTo");
    if(!value)return fallback;
    const url=new URL(value);
    if(!["http://127.0.0.1:4318","http://localhost:4318"].includes(url.origin)||url.username||url.password)return fallback;
    if(!/^#\/(sessions(?:\/[^/?#]+)?|chats\/[^/?#]+|new)(?:\?.*)?$/.test(url.hash))return fallback;
    return url.origin+"/"+url.hash;
  }catch{return fallback;}
}
