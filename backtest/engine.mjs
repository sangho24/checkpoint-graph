/* 백테스트 엔진: 그래프 구성 · 시간 검열 · 폴드 생성 · 랭킹 방법.
   coverage.mjs 와 run.mjs 가 공유한다. */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PAPERS, MODELS, ARTICLES, PAPER_BY_ID, handCitations, readingHistory, CACHE_DIR } from "./data.mjs";

export const DAY = 86400000;

/* ── 그래프 자료구조 ────────────────────────────────────────────
   nodes: Map<id, {id, kind, year, date(ms|null), cites}>
   cites: [{from, to}]  from 이 to 를 인용 (from 이 더 나중에 나온 쪽)
   ADJ  : 무방향 인접 (PPR 이 쓰는 것. safari.html 과 동일하게 무방향)
   OUT  : from -> [to]  (참고문헌 최빈 베이스라인이 쓴다)
*/
function makeGraph(nodes, edges) {
  const ADJ = new Map(), OUT = new Map(), IN = new Map();
  for (const id of nodes.keys()) { ADJ.set(id, []); OUT.set(id, []); IN.set(id, []); }
  const kept = [];
  const seen = new Set();
  for (const e of edges) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) continue;
    if (e.from === e.to) continue;                       // 자기루프 제거 (OpenAlex 에 cot->cot 이 1건 있다)
    const key = `${e.type}|${e.from}|${e.to}`;
    if (seen.has(key)) continue;                         // 같은 방향 중복 엣지 제거
    seen.add(key);
    kept.push(e);
    OUT.get(e.from).push(e.to);
    IN.get(e.to).push(e.from);
    ADJ.get(e.from).push(e.to);
    ADJ.get(e.to).push(e.from);
  }
  return { nodes, edges: kept, ADJ, OUT, IN };
}

/* ── 조건 B: safari.html 의 손으로 만든 인용 그래프 ───────────── */
export function graphHand() {
  const nodes = new Map();
  for (const [id, title, year, arxiv, cites, topic] of PAPERS)
    nodes.set(id, { id, kind: "paper", year: +year, date: Date.UTC(+year, 0, 1), cites: +cites, title, topic });
  for (const [id, name, paper] of MODELS) {
    const p = PAPER_BY_ID.get(paper);
    const y = p ? p.year : 2024;
    nodes.set(id, { id, kind: "model", year: y, date: Date.UTC(y, 0, 1), cites: 0, title: name });
  }
  for (const [id, title, host, year] of ARTICLES)
    nodes.set(id, { id, kind: "article", year: +year, date: Date.UTC(+year, 0, 1), cites: 0, title });

  const edges = handCitations().map(e => ({ ...e, type: "cites" }));
  for (const [id, , paper] of MODELS) edges.push({ from: id, to: paper, type: "describes" });
  return { name: "hand", ...makeGraph(nodes, edges) };
}

/* ── 조건 A: OpenAlex 실제 인용 그래프 ──────────────────────────
   해소된 work 만 노드로 쓰고, referenced_works 중 우리 78편 안에 있는 것만 엣지로 남긴다. */
export function graphOpenAlex() {
  const path = join(CACHE_DIR, "openalex-works.json");
  if (!existsSync(path)) return null;
  const cache = JSON.parse(readFileSync(path, "utf8"));
  const resolved = cache.works.filter(w => w.resolved && w.work);
  const workToNode = new Map();          // OpenAlex work id -> 우리 node_id
  const nodes = new Map();
  for (const w of resolved) {
    workToNode.set(w.work.id, w.node_id);
    nodes.set(w.node_id, {
      id: w.node_id, kind: "paper",
      year: w.work.publication_year,
      date: Date.parse(w.work.publication_date),
      cites: w.work.cited_by_count,
      title: w.work.display_name
    });
  }
  const edges = [];
  for (const w of resolved)
    for (const ref of w.work.referenced_works)
      if (workToNode.has(ref)) edges.push({ from: w.node_id, to: workToNode.get(ref), type: "cites" });
  const g = { name: "openalex", ...makeGraph(nodes, edges) };
  g.meta = { resolved: resolved.length, total: cache.works.length, cache };
  return g;
}

