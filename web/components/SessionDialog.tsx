import { useEffect, useRef, type ReactNode } from "react";
/** Native modal supplies focus trapping and an inert background. */
export function SessionDialog({children,onClose,sessionPath}:{children:ReactNode;onClose:()=>void;sessionPath:string}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const element=dialog.current!,previous=document.activeElement as HTMLElement|null;
    const overflow=document.documentElement.style.overflow;
    document.documentElement.style.overflow="hidden";element.showModal();
    return()=>{
      element.close();document.documentElement.style.overflow=overflow;
      if(previous?.isConnected&&previous!==document.body&&previous.tabIndex>=0)previous.focus({preventScroll:true});
      else {
        const session=Array.from(document.querySelectorAll<HTMLButtonElement>('[data-session-path]')).find(button=>button.dataset.sessionPath===sessionPath);
        (session??document.querySelector<HTMLButtonElement>("#view-live"))?.focus({preventScroll:true});
      }
    };
  },[sessionPath]);
  return <dialog id="live-dialog" ref={dialog} aria-labelledby="live-dialog-title" className="fixed inset-0 m-auto max-h-[92vh] w-[min(1100px,calc(100vw-32px))] overflow-hidden rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/65" onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{
    if(event.target===dialog.current){const box=dialog.current.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)onClose();}
  }}>
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-4"><div className="flex flex-wrap items-center gap-3"><button id="dialog-home" className="border-0 bg-transparent p-0 font-semibold" onClick={onClose}>JSONL Liveness</button><h2 id="live-dialog-title" className="text-sm text-muted">Live session</h2></div><div className="flex gap-2"><button id="back-sessions" onClick={onClose}>Back to sessions</button><button id="close-live" aria-label="Close live session" autoFocus onClick={onClose}>Close</button></div></header>
    <div id="live-scroll" className="max-h-[calc(92vh-76px)] overflow-y-auto overscroll-contain p-5 md:p-7">{children}</div>
  </dialog>;
}
