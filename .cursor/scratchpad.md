# NOVA 웹 실행기 — Scratchpad

## Background and Motivation

로컬 샘플 실행기(`.command`)가 맥에서 실행 권한 문제로 열리지 않아, 브라우저만으로 후보 ZIP을 돌리는 Vercel 웹 앱이 필요하다. PRD: 사용자 다운로드의 `NOVA_web_runner_PRD.md` (2026-10-18).

결정된 기본값:
- 사용자: 혼자 사용. 팀 인증은 2차.
- 저장소: 코드는 로컬 `nova-web-runner` + Vercel만. GitHub 비공개 원격은 만들지 않음(사용자 확인). nova2026에는 웹 실행기·샘플·키를 넣지 않음.
- NOVA GitHub 기준: https://github.com/boam79/nova2026 (현재 빈 저장소. 하네스 코드는 아직 여기 없음).
- 스택: Next.js(TypeScript) + 기존 `nova_local_runner.py` + Vercel Sandbox + Blob.
- Supabase 없음. 키는 서버에 저장하지 않음.

## Key Challenges and Analysis

- Vercel Functions 시간 한도로는 약 40턴 진료가 끊길 수 있음 → **실행은 Sandbox** (Hobby 세션 최대 45분).
- 제출 `run.py`는 신뢰하지 않는 코드 → 격리 VM + 네트워크 제한.
- 재연 모드: 네트워크 불필요 (`deny-all`).
- 실제 모델 모드: egress를 `api.openai.com`만 허용.
- `bank/`와 대화록은 git에 넣지 않음.
- GitHub CLI 미로그인 상태. M0은 Vercel 프로젝트만으로 스파이크 가능.

## High-level Task Breakdown

1. **M0 스파이크** (완료, 사람 확인됨)
   - 성공 기준: Vercel Sandbox에서 공개 샘플 1증례(C01) 재연이 끝까지 끝나 대화록 JSON이 나온다. 네트워크 정책으로 대회 도메인은 막히고 `api.openai.com`은 허용된다.
2. **M1 MVP** (완료)
   - K1–K5, F1–F3, R1–R3, L1–L3. 실행 화면, 결과 저장. 배포 HTTPS에서 스모크.
   - 접속 비밀번호 관문은 사용자 요청으로 제거했다가, 다시 복구함 (2026-10-18). 주소만 열면 `/login`, 통과하면 실행 화면.
   - GitHub 비공개 원격·gh auth는 하지 않음. 코드는 nova-web-runner 로컬/Vercel만.
   - ZIP 끌어놓기: 배포 URL에서 검증 통과 (2026-10-18).
3. **M2 마감** (10-20)
   - L2 기록 목록/삭제, F4·L4 보관, 보안 시험. 동결 전 v9.5 검증에 쓸 수 있어야 함.

## Project Status Board

- [x] M0: Sandbox에서 C01 재연 1회가 끝까지 완료되고 대화록이 생긴다 (사람 확인 대기)
- [x] M0: 네트워크 정책이 대회 도메인을 막고 api.openai.com만 연다 (사람 확인 대기)
- [x] M1: 키 입력·ZIP 첨부·실행·대화록 저장 (배포 URL에서 확인, 끌어놓기 포함)
- [ ] M2: 기록 목록·삭제·보관 정책·보안 시험

## Executor's Feedback or Assistance Requests

