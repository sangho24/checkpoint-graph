#!/usr/bin/env node
/* 프로토타입 페이지들이 읽는 코퍼스 파일 생성기 (v2).

   원천 두 개를 합친다.
     - 손 코퍼스: safari.html 의 PAPERS / MODELS / ARTICLES / CITE_SRC (backtest/data.mjs 로 읽는다. safari.html 은 건드리지 않는다)
     - 1홉 확장: backtest/cache/s2-expanded.json (tools/expand-corpus.mjs 산출물. Semantic Scholar 참고문헌·피인용 1홉)
   손 코퍼스 89개는 id 를 그대로 쓰고 seed:true · hop:0. 확장 논문은 id 가 p_<arXiv id> 이고 hop:1.
   세부 주제(topic)는 손 코퍼스의 값을 슬러그로 쓰고, 확장 논문은 코퍼스 안 시드 이웃의 다수결로 정한다.
   포스 레이아웃 좌표는 결정적(고정 시드 난수)으로 한 번 계산해 둔다. 시각 필드는 넣지 않는다 (재생성이 같아야 한다).

   실행: node tools/build-corpus.mjs [--hand-only]
     --hand-only  확장 없이 손 코퍼스 89개만 (백테스트·회귀 비교용). 스키마는 같다.
   출력: assets/corpus.js (window.CORPUS) */

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, CACHE_DIR, PAPERS, MODELS, ARTICLES, handCitations } from "../backtest/data.mjs";

const HAND_ONLY = process.argv.includes("--hand-only");
const EXPANDED = join(CACHE_DIR, "s2-expanded.json");

/* 세부 주제 라벨 (PAPERS 의 topic 값 기준) */
const TOPIC_LABEL = {
  arch: "언어 모델·아키텍처", moe: "MoE·조건부 계산", eff: "어텐션 효율·서빙", align: "정렬·RLHF",
  reason: "추론·프롬프팅", rag: "검색·RAG", ssm: "상태공간모델·RNN", sys: "분산 학습 시스템",
  scale: "스케일링 법칙", eval: "벤치마크·평가", opt: "최적화기", vis: "비전·생성·음성"
};
/* arXiv primary category 라벨 */
const CAT_LABEL = {
  "cs.CL": "자연어 처리", "cs.LG": "기계학습", "cs.CV": "컴퓨터 비전", "cs.AI": "인공지능", "cs.IR": "정보 검색",
  "cs.DC": "분산·병렬 컴퓨팅", "cs.NE": "신경·진화 계산", "cs.SE": "소프트웨어 공학", "cs.SD": "음향", "eess.AS": "음성",
  "stat.ML": "통계적 기계학습", "cs.CR": "보안", "cs.HC": "HCI", "cs.RO": "로보틱스", "cs.PL": "프로그래밍 언어",
  "cs.DS": "알고리즘", "cs.AR": "컴퓨터 구조", "cs.MA": "멀티에이전트", "cs.CY": "컴퓨터와 사회", "cs.DB": "데이터베이스",
  "math.OC": "최적화", "eess.IV": "영상 처리", "cs.GR": "그래픽스", "cs.MM": "멀티미디어", "cs.LO": "논리", "cs.GT": "게임 이론"
};
const normArxiv = a => a ? String(a).trim().toLowerCase().replace(/v\d+$/, "") : null;

/* ── 손 코퍼스 ── */
const nodes = new Map();      // id -> node
const handByArxiv = new Map(); // arXiv id -> hand node id
for (const [id, title, year, arxiv, cites, topic] of PAPERS) {
  const a = normArxiv(arxiv);
  nodes.set(id, { id, kind: "paper", title, year: +year, date: null, arxiv: a, cites: +cites, topic, cat: null, seed: true, hop: 0 });
  if (a) handByArxiv.set(a, id);
}
for (const [id, name, paper] of MODELS) {
  const p = nodes.get(paper);
  nodes.set(id, { id, kind: "model", title: name, year: p ? p.year : 2024, date: null, arxiv: null, cites: 0, topic: p ? p.topic : null, cat: null, seed: true, hop: 0 });
}
for (const [id, title, host, year] of ARTICLES)
  nodes.set(id, { id, kind: "article", title, year: +year, date: null, arxiv: null, cites: 0, topic: null, cat: null, seed: true, hop: 0 });

const edgeSet = new Set();
const edges = [];
function addEdge(from, to, type) {
  if (!nodes.has(from) || !nodes.has(to) || from === to) return false;
  const k = `${type}|${from}|${to}`;
  if (edgeSet.has(k)) return false;
  edgeSet.add(k); edges.push({ from, to, type }); return true;
}
for (const { from, to } of handCitations()) addEdge(from, to, "cites");
for (const [id, , paper] of MODELS) addEdge(id, paper, "describes");
const handEdgeCount = edges.length;

