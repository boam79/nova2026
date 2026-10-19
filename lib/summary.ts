export type Turn = {
  action?: string;
  content?: string;
  base?: string;
  response?: string;
  purpose?: string;
};

export type Transcript = {
  turns?: Turn[];
  diagnose?: { diagnosis?: string };
  usage?: { doctor_calls?: number; prompt_tokens?: number; completion_tokens?: number };
  stats?: { core_guard_skip?: number };
};

export type Side = {
  stats?: Record<string, number>;
  mode?: { doctor?: string; patient?: string };
  replay_source?: string;
};

const MAX_CHARS = 30;

function nfc(s: unknown): string {
  return String(s || "").normalize("NFC");
}

function core(text: string): string {
  let t = nfc(text).trim();
  if (t.endsWith("?")) {
    const parts = t.split(/(?<=[.!])\s+/).filter((x) => x.trim());
    if (parts.length > 1) t = parts[parts.length - 1].trim();
  }
  return t;
}

export function summarizeTranscript(label: string, doc: Transcript, side: Side = {}) {
  const turns = [...(doc.turns || [])];
  if (!turns.some((t) => t.purpose)) {
    const lastExam = turns.reduce((acc, t, i) => (t.action === "EXAM" ? i : acc), -1);
    turns.forEach((t, i) => {
      if (t.action === "SAY" && !t.purpose) {
        t.purpose =
          i > lastExam ? "explain" : nfc(t.content).endsWith("?") ? "history" : "greeting";
      }
    });
  }
  const hist = turns.filter((t) => t.purpose === "history");
  const keys = hist.map((t) => core(t.base || t.content || "").replace(/\s+/g, ""));
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1);
  let dup = 0;
  for (const c of counts.values()) if (c > 1) dup += c - 1;
  const st = side.stats || {};
  const asked =
    (st.patient_matched || 0) +
    (st.patient_unmatched || 0) +
    (st.patient_bundle_first || 0) +
    (st.patient_bundle_negative || 0);
  const fidelity =
    side.mode?.patient === "bank"
      ? `${(st.patient_matched || 0) + (st.patient_bundle_first || 0) + (st.patient_bundle_negative || 0)}/${asked}`
      : "API";
  return {
    case: label,
    ok: true,
    turns: turns.length,
    history: hist.length,
    exams: turns.filter((t) => t.action === "EXAM").length,
    explain: turns.filter((t) => ["explain", "answer", "empathy"].includes(t.purpose || "")).length,
    dx: nfc(doc.diagnose?.diagnosis).slice(0, 40),
    dup,
    over30: turns.filter((t) => nfc(t.content).length > MAX_CHARS).length,
    fidelity,
    exam_hit: `${st.exam_matched || 0}/${(st.exam_matched || 0) + (st.exam_default || 0)}`,
    doctor: side.mode?.doctor || "?",
    source: side.mode?.doctor === "replay" ? side.replay_source || "" : "-",
    calls: doc.usage?.doctor_calls,
    tokens: Number(doc.usage?.prompt_tokens || 0) + Number(doc.usage?.completion_tokens || 0),
    core_skip: doc.stats?.core_guard_skip || 0,
  };
}

export function transcriptToText(doc: Transcript): string {
  const lines: string[] = [];
  for (const t of doc.turns || []) {
    const who = t.action === "EXAM" ? "진찰" : "의사";
    lines.push(`${who}: ${nfc(t.content)}`);
    if (t.response) lines.push(`환자: ${nfc(t.response)}`);
    lines.push("");
  }
  if (doc.diagnose?.diagnosis) lines.push(`진단: ${nfc(doc.diagnose.diagnosis)}`);
  return lines.join("\n");
}
