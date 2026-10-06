import { useEffect, useState } from "preact/hooks";
import type { AppController } from "@/app/controller";
import { loadName } from "@/app/identity";
import { Debug } from "./Debug";
import { Game } from "./Game";
import { Lobby } from "./Lobby";
import { QrCode } from "./QrCode";
import { Scanner } from "./Scanner";
import { useController } from "./hooks";
import { CLOSE_TEXT } from "./text";

function Home({ c }: { c: AppController }) {
  const [name, setName] = useState(loadName());
  const [scan, setScan] = useState(false);
  const [paste, setPaste] = useState("");
  const resume = c.resumable();
  const valid = name.trim().length > 0;
  return (
    <div class="home">
      <h1>Tìm Số</h1>
      <p class="muted">Chơi cùng nhau trên nhiều điện thoại, không cần máy chủ.</p>
      <label>
        Tên của bạn
        <input data-testid="name" maxLength={16} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Ví dụ: Lan" />
      </label>
      <button data-testid="create" disabled={!valid || c.state.busy} onClick={() => void c.createRoom(name)}>
        Tạo phòng
      </button>
      <button class="secondary" disabled={!valid} onClick={() => setScan(true)}>
        Quét mã mời
      </button>
      {scan && (
        <Scanner
          onResult={(t) => {
            setScan(false);
            void c.acceptOffer(t, name);
          }}
          onClose={() => setScan(false)}
        />
      )}
      <details>
        <summary>Dán link / mã mời</summary>
        <textarea data-testid="offer-input" rows={3} value={paste} onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)} />
        <button data-testid="offer-submit" disabled={!valid || !paste.trim()} onClick={() => void c.acceptOffer(paste, name)}>
          Tham gia
        </button>
      </details>
      {resume && (
        <section class="card">
          <p>
            Bạn đang có một trận dở trong phòng <b>{resume.roomId}</b>. Nhờ một người trong phòng mở “Mời người chơi bị rớt vào lại” rồi quét mã của họ.
          </p>
          <button class="secondary" onClick={() => setScan(true)}>
            Quét mã vào lại
          </button>
          <button class="link" onClick={() => c.forgetSession()}>
            Bỏ trận này
          </button>
        </section>
      )}
    </div>
  );
}

function Join({ c, offerText }: { c: AppController; offerText: string }) {
  const [name, setName] = useState(loadName());
  return (
    <div class="home">
      <h1>Tham gia phòng</h1>
      <label>
        Tên của bạn
        <input data-testid="name" maxLength={16} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <button data-testid="join" disabled={!name.trim() || c.state.busy} onClick={() => void c.acceptOffer(offerText, name)}>
        {c.state.busy ? "Đang chuẩn bị…" : "Tham gia"}
      </button>
      <button class="link" onClick={() => c.backHome()}>
        Huỷ
      </button>
    </div>
  );
}

function Answer({ c, answerText, rejoin }: { c: AppController; answerText: string; rejoin: boolean }) {
  return (
    <div class="home">
      <h2>{rejoin ? "Vào lại trận" : "Gần xong!"}</h2>
      <p>Đưa màn hình này cho {rejoin ? "người đã mời bạn" : "Host"} quét.</p>
      <QrCode text={answerText} label="Mã trả lời" />
      <button class="secondary" onClick={() => void navigator.clipboard?.writeText(answerText)}>
        Sao chép mã trả lời
      </button>
      <textarea readOnly data-testid="answer-text" rows={2} value={answerText} />
      <p class="muted">
        <span class="spinner small" /> Đang chờ kết nối…
      </p>
      <button class="link" onClick={() => c.backHome()}>
        Huỷ
      </button>
    </div>
  );
}

export function App({ c, debug }: { c: AppController; debug: boolean }) {
  useController(c);
  useEffect(() => {
    // Invite links carry the offer in the URL fragment (never sent to a server).
    const check = () => {
      if (/[#&]j=/.test(location.hash) && (c.state.screen.name === "home" || c.state.screen.name === "join")) {
        c.openJoin(location.href);
        history.replaceState(null, "", location.pathname + location.search);
      }
    };
    check();
    addEventListener("hashchange", check);
    return () => removeEventListener("hashchange", check);
  }, []);
  const s = c.state.screen;
  const v = c.node?.getView() ?? null;
  return (
    <main>
      {c.state.error && (
        <div class="banner error" onClick={() => c.clearError()}>
          {c.state.error} <span class="close">×</span>
        </div>
      )}
      {c.state.notice && !c.state.error && v?.status === "LOBBY" && (
        <div class="banner" onClick={() => c.clearError()}>
          {c.state.notice}
        </div>
      )}
      {s.name === "home" && <Home c={c} />}
      {s.name === "join" && <Join c={c} offerText={s.offerText} />}
      {s.name === "answer" && <Answer c={c} answerText={s.answerText} rejoin={s.rejoin} />}
      {s.name === "room" && v && v.status === "CLOSED" && (
        <section class="card">
          <p>{CLOSE_TEXT[v.closedReason ?? ""] ?? v.closedReason}</p>
          <button onClick={() => c.leave()}>Về trang chủ</button>
        </section>
      )}
      {s.name === "room" && v && v.status === "LOBBY" && <Lobby c={c} v={v} />}
      {s.name === "room" && v && v.status !== "LOBBY" && v.status !== "CLOSED" && <Game c={c} v={v} />}
      {debug && <Debug c={c} v={v} />}
    </main>
  );
}
