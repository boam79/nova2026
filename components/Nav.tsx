"use client";

export function Nav() {
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <nav>
      <a href="/">실행</a>
      <a href="/runs">기록</a>
      <button className="secondary" type="button" onClick={logout}>
        나가기
      </button>
    </nav>
  );
}

export function Disclaimer() {
  return (
    <div className="banner">
      점수가 아니라 대화록에서 센 값입니다. 공식 점수로 쓰지 마세요. 재연 모드는 프롬프트 변경을 반영하지 않습니다.
    </div>
  );
}
