#!/usr/bin/env python3
"""NOVA 2026 로컬 샘플 실행기 (개발 키·대회 서버 없이)

제출 ZIP(또는 에이전트 폴더)의 run.py를 고치지 않고 그대로 돌려 공개 샘플 증례 대화록을 만든다.
결과는 지금 실행기(nova_runner)와 같은 형식의 '결과 ZIP'으로 묶여 기존 분석·자동 수정에 그대로 쓴다.

모드 (역할마다 따로 정해진다)
- 오프라인(키 없음): 지금까지 서버 개발 세션에서 받은 실제 대화록(bank/)으로 돌린다.
    환자  : 같은 증례에서 실제 환자가 비슷한 질문에 한 답을 찾아 돌려준다(묶음 질문은 첫 항목만, 전부 아니면 한 번에 부정).
    진찰  : 실제 진찰 결과에서 가장 가까운 진찰을 찾는다. 없으면 '특이 소견 없음'.
    의사  : 실제 실행의 의사 모델 출력(계획 질문·진찰, 보강, 주진단, 기록과 설명, 답)을 재연한다.
            코드 흐름(턴 배분, 중복, 묶음 되묻기, 접두, 설명 걸러내기)은 시험되지만 프롬프트 변경은 반영되지 않는다.
- API 키 모드: OpenAI 호환 API로 의사 모델과 환자 모델을 부른다(예: 의사 gpt-6-luna, 환자 gpt-6-luna 또는 gpt-6.1-sol).
    키를 넣은 역할만 API를 쓰고, 넣지 않은 역할은 오프라인으로 돈다. 진찰은 언제나 오프라인 표에서 찾는다.

지키는 것
- 대회 개발 키·대회 서버를 쓰지 않는다. API 주소에 대회 도메인이 있으면 실행하지 않는다.
- 키는 입력(화면에 안 보임)·환경변수·키 파일로만 받고, 자식 프로세스 환경변수로만 넘긴다. 로그·결과 ZIP·설정 파일에 남기지 않는다.
- bank/와 runs/에는 공개 샘플 대화가 들어 있다. git과 공개 저장소에 넣지 않는다(_local/은 .gitignore 대상).
- 점수를 새로 만들지 않는다. 요약은 대화록에서 센 값(턴, 진단, 중복 질문, 환자 답 재현율)뿐이다.
  정답지와 팀 채점기(scripts/score_transcript.py)가 있으면 그 결과만 붙인다.
- 표준 라이브러리만 쓴다.

사용
  python3 nova_local_runner.py --zip submission-v9.5.zip                     # 오프라인, 3증례 1회
  python3 nova_local_runner.py --zip submission-v9.5.zip --reps 3            # 증례마다 3회(재연 출처를 바꿔 가며)
  python3 nova_local_runner.py --zip A.zip --zip B.zip --reps 2              # 두 판을 같은 조건으로
  python3 nova_local_runner.py --zip submission-v9.5.zip --ask-key           # 키 입력(엔터만 치면 그 역할은 오프라인)
  python3 nova_local_runner.py --zip ... --patient-model gpt-6.1-sol         # 공식 평가처럼 환자를 sol로
  python3 nova_local_runner.py --build-bank ~/Downloads/결과_*.zip           # 새 실행기 결과로 bank 보강
"""
import argparse
import collections
import datetime
import getpass
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path

VERSION = 'local-1.0'
HERE = Path(__file__).resolve().parent
BANK = HERE / 'bank'
RUNS = HERE / 'runs'
SETTINGS = HERE / 'settings.json'          # 주소·모델 이름만. 키는 넣지 않는다
DEFAULTS = {'base_url': 'https://api.openai.com/v1', 'doctor_model': 'gpt-6-luna', 'patient_model': 'gpt-6-luna',
            'patient_base_url': '', 'timeout': 240}
KEY_ENV = {'doctor': ('NOVA_LOCAL_DOCTOR_KEY', 'NOVA_LOCAL_API_KEY', 'OPENAI_API_KEY'),
           'patient': ('NOVA_LOCAL_PATIENT_KEY', 'NOVA_LOCAL_API_KEY', 'OPENAI_API_KEY')}
KEY_FILE = Path.home() / '.nova_openai_env'
BLOCKED = re.compile(r'snubhai|nova\.', re.I)   # 대회 서버(개발 키)는 이 도구에 쓰지 않는다
AGENT_FILES = ('run.py', 'nova_sdk.py', 'requirements.txt')
TURN_LIMIT, MAX_CHARS, CALL_LIMIT = 50, 30, 200
ACK = '네, 알겠어요.'
NEG_ALL = '아니요, 그런 건 없어요.'
NO_FINDING = '특이 소견 없음'


# ---------------------------------------------------------------- 글자 다루기
def nfc(s):
    return unicodedata.normalize('NFC', str(s or ''))


def core(text):
    """앞의 공감·되짚기·인사 문장을 떼고 마지막 질문만('그러셨군요. 술은 얼마나 드시나요?' → '술은 얼마나 드시나요?')."""
    t = nfc(text).strip()
    if t.endswith('?'):
        parts = [x for x in re.split(r'(?<=[.!])\s+', t) if x.strip()]
        if len(parts) > 1:
            t = parts[-1].strip()
    return t


def _chars(t):
    return re.sub(r'[^가-힣A-Za-z0-9]', '', nfc(t))


def _bigrams(t):
    s = _chars(t)
    return {s[i:i + 2] for i in range(len(s) - 1)} or ({s} if s else set())


STOP2 = {'있나', '없나', '있으', '하시', '드시', '어떤', '혹시', '지금', '요즘', '그런', '적이', '적은', '많이', '자주', '평소', '하나',
         '있어', '없어', '있었', '없었', '같은', '정도', '어떻', '무슨', '어떠', '셨나', '셨어', '시나', '나요'}


def _words(t):
    out = set()
    for w in re.findall(r'[가-힣A-Za-z0-9]{2,}', nfc(t)):
        k = w[:2]
        if k not in STOP2:
            out.add(k)
    return out


