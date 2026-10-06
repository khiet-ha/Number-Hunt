import { useState } from "preact/hooks";
import type { AppController } from "../app/controller";
import { QrCode } from "./QrCode";
import { Scanner } from "./Scanner";

/** Two-way QR: show our offer, then scan (or paste) the player's answer. */
export function InvitePanel({ c, title }: { c: AppController; title: string }) {
  const inv = c.state.invite;
  const [scanning, setScanning] = useState(false);
  const [paste, setPaste] = useState("");
  const [copied, setCopied] = useState(false);
  if (!inv) return <p class="muted">{c.state.busy ? "Đang tạo mã mời…" : ""}</p>;

  const submit = async (text: string) => {
    setScanning(false);
    if (await c.submitAnswer(text)) setPaste("");
  };

  return (
    <section class="card invite">
      <h3>{title}</h3>
      <ol class="steps">
        <li>Người chơi quét mã này bằng camera điện thoại.</li>
        <li>Họ sẽ thấy một mã trả lời — bấm “Quét mã trả lời” để quét.</li>
      </ol>
      <QrCode text={inv.url} label="Mã mời" />
      <div class="row">
        <button
          class="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(inv.url).then(() => setCopied(true));
          }}
        >
          {copied ? "Đã sao chép" : "Sao chép link mời"}
        </button>
        <button onClick={() => setScanning(true)}>Quét mã trả lời</button>
      </div>
      {scanning && <Scanner onResult={(t) => void submit(t)} onClose={() => setScanning(false)} />}
      <details>
        <summary>Dán mã trả lời bằng tay</summary>
        <textarea data-testid="answer-input" rows={3} value={paste} onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)} placeholder="NH2:…" />
        <button data-testid="answer-submit" disabled={!paste.trim()} onClick={() => void submit(paste)}>
          Xác nhận
        </button>
      </details>
      <input type="hidden" data-testid="invite-url" value={inv.url} />
    </section>
  );
}
