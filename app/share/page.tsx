export const metadata = {
  title: "NOVA 대화록",
  robots: { index: false, follow: false },
};

export default function ShareIndexPage() {
  return (
    <main>
      <h1>NOVA 대화록</h1>
      <p className="hint">실행이 끝나면 결과 화면에 대화록 링크가 생깁니다. 그 주소를 외부 AI에 주세요.</p>
    </main>
  );
}
