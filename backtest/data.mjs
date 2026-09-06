/* 공통 데이터 로더.
   data/hand-corpus.js 안의 const PAPERS / MODELS / ARTICLES / CITE_SRC 를 그대로 읽어오고,
   data/reading-history.json 의 mock 독서 이력을 읽는다.
   (예전에는 safari.html 에 인라인돼 있었다. 화면 페이지들은 이제 assets/corpus.js 를 읽고, 이 파일은 손 코퍼스의 원본이다) */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");
export const CACHE_DIR = join(HERE, "cache");

/* safari.html 에서 `const NAME = ... ;` 한 덩어리를 잘라내 JS 로 평가한다.
   대괄호/백틱 리터럴만 대상으로 하므로 균형 잡힌 종료 지점을 직접 찾는다. */
function extractConst(src, name) {
  const head = src.indexOf(`const ${name} =`);
  if (head < 0) throw new Error(`data/hand-corpus.js 에서 const ${name} 을 찾지 못했다`);
  let i = src.indexOf("=", head) + 1;
  while (/\s/.test(src[i])) i++;
  const open = src[i];
  if (open === "`") {
    const end = src.indexOf("`", i + 1);
    return src.slice(i, end + 1);
  }
  // 배열 리터럴: 대괄호 균형을 센다 (문자열 안의 괄호는 건너뛴다)
  let depth = 0, j = i, inStr = null;
  for (; j < src.length; j++) {
    const c = src[j];
    if (inStr) { if (c === "\\") j++; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

const safari = readFileSync(join(ROOT, "data", "hand-corpus.js"), "utf8");

/* eslint-disable no-new-func */
export const PAPERS = new Function(`return ${extractConst(safari, "PAPERS")}`)();
export const MODELS = new Function(`return ${extractConst(safari, "MODELS")}`)();
export const ARTICLES = new Function(`return ${extractConst(safari, "ARTICLES")}`)();
export const CITE_SRC = new Function(`return ${extractConst(safari, "CITE_SRC")}`)();

/* 논문 메타: id -> {id, title, year, arxiv, cites, topic} */
export const PAPER_BY_ID = new Map(
  PAPERS.map(([id, title, year, arxiv, cites, topic]) =>
    [id, { id, title, year: +year, arxiv, cites: +cites, topic }])
);

/* 손으로 만든 인용 엣지: {from, to} - from 이 to 를 인용한다 */
export function handCitations() {
  const edges = [];
  for (const line of CITE_SRC.trim().split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const from = line.slice(0, idx).trim();
    for (const to of line.slice(idx + 1).trim().split(/\s+/)) {
      if (to) edges.push({ from, to });
    }
  }
  return edges;
}

/* mock 독서 이력 (읽은 시각 오름차순) */
export function readingHistory() {
  const raw = JSON.parse(readFileSync(join(ROOT, "data", "reading-history.json"), "utf8"));
  return raw.entries
    .map(e => ({ ...e, ts: Date.parse(e.read_at) }))
    .sort((a, b) => a.ts - b.ts);
}

/* 제목 정규화 및 토큰 F1 (OpenAlex 매칭 검증용) */
const STOP = new Set(["a", "an", "the", "of", "for", "and", "with", "to", "in", "on", "is", "are", "via"]);
export function normTitle(t) {
  return t.toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
export function titleTokens(t) {
  return new Set(normTitle(t).split(" ").filter(w => w && !STOP.has(w)));
}
/* 질의 제목 A 와 후보 제목 B 의 토큰 F1.
   PAPERS 의 제목이 "(T5)" 처럼 축약된 경우가 있어 정확 일치만으로는 부족하다. */
export function titleF1(a, b) {
  const A = titleTokens(a), B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const p = inter / A.size, r = inter / B.size;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}
