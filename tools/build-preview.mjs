/* 랜딩 벤토의 미리보기를 "실제 그래프"로 만들기 위한 사전 계산 스크립트.

   랜딩에서 89노드 포스 레이아웃을 매번 돌리면 무겁고 결과도 매번 달라진다.
   그래서 여기서 한 번 계산해 좌표와 점수만 assets/preview-data.js 로 뽑아둔다.
   레이아웃 알고리즘과 파라미터는 safari.html 과 동일하고,
   PPR 도 실제 mock 독서 이력을 시드로 쓴다.

   실행: node tools/build-preview.mjs
*/
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, PAPERS, MODELS, ARTICLES, handCitations, readingHistory
} from "../backtest/data.mjs";

/* ── 그래프 구축 (safari.html 과 같은 규칙) ─────────────── */
const N = new Map(), ADJ = new Map();
const add = (id, kind, cites) => { N.set(id, { id, kind, cites, x: 0, y: 0, vx: 0, vy: 0 }); ADJ.set(id, []); };
for (const [id, , , , cites] of PAPERS) add(id, "paper", +cites);
for (const [id] of MODELS) add(id, "model", 0);
for (const [id] of ARTICLES) add(id, "article", 0);

const EDGES = [];
const link = (a, b) => {
  if (!N.has(a) || !N.has(b)) return;
  EDGES.push([a, b]); ADJ.get(a).push(b); ADJ.get(b).push(a);
};
for (const { from, to } of handCitations()) link(from, to);
for (const [id, , paper] of MODELS) link(id, paper);

const ALL = [...N.values()];

/* ── 시드: 실제 mock 독서 이력 ──────────────────────────── */
const WGT = { liked: 2, read: 1, skipped: -1 };
const HALF_LIFE = 90;
const NOW = Date.parse("2026-09-04T12:00:00+09:00");   // 결정적 출력을 위해 기준 시각 고정

const RX = new Map();
for (const e of readingHistory()) {
  if (N.has(e.node_id)) RX.set(e.node_id, { r: e.reaction, at: Date.parse(e.read_at) });
}

function ppr() {
  const s = {}; let norm = 0;
  for (const [id, o] of RX) {
    const w = WGT[o.r] || 0; if (!w) continue;
    const days = Math.max(0, (NOW - o.at) / 86400000);
    const v = w * Math.pow(0.5, days / HALF_LIFE);
    s[id] = (s[id] || 0) + v; norm += Math.abs(v);
  }
  for (const k in s) s[k] /= norm;
  let p = { ...s };
  for (let i = 0; i < 45; i++) {
    const nx = {};
    for (const id in p) {
      const nb = ADJ.get(id); if (!nb || !nb.length) continue;
      const sh = (p[id] * 0.85) / nb.length;
      for (const m of nb) nx[m] = (nx[m] || 0) + sh;
    }
    for (const id in s) nx[id] = (nx[id] || 0) + 0.15 * s[id];
    p = nx;
  }
  return p;
}
const P = ppr();
const score = id => (P[id] || 0) / Math.pow(Math.max((ADJ.get(id) || []).length, 1), 0.8);
const RECS = new Set(
  [...N.keys()].filter(id => !RX.has(id) && score(id) > 0)
    .sort((a, b) => score(b) - score(a)).slice(0, 8));

/* ── 포스 레이아웃 (safari.html 과 동일 파라미터) ───────── */
let seed = 20260904;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