/* ── 시간 검열 ──────────────────────────────────────────────────
   컷오프 T 보다 나중에 나온 노드를 전부 제거한다.
   인용 엣지의 시각은 인용하는 쪽(from) 논문의 출판일이므로, from 이 사라지면 엣지도 사라진다.
   (엣지는 양 끝이 모두 남아야 유지된다)
   mode:
     "date" - 노드의 publication_date 를 그대로 쓴다 (조건 A)
     "year" - 노드의 연도만 쓴다. 컷오프 연도보다 큰 연도를 제거 (조건 B 근사) */
export function censor(g, cutoffMs, mode) {
  const cutYear = new Date(cutoffMs).getUTCFullYear();
  const nodes = new Map();
  for (const [id, n] of g.nodes) {
    if (mode === "year") { if (n.year > cutYear) continue; }
    else { if (n.date != null && n.date > cutoffMs) continue; }
    nodes.set(id, n);
  }
  return { name: g.name, ...makeGraph(nodes, g.edges) };
}

/* ── 폴드 ───────────────────────────────────────────────────────
   timeline: "read"    실제 읽은 시각 (기본)
             "pubdate" 각 항목의 시각을 그 논문의 출판일로 바꾼 동시대 시뮬레이션 */
export function makeFolds({ timeline = "read", graph, minSeeds = 10 } = {}) {
  let entries = readingHistory().map(e => ({ node_id: e.node_id, reaction: e.reaction, ts: e.ts }));
  if (timeline === "pubdate") {
    entries = entries
      .map(e => {
        const n = graph.nodes.get(e.node_id);
        return { ...e, ts: n && n.date != null ? n.date : e.ts };
      })
      .sort((a, b) => a.ts - b.ts);
  }
  const folds = [];
  for (let i = minSeeds; i < entries.length; i++) {
    // 읽은시각 타임라인: 컷오프는 직전 시드를 읽은 시각.
    // 출판일 타임라인: 컷오프를 직전 항목의 출판일로 잡으면 정답 자신이 검열돼 사라진다.
    //   (정렬이 출판일 오름차순이므로 정답은 항상 컷오프 뒤에 있다)
    //   그래서 "정답 논문이 세상에 나온 그 순간"을 컷오프로 쓴다. 정답은 살아남고
    //   그 뒤에 나온 것은 전부 사라진다. 대신 최근성 베이스라인이 정답을 항상 1위로
    //   두게 되므로, 이 조건에서 최근성 수치는 무효로 취급해야 한다.
    const cutoff = timeline === "pubdate" ? entries[i].ts : entries[i - 1].ts;
    folds.push({ index: i, seeds: entries.slice(0, i), truth: entries[i], cutoff });
  }
  return { entries, folds };
}

/* ── 시드 벡터 ──────────────────────────────────────────────────
   s[i] = w(반응) * 0.5^(경과일 / 반감기),  w = {liked 2, read 1, skipped -1}
   halfLife = null 이면 감쇠 없음. |v| 합으로 정규화 (safari.html 과 동일). */
export const WGT = { liked: 2, read: 1, skipped: -1 };
/* skippedWeight 로 스킵 가중치만 따로 바꿔볼 수 있다 (민감도 분석용) */
export function seedVector(seeds, cutoffMs, halfLifeDays, nodes, skippedWeight) {
  const wgt = skippedWeight === undefined ? WGT : { ...WGT, skipped: skippedWeight };
  const s = {}; let norm = 0;
  for (const e of seeds) {
    if (!nodes.has(e.node_id)) continue;          // 검열로 사라진 시드는 뺀다
    const w = wgt[e.reaction] || 0;
    if (!w) continue;
    const days = Math.max(0, (cutoffMs - e.ts) / DAY);
    const v = halfLifeDays == null ? w : w * Math.pow(0.5, days / halfLifeDays);
    s[e.node_id] = (s[e.node_id] || 0) + v;
    norm += Math.abs(v);
  }
  if (norm > 0) for (const k in s) s[k] /= norm;
  return s;
}

