import type { SessionDetail } from "../../details";
import { localTime } from "../model";
export function SessionTiming({detail,updated,loading}:{detail?:SessionDetail;updated:string;loading:boolean}) {
  return <section aria-label="Session timing" className="my-5 border-y border-line py-4">
    <dl className="grid gap-4 sm:grid-cols-3">
      <div><dt className="text-xs text-muted">Start</dt><dd id="detail-start" className="mt-1 text-sm">{localTime(detail?.startedAt,loading?"Reading…":"Not found in first 64 KiB")}</dd></div>
      <div><dt className="text-xs text-muted">End</dt><dd id="detail-end" className="mt-1 text-sm">{localTime(detail?.endedAt,loading?"Reading…":"Not recorded in this tail")}</dd></div>
      <div><dt className="text-xs text-muted">File touched</dt><dd id="detail-updated" className="mt-1 text-sm">{localTime(detail?.lastUpdatedAt||updated)}</dd></div>
    </dl>
    <p className="mt-3 text-xs text-muted">Last recorded event: <time id="detail-last-event" dateTime={detail?.lastEventAt??undefined}>{localTime(detail?.lastEventAt)}</time></p>
    <p className="mt-3 text-[11px] leading-relaxed text-muted">Start: first timestamp in the head. End: explicit session-end only, if visible. File touched: filesystem timestamp; may be an hourly heartbeat, not a message. Local time.</p>
  </section>;
}
