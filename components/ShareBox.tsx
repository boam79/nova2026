"use client";

import { useEffect, useState } from "react";
import { sharePath, shareRawPath } from "../lib/share";

export function ShareBox({ id }: { id: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const raw = `${origin || ""}${shareRawPath(id)}`;

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied("");
    }
  }

  return (
    <section className="card" aria-label="대화록 공유">
      <h2>외부 AI에 줄 링크</h2>
      <p className="hint">
        로그인 없이 대화록만 열립니다. ZIP·키·기록 목록은 안 나갑니다. 이 주소만 알면 누구나 읽을 수 있습니다.
      </p>
      <label htmlFor="share-raw">텍스트 (AI에 이 주소를 주세요)</label>
      <div className="row">
        <input id="share-raw" readOnly value={raw} />
        <button type="button" className="secondary" onClick={() => copy("raw", raw)} disabled={!origin}>
          {copied === "raw" ? "복사됨" : "복사"}
        </button>
      </div>
      <p>
        <a href={sharePath(id)}>대화록 보기</a>
        {" · "}
        <a href={shareRawPath(id)}>원문</a>
      </p>
    </section>
  );
}