- 모드: Executor. 사용자 확인: M1만 진행. GitHub 원격 생성하지 않음(비공개로 만들 필요 없음).
- M1 완료. ZIP 끌어놓기는 배포 HTTPS에서 검증 통과. M2는 시작하지 않음.
- 샘플 bank와 제출 ZIP은 로컬 경로에서만 읽고 git에 복사하지 않음.
- 프로덕션: https://nova-web-runner.vercel.app (Hobby, SSO 끔. 접속 비밀번호 관문 복구됨).
- 스모크(재연 C01): ZIP 검증 → Sandbox 실행 49턴 → summary.json·결과 ZIP·대화록 저장. 키 문자열 없음. 소요 약 25초.
- ZIP 끌어놓기(후속): 배포 URL `.drop`에 제출 ZIP 드롭 → **검증 통과**. 파일 선택 CDP(`DOM.setFileInputFiles`)는 차단되어 DataTransfer 드롭 이벤트로 우회.
- 접속 비밀번호 관문 삭제(2026-10-18, 이후 철회): middleware·로그인 화면·login/logout API 제거. 배포 HTTPS에서 `/`가 비밀번호 없이 실행 화면. `/login`은 404. `/api/runs`는 쿠키 없이 200.
- 접속 비밀번호 관문 복구(2026-10-18): middleware·`/login`·`/api/login`·`/api/logout`·나가기 복구. 기존 Vercel/.env.local `APP_PASSWORD`·`AUTH_SECRET`을 그대로 씀(값 일치, 새로 만들지 않음). 코드/git에 비밀번호를 넣지 않음. 배포 `dpl_4rSJGxSLPe8KTQ9EQe8J1ZUWgwHH`. HTTPS에서 `/`→307 `/login`, `/api/runs` 쿠키 없이 401, 틀린 비밀번호는 로그인에 남고, 맞는 비밀번호로 실행 화면(키 한 칸·모델 드롭다운 유지). 비밀번호는 채팅에서 사용자에게 한 번 안내.
- OpenAI 키 한 칸 + 모델 드롭다운(2026-10-18): 닥터/환자 키 두 칸과 ‘같은 키 사용’ 체크 제거. 키는 공유, 닥터/환자 모델은 독립 select. 선택지는 실행기에 있던 ID만: `gpt-6-luna`, `gpt-6.1-sol`. `gpt-6-sol`은 실행기·기본값·화면에 없어서 넣지 않음. 프로덕션 `dpl_5nW6HDfaWFrs5nZzzX24cydxMAxz`. 배포 URL에서 비밀번호 입력 1개, 닥터=luna·환자=6.1-sol 동시 선택, 빈 키 연결 점검=재연 생략, `/runs` 정상. 사람 수동 확인 후 완료로 봐도 됨.
- 공식 평가 페이지 대조(2026-10-18): https://nova.snubhai.org/evaluation/ 는 로그인 없이 공개. 개발·제출 화면만 로그인. 웹 실행기는 공식 6영역 채점이 아니라 로컬 재연기이며, 결과 ZIP 내부(transcripts/*.json, meta.json, summary.md)는 nova_local_runner와 같아 score_transcript에 쓸 수 있음. 형식 불일치 버그로 코드를 고치지는 않음. SHA·총점은 웹 실행기에 복사하지 않음.
- 키 넣어도 재연이던 버그(2026-10-18): 모드 기본이 재연이라 키가 있어도 `--offline`·키 미전달·sleep 패치. 연결 점검만 API. 공식 샘플 150–190초/증례, 리더보드 206–229초/증례, 웹 재연은 수십 초. 수정: 키가 있으면 무조건 실제 모델. 배포 `dpl_3v2sdgrdWo5TCG73sqyToR8NmUpr`. 긴 실제 진료는 돌리지 않음. 기본 모델은 둘 다 luna(환자 sol은 공식 근사 옵션, 공식 환자는 숨김).

### M0 결과

- 재연: Sandbox `deny-all`, C01 49턴, 종료 코드 0, 대화록·결과 ZIP 생성. 로컬 재연과 같은 요약(문진 31, 중복 0).
- 방화벽: `api.openai.com` → HTTP 401(키 없이 도달). `nova.snubhai.org` → DNS 실패로 차단.
- 소요: Sandbox 두 세션 합약 7초. Functions 시간 한도는 재연 병목이 아님. 실행 환경은 Sandbox로 확정.

## Lessons