/* ── 1홉 확장 ── */
let expanded = null, expandStats = null;
if (!HAND_ONLY) {
  if (!existsSync(EXPANDED)) { console.error(`확장 캐시가 없다: ${EXPANDED}. 먼저 node tools/expand-corpus.mjs 를 돌리거나 --hand-only 로 실행하라.`); process.exit(1); }
  expanded = JSON.parse(readFileSync(EXPANDED, "utf8"));
  if (expanded.partial) console.warn(`주의: 확장 캐시가 partial 상태다 (단계 ${expanded.stage_done}). 있는 것만으로 만든다.`);
  const keyToNode = new Map();  // 확장 캐시의 키(arXiv id 또는 s2:<id>) -> 노드 id
  const seedKeyToNode = new Map(expanded.seeds.map(s => [s.key, s.node_id]));
  let newRef = 0, newCit = 0, newBoth = 0, skippedNoMeta = 0;
  for (const p of expanded.papers) {
    const key = p.arxiv || `s2:${p.s2_id}`;
    if (p.hop === 0 || seedKeyToNode.has(key) || (p.arxiv && handByArxiv.has(p.arxiv))) {
      // 시드: 손 노드에 날짜·카테고리만 보탠다 (제목은 손 코퍼스의 축약 제목을 유지)
      const nid = seedKeyToNode.get(key) || handByArxiv.get(p.arxiv);
      if (nid && nodes.has(nid)) { const n = nodes.get(nid); n.date = p.date || null; n.cat = p.cat || null; keyToNode.set(key, nid); }
      continue;
    }
    if (!p.title || !p.year) { skippedNoMeta++; continue; }
    const id = `p_${p.arxiv}`;
    nodes.set(id, { id, kind: "paper", title: p.title, year: p.year, date: p.date || null, arxiv: p.arxiv, cites: p.cites || 0, topic: null, cat: p.cat || null, seed: false, hop: 1 });
    keyToNode.set(key, id);
    if (p.via === "ref") newRef++; else if (p.via === "cit") newCit++; else newBoth++;
  }
  let s2Edges = 0, s2EdgesOverlapHand = 0;
  for (const p of expanded.papers) {
    const key = p.arxiv || `s2:${p.s2_id}`;
    const from = keyToNode.get(key);
    if (!from) continue;
    for (const r of (p.refs_in_corpus || [])) {
      const to = keyToNode.get(r);
      if (!to) continue;
      if (edgeSet.has(`cites|${from}|${to}`)) { s2EdgesOverlapHand++; continue; }
      if (addEdge(from, to, "cites")) s2Edges++;
    }
  }
  expandStats = { newRef, newCit, newBoth, skippedNoMeta, s2Edges, s2EdgesOverlapHand };
}

/* ── 세부 주제 추론: 코퍼스 안 시드 이웃의 다수결, 동률이면 피인용 높은 이웃 쪽 ── */
const adj = new Map();
for (const id of nodes.keys()) adj.set(id, []);
for (const e of edges) { adj.get(e.from).push(e.to); adj.get(e.to).push(e.from); }
for (const n of nodes.values()) {
  if (n.seed || n.topic) continue;
  const votes = new Map();   // topic -> { count, maxCites }
  for (const m of adj.get(n.id)) {
    const q = nodes.get(m);
    if (!q.seed || !q.topic) continue;
    const v = votes.get(q.topic) || { count: 0, maxCites: 0 };
    v.count++; v.maxCites = Math.max(v.maxCites, q.cites); votes.set(q.topic, v);
  }
  let best = null;
  for (const [t, v] of votes) if (!best || v.count > best.v.count || (v.count === best.v.count && v.maxCites > best.v.maxCites)) best = { t, v };
  n.topic = best ? best.t : null;
}