def sim(a, b):
    """0~1. 글자 두 개씩 겹침(자카드)과 낱말 앞 두 글자 겹침(다이스)의 평균."""
    ba, bb = _bigrams(a), _bigrams(b)
    j = len(ba & bb) / len(ba | bb) if ba and bb else 0.0
    wa, wb = _words(a), _words(b)
    d = 2 * len(wa & wb) / (len(wa) + len(wb)) if wa and wb else 0.0
    return 0.5 * j + 0.5 * d


NEG = re.compile(r'^\s*(아니|아뇨|없|전혀|안\s)|없어요|없었|없습니다|않아요|않았|않습니다|안\s*(해|피|마셔|먹)|모르겠')


def negative(ans):
    return bool(NEG.search(nfc(ans)[:24]))


ITEM_SPLIT = re.compile(r'\s*(?:,|·|/|이나\s|거나\s|(?<=[가-힣])나\s|(?<=[가-힣])과\s|(?<=[가-힣])와\s|또는\s)\s*')


def items_of(q):
    """'A나 B, C가 있나요?' → ['A', 'B', 'C']. 항목이 하나면 []."""
    body = re.sub(r'\s*(이|가|은|는|을|를)?\s*(있|없|생기|나|하)\S*\?$', '', core(q)).strip()
    parts = [x.strip() for x in ITEM_SPLIT.split(body) if x and x.strip()]
    return parts if 2 <= len(parts) <= 5 and all(len(x) <= 14 for x in parts) else []


def _josa(word, with_b, without_b):
    ch = (word or ' ')[-1]
    return with_b if '가' <= ch <= '힣' and (ord(ch) - 0xAC00) % 28 else without_b


# ---------------------------------------------------------------- bank 만들기 (실제 대화록 → 증례별 자료)
def iter_transcripts(paths):
    """폴더·ZIP·JSON에서 대화록(JSON, 'turns' 있음)을 꺼낸다. (출처 이름, dict)"""
    for p in paths:
        p = Path(p).expanduser()
        if p.is_dir():
            for f in sorted(p.rglob('*.json')):
                yield from iter_transcripts([f])
            for f in sorted(p.rglob('*.zip')):
                yield from iter_transcripts([f])
        elif p.suffix == '.zip':
            try:
                with zipfile.ZipFile(p) as z:
                    for n in z.namelist():
                        if n.endswith('.json') and '/transcripts/' in '/' + n:
                            try:
                                d = json.loads(z.read(n).decode('utf-8'))
                            except Exception:
                                continue
                            if isinstance(d, dict) and isinstance(d.get('turns'), list):
                                yield f'{p.name}:{n}', d
            except zipfile.BadZipFile:
                continue
        elif p.suffix == '.json':
            try:
                d = json.loads(p.read_text(encoding='utf-8'))
            except Exception:
                continue
            if isinstance(d, dict) and isinstance(d.get('turns'), list):
                yield str(p), d


CODE_Q = [re.compile(x) for x in (
    r'^(다른 불편한 점도|그 밖에)', r'^안녕하세요', r'^이제 진찰', r'^가슴이 두근거리신 적 있나요\?$', r'^열은 언제부터 났나요\?$',
    r'^어지럽거나 쓰러질 것 같나요\?$', r'^숨이 많이 차신가요\?$', r'^죽고 싶은 생각', r'한꺼번에 많이', r'^가슴이 조이며 식은땀',
    r'^숨이 차서 말하기', r'^갑자기 가장 심하게', r'^팔다리에 힘이 빠지나요', r'^피를 토하거나', r'^밤에 땀을 흠뻑', r'^숨쉬기 힘들거나',
    r'^아이가 처지거나 잘 못 먹나요', r'^담배를 피우시나요\?$', r'^술은 얼마나 드시나요\?$', r'^약 알레르기가 있나요\?$',
    r'^수술 받으신 적', r'^입원하신 적', r'^기절하신 적', r'^지금 드시는 약이 있나요\?$', r'^고혈압이나 당뇨', r'^예전에 앓은 병',
    r'^가족 중 앓는 병', r'^어떤 일을 하시나요\?$', r'^(가장 걱정되시는|어떤 점이 가장 걱정)', r'^(당뇨나 다른 지병도|고혈압도 있나요|고혈압이나 당뇨도)',
    r'^그 가족분은', r'^몇 알', r'^처음보다 양이', r'^줄이거나 끊으면', r'^약은 어디서 처방', r'^언제부터 드셨', r'^하루에 몇 번 드시',
)]


def code_question(q, prev):
    """실행기 자료로 계획을 재연할 때, 계획이 아니라 코드가 넣은 질문(기본 문진, 위험 징후, 되묻기)은 뺀다."""
    if any(p.search(q) for p in CODE_Q):
        return True
    if prev and items_of(prev):
        if nfc(prev).endswith(q) and q != nfc(prev):
            return True   # 묶음의 남은 부분 되묻기
        if len(q) <= 16 and any(x and x[:2] in q for x in items_of(prev)):
            return True   # 묶음의 항목 하나 되묻기
    return False


def _exam_name(t):
    return re.sub(r'\s*(하겠습니다|할게요|합니다)\.?$', '', nfc(t)).strip()


def replay_of(d):
    """대화록 하나 → 의사 모델 출력 재연 자료(계획, 보강, 주진단, 기록, 답)."""
    turns = [t for t in d['turns'] if t.get('response') is not None]
    rec = d.get('record_model')
    if not isinstance(rec, dict) or not turns:
        return None
    first_exam = next((i for i, t in enumerate(turns) if t.get('action') == 'EXAM'), len(turns))
    explain_at = next((i for i, t in enumerate(turns) if t.get('purpose') in ('explain', 'answer', 'empathy')), len(turns))
    plan_q, fu_q, plan_x, fu_x, prev = [], [], [], [], ''
    for i, t in enumerate(turns[:explain_at]):
        if t.get('action') == 'EXAM':
            (plan_x if not fu_q else fu_x).append(_exam_name(t.get('content')))
            continue
        if t.get('purpose') != 'history':
            continue
        q = core(t.get('base') or t.get('content'))
        if not q.endswith('?') or code_question(q, prev):
            prev = q
            continue
        (plan_q if i < first_exam else fu_q).append(q)
        prev = q
    ddx = [x for x in (d.get('ddx') or []) if isinstance(x, str)][:5] or [str(rec.get('diagnosis') or '미상')]
    cc = re.sub(r'^C\.C\s*:\s*', '', nfc((rec.get('S') or {}).get('cc', '')).split('\n')[0]).strip() or ddx[0]
    answers = []
    for i, t in enumerate(turns):
        if t.get('purpose') == 'answer' and i:
            answers.append({'q': nfc(turns[i - 1].get('response')), 'a': nfc(t.get('content'))})
    diagnosis = nfc((d.get('diagnose') or {}).get('diagnosis') or rec.get('diagnosis') or ddx[0])
    return {'candidate': d.get('candidate', ''), 'run_id': d.get('run_id', ''),
            'plan': {'chief_complaint': cc, 'ddx': ddx, 'greeting': '안녕하세요, 많이 걱정되셨죠?', 'questions': plan_q,
                     'exams': [{'name': x, 'for': ddx[0]} for x in plan_x]},
            'followup': {'ddx': ddx[:1], 'questions': fu_q, 'exams': [{'name': x, 'for': ddx[0]} for x in fu_x]},
            'dx': {'ddx': [{'dx': x, 'for': '진료 기록', 'against': '-'} for x in ddx], 'diagnosis': diagnosis},
            'record': rec, 'answers': answers}


