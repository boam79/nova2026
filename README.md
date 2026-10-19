# NOVA 웹 실행기

설치 없이 브라우저에서 제출 ZIP을 공개 샘플 증례로 돌려 보는 도구입니다. 대회 서버와 개발 키는 쓰지 않습니다.

**점수가 아니라 대화록에서 센 값입니다.** 공식 점수로 쓰지 마세요.

## 범위

- 1차: 혼자 쓰는 접속 비밀번호 관문, 재연/실제 모델 실행, 대화록 저장
- 비목표: 공식 제출 대행, 비공개 증례, 팀 계정(2차)

## 보안

- OpenAI 키는 서버에 저장하지 않습니다.
- 샘플 대화록(`bank/`)과 실행 결과(`runs/`)는 git에 넣지 않습니다.
- 호출 주소는 `api.openai.com`만 허용합니다.

## M0 스파이크

Vercel Sandbox에서 기존 `nova_local_runner.py`가 한 진료를 끝까지 도는지 확인합니다.

```bash
npm install
npx vercel link
npx vercel env pull .env.local
BANK_C01=/path/to/C01.json SUBMISSION_ZIP=/path/to/submission.zip npm run m0
```