- 제출 ZIP에는 `run.py`와 `nova_sdk.py`가 둘 다 있어야 로컬 실행기가 받는다.
- 대회 실행기(`nova_runner`)와 로컬 실행기(`nova_local_runner`)를 섞지 않는다. 웹 실행기는 로컬 실행기를 쓴다.
- 개발 키·대회 도메인(`snubhai`)은 이 도구에 넣지 않는다.
- Vercel Sandbox 기본 이미지에 Python 3가 있고, 재연 모드는 네트워크 없이 한 진료가 끝난다.
- 로컬 Sandbox SDK는 `vercel link` + `vercel env pull`(OIDC) 또는 CLI `auth.json` 토큰이 필요하다. 토큰을 로그에 찍지 말 것.
- `@vercel/sandbox@1.10.2`는 `Sandbox.create`에 `name`/`persistent`가 없고, `Sandbox.get({ sandboxId })`만 된다. 반환값의 `sandbox.sandboxId`를 저장한다.
- 실제 제출 ZIP의 `nova_sdk.py` 주석에 `snubhai`가 있다. ZIP 검증은 `#` 주석 줄의 외부 주소 문자열은 건너뛰고, 코드 속 URL·문자열만 막는다.
- Cursor 브라우저 CDP는 `DOM.setFileInputFiles`를 막는다. 배포 페이지 끌어놓기 검증은 `DataTransfer` + `DragEvent('drop')`로 한다. 채팅에 키를 찍지 말 것.
- 모델 목록은 실행기 기본값·기존 화면 ID만. 기본은 닥터·환자 모두 `gpt-6-luna`. `gpt-6.1-sol`은 로컬 실행기의 ‘공식 평가처럼’ 환자 근사. 공식 환자 모델은 숨김. 공식 채점 모델 `gpt-6.1-sol`과 환자를 섞지 말 것. `gpt-6-sol`은 코드에 없음.
- 키가 있는데 증례당 수십 초면 재연이다. 실제 모델은 공식 샘플 약 150–190초, 리더보드 약 200–230초. 연결 점검만 API이고 실행은 `--offline`이면 안 된다.
- 동시 실행은 PRD R3대로 전역 1건(`lock.json`, 45분). 끝난 뒤 다시 실행은 된다. `MAX_CONCURRENT_RUNS` 상수는 선언만 있고 락 로직은 파일 1개로 고정.
- 동시 3건으로 변경(2026-10-18, 사용자 확인): `MAX_CONCURRENT_RUNS=3`. 4번째는 409. 중지·진행·결과는 run id·sandboxId로 분리. 배포 `dpl_3B4D7TbxQzjdZQ1k76HPyxup5SP3`. HTTPS 재연 2건 동시 시작(서로 다른 id, inFlight=2), 각각 중지 후 inFlight=0. 긴 OpenAI 진료는 안 돌림. Blob 락은 재시도로 덮어쓰기 경쟁을 줄임.
- Blob 정지(2026-10-18 밤): 스토어 `nova-web-runner-blob` (`store_oAEZw8dMCCbKM7q8`) `billingState=suspended`, `usageQuotaExceeded=true`, `status=limits-exceeded-suspended`. 용량 4MB(한도 1GB 아님). Hobby Advanced Operations(list+upload) 월 2,000. 진행 폴링 1.2초마다 `list(runs/)`+`put(progress.jsonl)`. 200초 증례 ≈ list 167 + upload 167 ≈ 334회, 약 5–6회면 한도. 3증례 약 600초면 약 2회. 코드만 고치면 이번 달 정지는 안 풀림. Pro 결제 안 함.
- 로그인 입력은 React state를 써야 한다. 브라우저 자동화는 `fill`만으로 부족할 수 있어 글자 단위 입력이 안전하다. 채팅에 OpenAI 키는 찍지 말 것. 접속 비밀번호는 사용자가 알려 달라고 한 경우에만 안내.
- Next 의존 postcss 취약은 `npm audit fix --force`(Next 16)로 올리지 않는다.
- Hobby Blob Advanced(list·upload)는 월 2,000. 진행 조회에서 `listPrefix("runs/")`를 1.2초마다 치면 금방 찬다. loadMeta는 경로로 get 하고, 진행은 Blob에 매 틱 put 하지 말 것.
