import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NOVA 웹 실행기",
  description: "공개 샘플 증례로 제출 ZIP을 브라우저에서 돌립니다.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