for (const n of ALL) {
  const a = rnd() * 6.2832, r = 220 + rnd() * 560;
  n.x = Math.cos(a) * r; n.y = Math.sin(a) * r;
}
const K = 118, STEPS = 420;
for (let it = 0; it < STEPS; it++) {
  const heat = 1 - (it / STEPS) * 0.86;
  for (let i = 0; i < ALL.length; i++) {
    const p1 = ALL[i]; p1.vx *= 0.85; p1.vy *= 0.85;
    for (let j = i + 1; j < ALL.length; j++) {
      const q = ALL[j];
      let dx = p1.x - q.x, dy = p1.y - q.y, d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = rnd() - 0.5; dy = rnd() - 0.5; d2 = 1; }
      const d = Math.sqrt(d2), f = ((K * K) / d2) * heat;
      p1.vx += (dx / d) * f; p1.vy += (dy / d) * f;
      q.vx -= (dx / d) * f; q.vy -= (dy / d) * f;
    }
  }
  for (const [a, b] of EDGES) {
    const p1 = N.get(a), q = N.get(b);
    const dx = q.x - p1.x, dy = q.y - p1.y, d = Math.hypot(dx, dy) || 1;
    const f = ((d * d) / (K * 30)) * heat;
    p1.vx += (dx / d) * f; p1.vy += (dy / d) * f;
    q.vx -= (dx / d) * f; q.vy -= (dy / d) * f;
  }
  for (const n of ALL) {
    n.vx -= n.x * 0.013 * heat; n.vy -= n.y * 0.013 * heat;
    n.x += Math.max(-18, Math.min(18, n.vx));
    n.y += Math.max(-18, Math.min(18, n.vy));
  }
}

/* ── 정규화해서 내보낸다 ────────────────────────────────── */
let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
for (const n of ALL) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
const w = x1 - x0, h = y1 - y0;
const maxS = Math.max(...ALL.map(n => score(n.id)));

/* flag: 0 외부 · 1 내 것 · 2 스킵 · 3 추천 · 4 모델 · 5 아티클 */
const flagOf = n => {
  const rx = RX.get(n.id);
  if (rx) return rx.r === "skipped" ? 2 : 1;
  if (RECS.has(n.id)) return 3;
  if (n.kind === "model") return 4;
  if (n.kind === "article") return 5;
  return 0;
};
const idx = new Map(ALL.map((n, i) => [n.id, i]));
const r4 = v => Math.round(v * 1e4) / 1e4;

const nodes = ALL.map(n => [r4((n.x - x0) / w), r4((n.y - y0) / h),
                            Math.round((score(n.id) / maxS) * 1000) / 1000, flagOf(n)]);
const edges = EDGES.map(([a, b]) => [idx.get(a), idx.get(b)]);

/* 사파리 미리보기의 플레이어 위치 = 최근에 읽은 것들의 무게중심 */
const recent = [...RX].filter(([, o]) => (WGT[o.r] || 0) > 0)
  .sort((a, b) => a[1].at - b[1].at).slice(-8).map(([id]) => N.get(id));
const px = r4(recent.reduce((a, n) => a + (n.x - x0) / w, 0) / recent.length);
const py = r4(recent.reduce((a, n) => a + (n.y - y0) / h, 0) / recent.length);

const out = `/* 자동 생성 파일. 직접 고치지 마라.
   생성: node tools/build-preview.mjs
   safari.html 의 실제 그래프(노드 ${ALL.length} · 엣지 ${EDGES.length})를
   같은 포스 레이아웃으로 배치하고, 실제 mock 독서 이력으로 PPR 을 돌린 결과다.
   n = [x, y, score, flag]  flag: 0 외부 · 1 내 것 · 2 스킵 · 3 추천 · 4 모델 · 5 아티클
   e = [노드 인덱스, 노드 인덱스] */
const CG_PREVIEW = {
  aspect: ${r4(w / h)},
  player: [${px}, ${py}],
  n: ${JSON.stringify(nodes)},
  e: ${JSON.stringify(edges)}
};
`;
writeFileSync(join(ROOT, "assets", "preview-data.js"), out);

const cnt = f => nodes.filter(n => n[3] === f).length;
console.log(`노드 ${ALL.length} · 엣지 ${EDGES.length} · 종횡비 ${r4(w / h)}`);
console.log(`내 것 ${cnt(1)} · 스킵 ${cnt(2)} · 추천 ${cnt(3)} · 모델 ${cnt(4)} · 아티클 ${cnt(5)} · 외부 ${cnt(0)}`);
console.log(`추천 상위: ${[...RECS].slice(0, 8).join(", ")}`);
console.log(`assets/preview-data.js (${(out.length / 1024).toFixed(1)} KB)`);