/* ── PPR (safari.html 과 같은 계산: 무방향 인접, 감쇠 0.85, 45회 멱반복) ── */
export function ppr(g, s, iters = 45, d = 0.85) {
  let p = Object.assign({}, s);
  for (let it = 0; it < iters; it++) {
    const nx = {};
    for (const id in p) {
      const nb = g.ADJ.get(id);
      if (!nb || !nb.length) continue;
      const share = (p[id] * d) / nb.length;
      for (const m of nb) nx[m] = (nx[m] || 0) + share;
    }
    for (const id in s) nx[id] = (nx[id] || 0) + (1 - d) * s[id];
    p = nx;
  }
  return p;
}

/* ── 후보 풀: 시드에서 무방향 K홉 이내, 이미 반응한 노드 제외 ── */
export function candidatePool(g, seedIds, maxHops = 3) {
  const dist = new Map();
  let frontier = [];
  for (const id of seedIds) if (g.nodes.has(id)) { dist.set(id, 0); frontier.push(id); }
  for (let h = 1; h <= maxHops && frontier.length; h++) {
    const next = [];
    for (const id of frontier)
      for (const m of (g.ADJ.get(id) || []))
        if (!dist.has(m)) { dist.set(m, h); next.push(m); }
    frontier = next;
  }
  const reacted = new Set(seedIds);
  const pool = [];
  for (const [id, h] of dist) if (h > 0 && !reacted.has(id)) pool.push(id);
  return { pool, dist };
}

/* ── 랭킹 방법 ──────────────────────────────────────────────────
   전부 같은 후보 풀 위에서 점수를 매기고 내림차순 정렬한다. */
export function rankPPR(g, seeds, cutoff, pool, { hubExp, halfLife, skippedWeight }) {
  const s = seedVector(seeds, cutoff, halfLife, g.nodes, skippedWeight);
  const p = ppr(g, s);
  const score = {};
  for (const id of pool) {
    const deg = (g.ADJ.get(id) || []).length;
    score[id] = (p[id] || 0) / Math.pow(Math.max(deg, 1), hubExp);
  }
  return sortPool(g, pool, score);
}

export function rankCites(g, seeds, cutoff, pool) {
  const score = {};
  for (const id of pool) score[id] = (g.nodes.get(id) || {}).cites || 0;
  return sortPool(g, pool, score);
}

export function rankRecency(g, seeds, cutoff, pool) {
  const score = {};
  for (const id of pool) {
    const n = g.nodes.get(id);
    score[id] = n && n.date != null ? n.date : -Infinity;
  }
  return sortPool(g, pool, score);
}

/* 참고문헌 최빈: 시드들이 인용한(OUT) 논문을 센다. 반응 가중치를 곱한다. */
export function rankRefFreq(g, seeds, cutoff, pool, { halfLife } = { halfLife: null }) {
  const s = seedVector(seeds, cutoff, halfLife, g.nodes);
  const score = {};
  for (const id of pool) score[id] = 0;
  for (const seedId in s) {
    const w = s[seedId];
    for (const to of (g.OUT.get(seedId) || []))
      if (to in score) score[to] += w;
  }
  return sortPool(g, pool, score);
}

function sortPool(g, pool, score) {
  return pool.slice().sort((a, b) => {
    const d = (score[b] || 0) - (score[a] || 0);
    if (d) return d;
    // 동점은 피인용수, 그다음 id 사전순으로 결정적으로 깬다
    const ca = (g.nodes.get(a) || {}).cites || 0, cb = (g.nodes.get(b) || {}).cites || 0;
    return (cb - ca) || (a < b ? -1 : 1);
  });
}

/* ── 지표 유틸 ── */
export function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
export function stdev(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
export function quantile(a, p) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
