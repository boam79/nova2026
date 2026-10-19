"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("비밀번호가 틀렸습니다.");
      return;
    }
    window.location.href = "/";
  }

  return (
    <main>
      <h1>NOVA 웹 실행기</h1>
      <p className="hint">접속 비밀번호가 필요합니다. 대회 개발 키는 넣지 마세요.</p>
      <form className="card" onSubmit={onSubmit}>
        <label htmlFor="pw">비밀번호</label>
        <input
          id="pw"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="bad">{error}</p> : null}
        <p>
          <button type="submit" disabled={busy || !password}>
            들어가기
          </button>
        </p>
      </form>
    </main>
  );
}
