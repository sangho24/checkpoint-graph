/* onboard.html 이 읽는 코퍼스 파일 생성기.

   safari.html 안의 PAPERS / MODELS / ARTICLES / CITE_SRC 를 backtest/data.mjs 로 읽어
   assets/corpus.js (window.CORPUS) 로 뽑는다. safari.html 은 건드리지 않는다.
   포스 레이아웃 좌표도 여기서 한 번 계산해 둔다 (매번 돌리면 결과가 흔들린다).
   레이아웃 파라미터는 tools/build-preview.mjs 와 같다.

   실행: node tools/build-corpus.mjs
*/
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, PAPERS, MODELS, ARTICLES, handCitations } from "../backtest/data.mjs";

const papers = PAPERS.map(([id, title, year, arxiv, cites, topic]) => ({ id, title, year: +year, arxiv, cites: +cites, topic }));
const models = MODELS.map(([id, name, paper, license]) => ({ id, name, paper, license }));
const articles = ARTICLES.map(([id, title, host, year]) => ({ id, title, host, year: +year }));

/* 엣지: 손으로 만든 인용 + 모델 → 논문 */
const N = new Map();
for (const p of papers) N.set(p.id, { id: p.id, x: 0, y: 0, vx: 0, vy: 0 });
for (const m of models) N.set(m.id, { id: m.id, x: 0, y: 0, vx: 0, vy: 0 });
for (const a of articles) N.set(a.id, { id: a.id, x: 0, y: 0, vx: 0, vy: 0 });
const cites = [];
const seen = new Set();
for (const { from, to } of handCitations()) {
  if (!N.has(from) || !N.has(to) || from === to) continue;
  const k = from + ">" + to; if (seen.has(k)) continue; seen.add(k);
  cites.push([from, to]);
}
const describes = models.map(m => [m.id, m.paper]).filter(([, p]) => N.has(p));
const EDGES = [...cites, ...describes];

/* 포스 레이아웃 (결정적 난수) */
const ALL = [...N.values()];
let seed = 20260904;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (const n of ALL) { const a = rnd() * 6.2832, r = 220 + rnd() * 560; n.x = Math.cos(a) * r; n.y = Math.sin(a) * r; }
const K = 118, STEPS = 420;
for (let it = 0; it < STEPS; it++) {
  const heat = 1 - (it / STEPS) * 0.86;
  for (let i = 0; i < ALL.length; i++) {
    const p = ALL[i]; p.vx *= 0.85; p.vy *= 0.85;
    for (let j = i + 1; j < ALL.length; j++) {
      const q = ALL[j];
      let dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = rnd() - 0.5; dy = rnd() - 0.5; d2 = 1; }
      const d = Math.sqrt(d2), f = ((K * K) / d2) * heat;
      p.vx += (dx / d) * f; p.vy += (dy / d) * f; q.vx -= (dx / d) * f; q.vy -= (dy / d) * f;
    }
  }
  for (const [a, b] of EDGES) {
    const p = N.get(a), q = N.get(b);
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
    const f = ((d * d) / (K * 30)) * heat;
    p.vx += (dx / d) * f; p.vy += (dy / d) * f; q.vx -= (dx / d) * f; q.vy -= (dy / d) * f;
  }
  for (const n of ALL) {
    n.vx -= n.x * 0.013 * heat; n.vy -= n.y * 0.013 * heat;
    n.x += Math.max(-18, Math.min(18, n.vx)); n.y += Math.max(-18, Math.min(18, n.vy));
  }
}
let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
for (const n of ALL) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
const pos = {};
for (const n of ALL) pos[n.id] = [+((n.x - x0) / (x1 - x0)).toFixed(4), +((n.y - y0) / (y1 - y0)).toFixed(4)];

const out = {
  aspect: +((x1 - x0) / (y1 - y0)).toFixed(4),
  papers, models, articles, cites, describes, pos
};
const js = `/* 자동 생성 파일. 직접 고치지 마라.
   생성: node tools/build-corpus.mjs
   safari.html 의 PAPERS / MODELS / ARTICLES / CITE_SRC 를 그대로 옮긴 것이다 (논문 ${papers.length} · 모델 ${models.length} · 아티클 ${articles.length} · 인용 ${cites.length}).
   pos 는 0~1 로 정규화한 포스 레이아웃 좌표. */
window.CORPUS = ${JSON.stringify(out)};
`;
writeFileSync(join(ROOT, "assets", "corpus.js"), js);
console.log(`assets/corpus.js: 논문 ${papers.length} · 모델 ${models.length} · 아티클 ${articles.length} · 인용 ${cites.length} · describes ${describes.length}`);