/* ── 포스 레이아웃 (결정적 난수, O(n²) 반발) ── */
const ALL = [...nodes.values()];
const n = ALL.length;
const idx = new Map(ALL.map((v, i) => [v.id, i]));
const X = new Float64Array(n), Y = new Float64Array(n), VX = new Float64Array(n), VY = new Float64Array(n);
let seed = 20260904;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const R0 = 220 + 40 * Math.sqrt(n);
for (let i = 0; i < n; i++) { const a = rnd() * 6.2832, r = R0 * (0.3 + 0.7 * rnd()); X[i] = Math.cos(a) * r; Y[i] = Math.sin(a) * r; }
const EF = edges.map(e => idx.get(e.from)), ET = edges.map(e => idx.get(e.to));
const K = n <= 120 ? 118 : Math.max(28, 118 * Math.sqrt(89 / n) * 1.6);
const STEPS = n <= 120 ? 420 : (n <= 1500 ? 300 : 220);
const MAXV = n <= 120 ? 18 : 12;
const tLayout = Date.now();
for (let it = 0; it < STEPS; it++) {
  const heat = 1 - (it / STEPS) * 0.86;
  for (let i = 0; i < n; i++) { VX[i] *= 0.85; VY[i] *= 0.85; }
  const K2 = K * K;
  for (let i = 0; i < n; i++) {
    const xi = X[i], yi = Y[i];
    let fx = 0, fy = 0;
    for (let j = i + 1; j < n; j++) {
      let dx = xi - X[j], dy = yi - Y[j], d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = rnd() - 0.5; dy = rnd() - 0.5; d2 = 1; }
      if (d2 > 4e6) continue;                         // 먼 쌍은 반발이 무시할 만하다
      const inv = (K2 / d2) * heat / Math.sqrt(d2);
      const gx = dx * inv, gy = dy * inv;
      fx += gx; fy += gy; VX[j] -= gx; VY[j] -= gy;
    }
    VX[i] += fx; VY[i] += fy;
  }
  for (let e = 0; e < EF.length; e++) {
    const a = EF[e], b = ET[e];
    const dx = X[b] - X[a], dy = Y[b] - Y[a], d = Math.hypot(dx, dy) || 1;
    const f = ((d * d) / (K * 30)) * heat;
    VX[a] += (dx / d) * f; VY[a] += (dy / d) * f; VX[b] -= (dx / d) * f; VY[b] -= (dy / d) * f;
  }
  for (let i = 0; i < n; i++) {
    VX[i] -= X[i] * 0.013 * heat; VY[i] -= Y[i] * 0.013 * heat;
    X[i] += Math.max(-MAXV, Math.min(MAXV, VX[i])); Y[i] += Math.max(-MAXV, Math.min(MAXV, VY[i]));
  }
}
const layoutSec = ((Date.now() - tLayout) / 1000).toFixed(1);
let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
for (let i = 0; i < n; i++) { x0 = Math.min(x0, X[i]); y0 = Math.min(y0, Y[i]); x1 = Math.max(x1, X[i]); y1 = Math.max(y1, Y[i]); }
for (let i = 0; i < n; i++) { ALL[i].x = +((X[i] - x0) / (x1 - x0)).toFixed(4); ALL[i].y = +((Y[i] - y0) / (y1 - y0)).toFixed(4); }

/* ── 집계 ── */
const topicCount = new Map(), catCount = new Map();
let ymin = 9999, ymax = 0;
for (const v of ALL) {
  if (v.topic) topicCount.set(v.topic, (topicCount.get(v.topic) || 0) + 1);
  if (v.cat) catCount.set(v.cat, (catCount.get(v.cat) || 0) + 1);
  if (v.year) { ymin = Math.min(ymin, v.year); ymax = Math.max(ymax, v.year); }
}
const topics = Object.keys(TOPIC_LABEL).map(slug => ({ slug, label: TOPIC_LABEL[slug], count: topicCount.get(slug) || 0 })).filter(t => t.count > 0);
const cats = [...catCount].sort((a, b) => b[1] - a[1]).map(([cat, count]) => ({ cat, label: CAT_LABEL[cat] || cat, count }));
const out = {
  version: 2,
  aspect: +((x1 - x0) / (y1 - y0)).toFixed(4),
  nodes: ALL, edges, topics, cats,
  years: { min: ymin, max: ymax },
  stats: { nodes: n, edges: edges.length, seed_nodes: ALL.filter(v => v.seed).length, hop1_nodes: ALL.filter(v => v.hop === 1).length, hand_edges: handEdgeCount }
};
const js = `/* 자동 생성 파일. 직접 고치지 마라.
   생성: node tools/build-corpus.mjs${HAND_ONLY ? " --hand-only" : ""}
   손 코퍼스(safari.html) ${out.stats.seed_nodes}개${HAND_ONLY ? "" : ` + Semantic Scholar 1홉 확장 ${out.stats.hop1_nodes}개`} · 엣지 ${edges.length}.
   x, y 는 0~1 로 정규화한 포스 레이아웃 좌표. */
window.CORPUS = ${JSON.stringify(out)};
`;
writeFileSync(join(ROOT, "assets", "corpus.js"), js);
let iso = 0, degSum = 0;
for (const id of nodes.keys()) { const d = adj.get(id).length; degSum += d; if (!d) iso++; }
console.log(`assets/corpus.js: 노드 ${n} (시드 ${out.stats.seed_nodes} · 확장 ${out.stats.hop1_nodes}) · 엣지 ${edges.length} (손 ${handEdgeCount}) · 평균 차수 ${(degSum / n).toFixed(2)} · 고립 ${iso} · 레이아웃 ${layoutSec}s · ${(js.length / 1024).toFixed(0)} KB`);
if (expandStats) console.log(`확장: 참고문헌 경로 ${expandStats.newRef} · 피인용 경로 ${expandStats.newCit} · 둘 다 ${expandStats.newBoth} · 메타 없어 제외 ${expandStats.skippedNoMeta} · S2 엣지 ${expandStats.s2Edges} (손 엣지와 겹침 ${expandStats.s2EdgesOverlapHand})`);
console.log(`주제: ${topics.map(t => `${t.slug} ${t.count}`).join(" · ")}`);
console.log(`카테고리 상위: ${cats.slice(0, 8).map(c => `${c.cat} ${c.count}`).join(" · ")} · 연도 ${ymin}~${ymax}`);