def build_bank(paths, out=BANK, log=print):
    """실제 서버 대화록으로 증례별 bank를 만든다(기존 bank에 더함, 같은 대화록은 한 번만)."""
    out.mkdir(parents=True, exist_ok=True)
    banks = {}
    for f in sorted(out.glob('*.json')):
        try:
            b = json.loads(f.read_text(encoding='utf-8'))
            banks[b['case_id']] = b
        except Exception:
            pass
    added = collections.Counter()
    for name, d in iter_transcripts(paths):
        cid = str(d.get('case_id') or '')
        cand = str(d.get('candidate') or '')
        if not re.match(r'^C\d+$', cid) or 'oracle' in cand:
            continue   # 공개 샘플 증례(C01 같은 이름)의 실제 실행만. 페르소나·모범 대화는 넣지 않는다
        h = hashlib.sha256(json.dumps(d['turns'], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
        b = banks.setdefault(cid, {'case_id': cid, 'start_information': d.get('start_information') or {}, 'hashes': [],
                                   'qa': [], 'say': [], 'exams': [], 'replays': [], 'sources': []})
        if h in b['hashes']:
            continue
        b['hashes'].append(h)
        src = len(b['sources'])
        b['sources'].append({'name': name, 'candidate': cand, 'run_id': d.get('run_id', '')})
        for t in d['turns']:
            a = nfc(t.get('response'))
            if not a or t.get('status') not in (None, 'ok'):
                continue
            if t.get('action') == 'EXAM':
                b['exams'].append({'q': _exam_name(t.get('content')), 'a': a, 's': src})
                continue
            text = nfc(t.get('base') or t.get('content'))
            row = {'q': core(text) if text.endswith('?') else text, 'a': a, 'p': t.get('purpose') or '', 's': src}
            (b['qa'] if row['q'].endswith('?') else b['say']).append(row)
        r = replay_of(d)
        if r:
            r['s'] = src
            b['replays'].append(r)
        added[cid] += 1
    for cid, b in banks.items():
        (out / f'{cid}.json').write_text(json.dumps(b, ensure_ascii=False, indent=1), encoding='utf-8')
    log('bank: ' + ', '.join(f"{c} +{added[c]} (총 {len(banks[c]['sources'])}개 실행, 질문 {len(banks[c]['qa'])}, "
                              f"진찰 {len(banks[c]['exams'])}, 재연 {len(banks[c]['replays'])})" for c in sorted(banks)))
    return banks


def load_bank(cid):
    f = BANK / f'{cid}.json'
    if not f.exists():
        raise SystemExit(f'bank/{cid}.json이 없습니다. 먼저 --build-bank로 실제 대화록을 넣어 주세요.')
    return json.loads(f.read_text(encoding='utf-8'))


# ---------------------------------------------------------------- OpenAI 호환 호출
class ApiError(Exception):
    def __init__(self, status, text):
        super().__init__(f'HTTP {status}')
        self.status, self.text = status, text


def post_chat(base, key, body, timeout):
    url = base.rstrip('/') + '/chat/completions'
    if BLOCKED.search(url):
        raise SystemExit('대회 서버 주소에는 이 도구를 쓰지 않습니다(개발 키 규칙).')
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), method='POST',
                                 headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                                          'User-Agent': 'nova-local-runner/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            text = e.read().decode('utf-8', 'replace')[:500]
        except Exception:
            text = ''
        raise ApiError(e.code, text.replace(key, '***') if key else text)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ApiError(0, type(e).__name__)


_ADAPT = set()   # 이 프로세스에서 서버가 거절한 매개변수(한 번 바꾸면 다음 호출부터 그대로)


def chat_api(base, key, model, messages, max_tokens, effort, timeout):
    """max_completion_tokens·reasoning_effort를 받지 않는 서버면 한 번 바꿔 다시 보낸다."""
    tok = 'max_tokens' if 'max_tokens' in _ADAPT else 'max_completion_tokens'
    body = {'model': model, 'messages': messages, tok: int(max_tokens or 2048)}
    if effort and 'no_effort' not in _ADAPT:
        body['reasoning_effort'] = effort
    for _ in range(3):
        try:
            return post_chat(base, key, body, timeout)
        except ApiError as e:
            low = e.text.lower()
            if e.status == 400 and 'max_completion_tokens' in low and 'max_completion_tokens' in body:
                body['max_tokens'] = body.pop('max_completion_tokens')
                _ADAPT.add('max_tokens')
                continue
            if e.status == 400 and 'reasoning' in low and 'reasoning_effort' in body:
                body.pop('reasoning_effort')
                _ADAPT.add('no_effort')
                continue
            raise
    return post_chat(base, key, body, timeout)


# ---------------------------------------------------------------- 가짜 서버(자식 프로세스에서 run.py와 함께 돈다)
class LocalClient:
    """nova_sdk.Client와 같은 이름의 메서드. 턴·30자·호출 한도는 서버 규칙대로."""
    timeout = 240

    def __init__(self, cfg, bank, NovaError):
        self.cfg, self.bank, self.Err = cfg, bank, NovaError
        self.used, self.calls = 0, 0
        self.history = []   # (의사 말, 환자 답)
        self.stats = collections.Counter()
        self.unmatched = []
        rep = int(cfg.get('rep', 1))
        reps = sorted(bank.get('replays') or [], key=lambda r: str(r.get('run_id')), reverse=True)
        self.replay = reps[(rep - 1) % len(reps)] if reps else None
        self.pick = rep - 1
        self.doctor_key = os.environ.get('NOVA_LOCAL_CHILD_DOCTOR_KEY', '')
        self.patient_key = os.environ.get('NOVA_LOCAL_CHILD_PATIENT_KEY', '')
        self.card = patient_card(bank) if self.patient_key else ''

    # 서버와 같은 모양의 응답 ------------------------------------------------
    def session(self):
        return {'initial': self.bank.get('start_information') or {}, 'turns_remaining': TURN_LIMIT - self.used, 'deadline': None}

    def _turn(self, text):
        t = nfc(text)
        if not t or len(t) > MAX_CHARS:
            raise ValueError('SAY, EXAM and TEST require 1–30 NFC characters')
        if self.used >= TURN_LIMIT:
            raise self.Err('TURN_LIMIT_REACHED', 409)
        self.used += 1
        return t

    def _progress(self, kind, doctor, patient):
        path = os.environ.get('NOVA_LOCAL_PROGRESS') or self.cfg.get('progress')
        if not path:
            return
        try:
            with open(path, 'a', encoding='utf-8') as f:
                f.write(json.dumps({'kind': kind, 'turn': self.used, 'calls': self.calls,
                                    'doctor': doctor, 'patient': patient}, ensure_ascii=False) + '\n')
        except OSError:
            pass

    def say(self, content, *, request_id=None):
        t = self._turn(content)
        a = self.patient(t)
        self.history.append((t, a))
        self._progress('say', t, a)
        return {'content': a, 'turn': self.used, 'turns_remaining': TURN_LIMIT - self.used}

    def exam(self, content, *, request_id=None):
        t = self._turn(content)
        a = self.exam_result(t)
        self.history.append((t, a))
        self._progress('exam', t, a)
        return {'result': a, 'turn': self.used, 'turns_remaining': TURN_LIMIT - self.used}

    def test(self, content, *, request_id=None):
        raise self.Err('ACTION_NOT_ALLOWED', 400)

    def diagnose(self, *, note, diagnosis, request_id=None):
        if not isinstance(note, dict) or not isinstance(diagnosis, str) or not diagnosis.strip():
            raise ValueError('note and one main diagnosis are required')
        self.note, self.diagnosis = note, diagnosis
        return {'ok': True, 'turns_remaining': TURN_LIMIT - self.used}

    def chat(self, messages, *, max_tokens=2048, reasoning_effort=None, temperature=None, model=None, request_id=None):
        self.calls += 1
        limit = int(self.cfg.get('call_limit') or os.environ.get('NOVA_LOCAL_CALL_LIMIT') or CALL_LIMIT)
        if self.calls > limit:
            raise self.Err('MODEL_CALL_LIMIT', 429)
        if self.doctor_key:
            try:
                out = chat_api(self.cfg['base_url'], self.doctor_key, self.cfg['doctor_model'], messages, max_tokens,
                               reasoning_effort, self.cfg.get('timeout', 240))
                self.stats['doctor_api'] += 1
                return out
            except ApiError as e:
                self.stats['doctor_api_error'] += 1
                log_err(f'의사 모델 호출 실패: HTTP {e.status} {e.text[:160]}')
                raise self.Err('PROVIDER_UNAVAILABLE' if e.status in (0, 429) or e.status >= 500 else 'MODEL_ERROR', e.status or 503)
        self.stats['doctor_replay'] += 1
        content = json.dumps(self.replay_output(messages), ensure_ascii=False)
        return {'choices': [{'message': {'content': content}, 'finish_reason': 'stop'}],
                'usage': {'prompt_tokens': 0, 'completion_tokens': 0}}

    # 의사 모델 재연 --------------------------------------------------------
    def replay_output(self, messages):
        sp = nfc((messages or [{}])[0].get('content', ''))
        user = nfc(messages[-1].get('content', '')) if messages else ''
        r = self.replay or {}
        if sp.startswith('당신은 외래 초진을 맡은'):
            return r.get('plan') or {}
        if sp.startswith('당신은 외래 초진 중인'):
            return r.get('followup') or {}
        if '주진단을 판정' in sp[:80]:
            return r.get('dx') or {}
        if '초진 기록을 작성' in sp[:80]:
            return r.get('record') or {}
        m = re.search(r'환자 질문:\s*(.+)$', user, re.S)
        q = nfc(m.group(1)).strip() if m else user[-200:]
        pool = [a for rp in self.bank.get('replays') or [] for a in rp.get('answers') or []]
        best = sorted(pool, key=lambda a: -sim(q, a['q']))[:3]
        good = [a['a'] for a in best if sim(q, a['q']) >= 0.35]
        return {'answers': good or ['검사 결과를 보고 함께 정해요.']}

    # 환자 ------------------------------------------------------------------
    def patient(self, text):
        if self.patient_key:
            try:
                a = self.patient_api(text)
                self.stats['patient_api'] += 1
                return a
            except ApiError as e:
                self.stats['patient_api_error'] += 1
                log_err(f'환자 모델 호출 실패: HTTP {e.status} {e.text[:160]} → 오프라인 답으로')
        return self.patient_bank(text)

    def _choose(self, rows, key):
        """가장 가까운 질문의 실제 답들 중 하나(같은 반복 번호면 같은 답)."""
        if not rows:
            return None, 0.0
        scored = sorted(((sim(key, r['q']), r) for r in rows), key=lambda x: -x[0])
        top = scored[0][0]
        near = [r for s, r in scored if s >= top - 0.02]
        answers = collections.Counter(r['a'] for r in near)
        ranked = [a for a, _ in answers.most_common()]
        return ranked[self.pick % len(ranked)], top

    def patient_bank(self, text):
        t = nfc(text).strip()
        q = core(t)
        if q.endswith('?'):
            a, s = self._choose(self.bank.get('qa') or [], q)
            if a is not None and s >= 0.55:
                self.stats['patient_matched'] += 1
                return a
            items = items_of(q)
            if items:
                pol = []
                for it in items:
                    ai, si = self._choose(self.bank.get('qa') or [], f'{it}{_josa(it, "이", "가")} 있나요?')
                    pol.append((it, ai if si >= 0.5 else None))
                if all(x is None or negative(x) for _, x in pol):
                    self.stats['patient_bundle_negative'] += 1
                    return '아니요, 그런 증상은 없어요.'
                first, ans = pol[0]
                self.stats['patient_bundle_first'] += 1
                return ans if ans is not None else f'{first}{_josa(first, "은", "는")} 없어요.'
            self.stats['patient_unmatched'] += 1
            self.unmatched.append(q)
            return NEG_ALL
        a, s = self._choose(self.bank.get('say') or [], t)
        if a is not None and s >= 0.5:
            self.stats['say_matched'] += 1
            return a
        self.stats['say_default'] += 1
        return ACK

    def patient_api(self, text):
        msgs = [{'role': 'system', 'content': self.card}]
        for d, p in self.history[-24:]:
            msgs += [{'role': 'user', 'content': d}, {'role': 'assistant', 'content': p}]
        msgs.append({'role': 'user', 'content': nfc(text)})
        out = chat_api(self.cfg.get('patient_base_url') or self.cfg['base_url'], self.patient_key, self.cfg['patient_model'],
                       msgs, 1200, 'low', self.cfg.get('timeout', 240))
        a = nfc(((out.get('choices') or [{}])[0].get('message') or {}).get('content') or '').strip()
        a = re.sub(r'^(환자|보호자|엄마|아빠)\s*[:：]\s*', '', a).strip('"“” \n')
        a = a.split('\n')[0].strip()
        if len(a) > 40:
            cut = max(a.rfind('.', 0, 40), a.rfind('요', 0, 40))
            a = a[:cut + 1] if cut > 10 else a[:40]
        return a or NEG_ALL

    # 진찰 ------------------------------------------------------------------
    def exam_result(self, text):
        name = _exam_name(text)
        a, s = self._choose(self.bank.get('exams') or [], name)
        if a is not None and s >= 0.45:
            self.stats['exam_matched'] += 1
            return a
        self.stats['exam_default'] += 1
        self.unmatched.append('EXAM ' + name)
        return NO_FINDING


def patient_card(bank):
    """환자 모델에게 줄 증례 자료: 시작 정보와 실제 환자가 한 답(질문마다 가장 흔한 답 하나)."""
    si = bank.get('start_information') or {}
    by_q = collections.defaultdict(collections.Counter)
    for r in bank.get('qa') or []:
        if r.get('p') == 'history':
            by_q[r['q']][r['a']] += 1
    facts = [f'- {q} → {c.most_common(1)[0][0]}' for q, c in list(by_q.items())[:260]]
    asks = collections.Counter(r['a'] for r in bank.get('qa') or [] if r.get('p') in ('explain', 'answer') and r['a'].endswith('?'))
    child = bool(re.search(r'(아이|남자아이|여자아이|아들|딸|보호자)', nfc(si.get('opening'))))
    who = '아이와 함께 온 보호자' if child else '환자 본인'
    return (f"당신은 외래 진료실의 가상 환자({who})입니다. 의사의 말에 한국어로 짧게 답합니다.\n"
            f"시작 정보\n첫 진술: {nfc(si.get('opening'))}\n활력징후: {nfc(si.get('vital_signs'))}\n\n"
            "확인된 사실(이 증례에서 실제로 한 답. 이것이 당신의 사실입니다)\n" + '\n'.join(facts) + '\n\n'
            "의사에게 할 수 있는 질문 예시\n" + '\n'.join(f'- {a}' for a, _ in asks.most_common(6)) + '\n\n'
            "답하는 규칙\n"
            "- 한 번에 한 가지 사실만, 23자 안팎의 한 문장으로 답합니다. 묻지 않은 것은 먼저 말하지 않습니다.\n"
            "- 여러 가지를 한꺼번에 물으면 첫 번째 것에만 답합니다. 모두 해당이 없으면 '그런 증상은 없어요'처럼 한 번에 부정합니다.\n"
            "- 위 사실에 없는 증상·병력은 없다고 답하고, 모르는 것은 모른다고 답합니다. 사실을 지어내지 않습니다.\n"
            "- 진단명이나 의학 용어를 먼저 말하지 않습니다. 설명을 들으면 짧게 수긍하거나, 걱정되는 점을 한 가지 묻습니다.\n"
            "- '더 궁금하신 점'을 물으면 위 질문 예시처럼 한 가지를 묻습니다.\n"
            "- 답만 출력합니다(따옴표·말머리 없이).")


def log_err(text):
    print('[local] ' + text, file=sys.stderr, flush=True)


def child_main(cfg_path):
    """자식 프로세스: 에이전트 run.py를 불러 한 증례를 진료한다. 설정과 키는 환경변수로만 받는다(임시 파일을 만들지 않음)."""
    cfg = json.loads(os.environ['NOVA_LOCAL_CHILD_CFG']) if cfg_path == '-' else json.loads(Path(cfg_path).read_text(encoding='utf-8'))
    agent = Path(cfg['agent_dir']).resolve()
    sys.path.insert(0, str(agent))
    os.chdir(agent)
    import run   # noqa: E402  (시험하는 판의 run.py)
    from nova_sdk import NovaError   # noqa: E402
    if not os.environ.get('NOVA_LOCAL_CHILD_DOCTOR_KEY'):
        run.time.sleep = lambda s: None   # 재연 모드는 재시도 대기가 필요 없다
    bank = load_bank(cfg['case'])
    client = LocalClient(cfg, bank, NovaError)
    os.environ.update(NOVA_TRANSCRIPT_OUT=cfg['transcript'], NOVA_TRANSCRIPT_CASE=cfg['case'],
                      NOVA_TRANSCRIPT_CANDIDATE=cfg['candidate'], NOVA_TRANSCRIPT_RUN=cfg['run_id'])
    state = run.prepare() if hasattr(run, 'prepare') else None
    t0 = time.time()
    try:
        run.consult(client, state)
    finally:
        side = {'mode': {'doctor': 'api' if client.doctor_key else 'replay', 'patient': 'api' if client.patient_key else 'bank'},
                'replay_source': (client.replay or {}).get('candidate', ''), 'replay_run': (client.replay or {}).get('run_id', ''),
                'turns': client.used, 'doctor_calls': client.calls, 'stats': dict(client.stats),
                'unmatched': client.unmatched[:40], 'seconds': round(time.time() - t0, 1)}
        Path(cfg['transcript']).with_suffix('.local.json').write_text(json.dumps(side, ensure_ascii=False, indent=1), encoding='utf-8')


# ---------------------------------------------------------------- 실행과 결과 ZIP
def load_settings():
    s = dict(DEFAULTS)
    try:
        s.update({k: v for k, v in json.loads(SETTINGS.read_text(encoding='utf-8')).items() if 'key' not in k.lower()})
    except Exception:
        pass
    return s


def read_key_file(path):
    try:
        text = Path(path).expanduser().read_text(encoding='utf-8')
    except Exception:
        return {}
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' in line:
            k, v = line.split('=', 1)
            out[k.strip().replace('export ', '')] = v.strip().strip('"\'')
        else:
            out.setdefault('NOVA_LOCAL_API_KEY', line)
    return out


def resolve_keys(args):
    """역할별 키: 입력 > 키 파일 > 환경변수. 없으면 ''(그 역할은 오프라인)."""
    filed = read_key_file(args.key_file) if args.key_file else read_key_file(KEY_FILE)
    keys = {}
    for role in ('doctor', 'patient'):
        keys[role] = next((filed.get(n) or os.environ.get(n, '') for n in KEY_ENV[role] if filed.get(n) or os.environ.get(n)), '')
    if args.ask_key:
        d = getpass.getpass('의사 모델 API 키 (화면에 안 보임, 엔터 = 의사는 오프라인 재연): ').strip()
        p = getpass.getpass('환자 모델 API 키 (엔터 = 의사 키와 같게, "-" = 환자는 오프라인): ').strip()
        keys['doctor'] = d
        keys['patient'] = '' if p == '-' else (p or d)
    if args.offline:
        keys = {'doctor': '', 'patient': ''}
    return keys


def place_agent(src, work):
    agent = work / 'agent'
    agent.mkdir(parents=True, exist_ok=True)
    src = Path(src).expanduser()
    if src.is_dir():
        for f in AGENT_FILES:
            if (src / f).exists():
                shutil.copy2(src / f, agent / f)
    else:
        with zipfile.ZipFile(src) as z:
            for n in z.namelist():
                base = n.split('/')[-1]
                if base in AGENT_FILES and not n.startswith('__MACOSX'):
                    (agent / base).write_bytes(z.read(n))
    if not (agent / 'run.py').exists() or not (agent / 'nova_sdk.py').exists():
        raise SystemExit(f'{src}에 run.py와 nova_sdk.py가 없습니다.')
    return agent


def sha256(path):
    p = Path(path)
    if p.is_dir():
        p = p / 'run.py'
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def summarize(label, tpath):
    row = {'case': label, 'ok': False}
    try:
        d = json.loads(Path(tpath).read_text(encoding='utf-8'))
    except Exception:
        return row
    side = {}
    try:
        side = json.loads(Path(tpath).with_suffix('.local.json').read_text(encoding='utf-8'))
    except Exception:
        pass
    turns = d.get('turns') or []
    if not any(t.get('purpose') for t in turns):
        # 예전 판 대화록에는 purpose가 없다: 마지막 진찰 앞의 질문은 문진, 뒤의 말은 설명으로 본다
        last_exam = max((i for i, t in enumerate(turns) if t.get('action') == 'EXAM'), default=-1)
        for i, t in enumerate(turns):
            if t.get('action') == 'SAY':
                t['purpose'] = 'explain' if i > last_exam else ('history' if nfc(t.get('content')).endswith('?') else 'greeting')
    hist = [t for t in turns if t.get('purpose') == 'history']
    keys = [re.sub(r'\s+', '', core(t.get('base') or t.get('content'))) for t in hist]
    dup = sum(c - 1 for c in collections.Counter(keys).values() if c > 1)
    st = side.get('stats') or {}
    asked = st.get('patient_matched', 0) + st.get('patient_unmatched', 0) + st.get('patient_bundle_first', 0) + st.get('patient_bundle_negative', 0)
    row.update(ok=True, turns=len(turns), history=len(hist), exams=sum(t.get('action') == 'EXAM' for t in turns),
               explain=sum(t.get('purpose') in ('explain', 'answer', 'empathy') for t in turns),
               dx=nfc((d.get('diagnose') or {}).get('diagnosis'))[:40], dup=dup,
               over30=sum(len(nfc(t.get('content'))) > MAX_CHARS for t in turns),
               fidelity=f"{st.get('patient_matched', 0) + st.get('patient_bundle_first', 0) + st.get('patient_bundle_negative', 0)}/{asked}"
               if side.get('mode', {}).get('patient') == 'bank' else 'API',
               exam_hit=f"{st.get('exam_matched', 0)}/{st.get('exam_matched', 0) + st.get('exam_default', 0)}",
               doctor=side.get('mode', {}).get('doctor', '?'),
               source=side.get('replay_source', '') if side.get('mode', {}).get('doctor') == 'replay' else '-',
               calls=(d.get('usage') or {}).get('doctor_calls'),
               tokens=int((d.get('usage') or {}).get('prompt_tokens') or 0) + int((d.get('usage') or {}).get('completion_tokens') or 0),
               core_skip=(d.get('stats') or {}).get('core_guard_skip', 0))
    return row


def summary_md(name, sha, rows, mode):
    out = [f'# {name} (sha256 {sha[:8]}) · 로컬 실행기 {VERSION} · {mode}', '',
           '점수가 아니라 대화록에서 센 값이다. "환자 재현"은 실제 대화록에서 답을 찾은 질문 수(못 찾으면 부정 답).', '',
           '| 증례 | 턴 | 문진 | 진찰 | 설명·답 | 진단 | 중복 질문 | 30자 초과 | 밀린 계획 질문 | 환자 재현 | 진찰 재현 | 의사 | 재연 출처 |',
           '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for r in rows:
        if not r.get('ok'):
            out.append(f"| {r['case']} | 실패 | | | | | | | | | | | |")
            continue
        out.append(f"| {r['case']} | {r['turns']} | {r['history']} | {r['exams']} | {r['explain']} | {r['dx']} | {r['dup']} | "
                   f"{r['over30']} | {r['core_skip']} | {r['fidelity']} | {r['exam_hit']} | {r['doctor']} | {r['source']} |")
    ok = [r for r in rows if r.get('ok')]
    if ok:
        out += ['', f"평균 턴 {sum(r['turns'] for r in ok) / len(ok):.1f}, 평균 문진 {sum(r['history'] for r in ok) / len(ok):.1f}, "
                    f"중복 질문 합 {sum(r['dup'] for r in ok)}"]
    return '\n'.join(out) + '\n'


def reps_for_cases(raw, cases):
    """숫자면 모든 증례에 같은 횟수. 'C01=2,C03=1'이면 증례마다 다른 횟수. 1~5."""
    if isinstance(raw, int):
        n = max(1, min(5, raw))
        return {c: n for c in cases}
    text = str(raw or "1").strip()
    if text.isdigit():
        n = max(1, min(5, int(text)))
        return {c: n for c in cases}
    found = {}
    for part in text.split(","):
        if "=" not in part:
            continue
        name, num = part.split("=", 1)
        name, num = name.strip(), num.strip()
        if name and num.isdigit():
            found[name] = max(1, min(5, int(num)))
    return {c: found.get(c, 1) for c in cases}


def run_one_version(src, cases, reps, keys, settings, log):
    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    name = Path(src).stem if Path(src).suffix == '.zip' else Path(src).name
    work = RUNS / f'{name}_{stamp}'
    out = work / 'transcripts'
    out.mkdir(parents=True, exist_ok=True)
    agent = place_agent(src, work)
    sha = sha256(src)
    mode = f"의사 {'API ' + settings['doctor_model'] if keys['doctor'] else '재연'} · 환자 {'API ' + settings['patient_model'] if keys['patient'] else '대화록'}"
    secrets_ = [k for k in keys.values() if k]

    def say(text):
        for k in secrets_:
            text = text.replace(k, '***')
        log(text)
        with open(work / 'run_log.txt', 'a', encoding='utf-8') as f:
            f.write(text + '\n')

    say(f'로컬 실행기 {VERSION} · {name} (sha256 {sha[:8]}) · {mode}')
    env = {k: v for k, v in os.environ.items() if not re.search(r'NOVA_DEV_KEY|NOVA_LOCAL_.*KEY|OPENAI_API_KEY', k)}
    env['PYTHONIOENCODING'] = 'utf-8'
    env['NOVA_LOCAL_CHILD_DOCTOR_KEY'] = keys['doctor']
    env['NOVA_LOCAL_CHILD_PATIENT_KEY'] = keys['patient']
    def mark_case(kind, label, ok=None):
        path = os.environ.get('NOVA_LOCAL_PROGRESS')
        if not path:
            return
        event = {'kind': kind, 'turn': 0, 'calls': 0, 'doctor': '', 'patient': '', 'case': label}
        if ok is not None:
            event['ok'] = bool(ok)
        try:
            with open(path, 'a', encoding='utf-8') as f:
                f.write(json.dumps(event, ensure_ascii=False) + '\n')
        except OSError:
            pass

    repmap = reps_for_cases(reps, cases)
    labels = []
    for cid in cases:
        n = repmap[cid]
        for r in range(1, n + 1):
            label = cid if n == 1 else f'{cid}_r{r}'
            mark_case('case_start', label)
            cfg = dict(settings, case=cid, rep=r, agent_dir=str(agent), transcript=str(out / f'{label}.json'),
                       candidate=name, run_id=f'{stamp}_{label}',
                       progress=str(work / 'progress.jsonl'), call_limit=settings.get('call_limit', CALL_LIMIT))
            env['NOVA_LOCAL_CHILD_CFG'] = json.dumps(cfg, ensure_ascii=False)
            say(f'\n== {label} 시작 ({datetime.datetime.now():%H:%M:%S})')
            proc = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--_child', '-'], env=env,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
            for line in proc.stdout.splitlines():
                say(line)
            got = (out / f'{label}.json').exists()
            say(f'== {label} 끝: 종료 코드 {proc.returncode}, 대화록 {"있음" if got else "없음"}')
            mark_case('case_end', label, got and proc.returncode == 0)
            labels.append(label)
    rows = [summarize(lb, out / f'{lb}.json') for lb in labels]
    md = summary_md(Path(src).name, sha, rows, mode)
    say('\n' + md)
    result = RUNS / f'결과_{name}_{stamp}_local.zip'
    with zipfile.ZipFile(result, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in sorted(out.glob('*.json')):
            z.write(f, f'transcripts/{f.name}')
        z.write(work / 'run_log.txt', 'run_log.txt')
        for f in AGENT_FILES:
            if (agent / f).exists():
                z.write(agent / f, f'agent/{f}')
        meta = {'runner': VERSION, 'candidate': name, 'zip_name': Path(src).name, 'run': stamp, 'zip_sha256': sha,
                'cases': cases, 'reps': repmap, 'runs': labels,
                'local': {'mode': mode, 'doctor_model': settings['doctor_model'] if keys['doctor'] else None,
                          'patient_model': settings['patient_model'] if keys['patient'] else None,
                          'bank_runs': {c: len(load_bank(c).get('sources') or []) for c in cases}}}
        z.writestr('meta.json', json.dumps(meta, ensure_ascii=False, indent=1))
        z.writestr('summary.md', md)
    say(f'결과 ZIP: {result}')
    return result, rows


def preflight(keys, s):
    """키를 넣은 역할은 진료 전에 한 번 짧게 불러 본다. 키·주소·모델 이름이 틀리면 진료를 시작하지 않는다
    (의사 모델이 응답하지 않으면 에이전트는 첫 호출 성공까지 기다리느라 증례마다 오래 걸린다)."""
    for role, base, model in (('doctor', s['base_url'], s['doctor_model']),
                              ('patient', s.get('patient_base_url') or s['base_url'], s['patient_model'])):
        if not keys[role]:
            continue
        name = '의사' if role == 'doctor' else '환자'
        try:
            chat_api(base, keys[role], model, [{'role': 'user', 'content': '확인용 호출입니다. 네라고만 답하세요.'}], 64, None, 60)
        except ApiError as e:
            hint = {401: '키가 틀렸거나 만료됨', 403: '권한 없음', 404: '모델 이름 또는 주소 확인', 429: '사용 한도·요금 확인'}.get(e.status, '주소·네트워크 확인')
            raise SystemExit(f'{name} 모델({model}) 연결 실패: HTTP {e.status or "연결 안 됨"} ({hint}). '
                             f'진료는 시작하지 않았습니다. 키 없이 돌리려면 --offline을 쓰세요.')
        print(f'{name} 모델 연결 확인: {model}')


def newest_submission():
    found = []
    for d in (Path.cwd(), HERE, Path.home() / 'Downloads'):
        found += [p for p in d.glob('submission*.zip') if p.is_file()]
    return max(found, key=lambda p: p.stat().st_mtime) if found else None


def interactive(a):
    """인자 없이 실행하면 하나씩 묻는다. 키는 화면에 보이지 않고 저장되지 않는다."""
    print(f'NOVA 로컬 샘플 실행기 {VERSION} (개발 키·대회 서버 안 씀)\n')
    guess = newest_submission()
    z = input(f'제출 ZIP 또는 에이전트 폴더 경로 [엔터 = {guess or "없음"}]: ').strip().strip('"\'') or (str(guess) if guess else '')
    if not z:
        raise SystemExit('제출 ZIP 경로가 필요합니다.')
    a.zip = [z]
    r = input('증례마다 반복 횟수 [엔터 = 1]: ').strip()
    a.reps = int(r) if r.isdigit() and int(r) > 0 else 1
    filed = read_key_file(a.key_file or KEY_FILE)
    if any(filed.get(n) for n in KEY_ENV['doctor'] + KEY_ENV['patient']) and input(f'{a.key_file or KEY_FILE}의 키를 쓸까요? [Y/n]: ').strip().lower() != 'n':
        return
    a.ask_key = True
    pm = input('환자 모델 [엔터 = gpt-6-luna(샘플 검증과 같음), 2 = gpt-6.1-sol(공식 평가와 같음), 직접 입력]: ').strip()
    if pm == '2':
        a.patient_model = 'gpt-6.1-sol'
    elif pm and pm != '1':
        a.patient_model = pm


def main(argv=None):
    ap = argparse.ArgumentParser(description='NOVA 2026 로컬 샘플 실행기 (개발 키 없이)')
    ap.add_argument('--zip', action='append', default=[], help='제출 ZIP 또는 에이전트 폴더(run.py, nova_sdk.py). 여러 번 주면 판마다 같은 조건으로')
    ap.add_argument('--cases', default='', help='쉼표로(기본: bank에 있는 증례 전부)')
    ap.add_argument('--reps', default='1', help='반복 횟수. 숫자(모든 증례) 또는 C01=2,C03=1. 오프라인은 반복마다 다른 실제 실행을 재연한다')
    ap.add_argument('--ask-key', action='store_true', help='API 키를 입력받는다(화면에 안 보임, 저장하지 않음)')
    ap.add_argument('--key-file', default='', help=f'키 파일(기본 {KEY_FILE}). "NOVA_LOCAL_DOCTOR_KEY=..." 또는 키 한 줄')
    ap.add_argument('--offline', action='store_true', help='키가 있어도 쓰지 않는다')
    ap.add_argument('--base-url', default='', help='OpenAI 호환 주소(기본 https://api.openai.com/v1)')
    ap.add_argument('--patient-base-url', default='', help='환자 모델만 다른 주소를 쓸 때')
    ap.add_argument('--doctor-model', default='', help='의사 모델 이름(기본 gpt-6-luna)')
    ap.add_argument('--patient-model', default='', help='환자 모델 이름(기본 gpt-6-luna, 공식 평가처럼은 gpt-6.1-sol)')
    ap.add_argument('--save-settings', action='store_true', help='주소·모델 이름을 settings.json에 저장(키는 저장하지 않음)')
    ap.add_argument('--build-bank', nargs='*', default=None, help='실제 실행기 결과(ZIP·폴더·대화록 JSON)로 bank를 만들거나 보강')
    ap.add_argument('--_child', default='', help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    if a._child:
        return child_main(a._child)
    if a.build_bank is not None:
        if not a.build_bank:
            raise SystemExit('대화록이 든 ZIP·폴더를 주세요.')
        build_bank(a.build_bank)
        if not a.zip:
            return 0
    if not a.zip:
        if not sys.stdin.isatty():
            ap.print_help()
            return 1
        interactive(a)   # 인자 없이 실행(또는 NOVA_Local.command 더블클릭)하면 물어보며 진행
    s = load_settings()
    for k in ('base_url', 'patient_base_url', 'doctor_model', 'patient_model'):
        if getattr(a, k):
            s[k] = getattr(a, k)
    for u in (s['base_url'], s.get('patient_base_url') or ''):
        if u and BLOCKED.search(u):
            raise SystemExit('대회 서버 주소에는 이 도구를 쓰지 않습니다(개발 키 규칙). OpenAI 호환 주소를 주세요.')
    if a.save_settings:
        SETTINGS.write_text(json.dumps({k: s[k] for k in DEFAULTS}, ensure_ascii=False, indent=1), encoding='utf-8')
    keys = resolve_keys(a)
    preflight(keys, s)
    cases = [c.strip() for c in a.cases.split(',') if c.strip()] or sorted(f.stem for f in BANK.glob('*.json'))
    if not cases:
        raise SystemExit('bank가 비어 있습니다. --build-bank로 실제 실행기 결과를 넣어 주세요.')
    RUNS.mkdir(parents=True, exist_ok=True)
    results = []
    for src in a.zip:
        results.append(run_one_version(src, cases, a.reps, keys, s, print))
    if len(results) > 1:
        print('\n판 비교 (평균)')
        for (res, rows), src in zip(results, a.zip):
            ok = [r for r in rows if r.get('ok')]
            if ok:
                print(f"- {Path(src).name}: 턴 {sum(r['turns'] for r in ok) / len(ok):.1f}, 문진 {sum(r['history'] for r in ok) / len(ok):.1f}, "
                      f"진찰 {sum(r['exams'] for r in ok) / len(ok):.1f}, 중복 {sum(r['dup'] for r in ok)}, 결과 {res.name}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
