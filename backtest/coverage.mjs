#!/usr/bin/env node
/* 커버리지 · 참고문헌 밀도 · 도달률 상한.
   RESULTS.md 의 앞 세 절에 들어갈 수치를 낸다.
   실제 인용 원천이 둘이다: OpenAlex(조건 A) 와 Semantic Scholar(조건 S).
   캐시가 있는 원천마다 같은 절차를 돌리고, 마지막에 나란히 비교한다.
   사용법: node backtest/coverage.mjs [--json] */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PAPERS, CACHE_DIR, readingHistory } from "./data.mjs";
import {
  graphHand, graphFromCache, censor, makeFolds, candidatePool, quantile
} from "./engine.mjs";

const JSON_OUT = process.argv.includes("--json");
const out = [];
const say = (...a) => { const l = a.join(" "); out.push(l); console.log(l); };
const pct = (a, b) => b ? `${a}/${b} (${(100 * a / b).toFixed(1)}%)` : "n/a";
const pctOnly = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : "n/a";
const CUT_YEAR = 2022;   // OpenAlex 에서 절벽이 관찰된 경계 연도

/* ─────────────── 원천 정의 ─────────────── */
const SOURCES = [
  { key: "openalex", cond: "A", label: "OpenAlex", file: "openalex-works.json" },
  { key: "s2", cond: "S", label: "Semantic Scholar", file: "semanticscholar-works.json" }
].filter(s => existsSync(join(CACHE_DIR, s.file)));

/* ─────────────── 원천 하나를 분석한다 (1. 커버리지, 2. 참고문헌 밀도) ─────────────── */
function analyzeSource(src) {
  const cache = JSON.parse(readFileSync(join(CACHE_DIR, src.file), "utf8"));
  if (cache.partial) { say(`※ ${src.label} 캐시가 partial 상태다. 수집을 끝낸 뒤 다시 돌려라.`); return null; }
  const works = cache.works;
  const resolved = works.filter(w => w.resolved && w.work);
  const strict = resolved.filter(w => w.match && w.match.strict_ok);
  const arxivConfirmed = resolved.filter(w => w.match && w.match.arxiv_confirmed);
  // 주의: fetch 쪽 판정은 arXiv id 확증이 제목 검증을 덮어쓴다. 제목만으로 다시 세면 이렇게 된다.
  const titleStrict = resolved.filter(w => w.match.f1 >= 0.6 && w.match.coverage >= 0.75);
  const titleYearStrict = titleStrict.filter(w => w.match.year_ok);
  const conflicts = resolved.filter(w => w.match.arxiv_confirmed && !(w.match.f1 >= 0.6 && w.match.coverage >= 0.75));
  const yearBad = resolved.filter(w => !w.match.year_ok);
  const dateNull = resolved.filter(w => !w.work.publication_date);

  say("═".repeat(78));
  say(`1. 커버리지 (${src.label}) - 78편이 올바르게 해소되는가`);
  say("═".repeat(78));
  say(`대상 논문            : ${PAPERS.length}편`);
  say(`해소 성공(제목 또는 arXiv id) : ${pct(resolved.length, works.length)}`);
  say(`  + 연도(±1년)까지 통과       : ${pct(strict.length, works.length)}`);
  say(`arXiv id 로 확증             : ${pct(arxivConfirmed.length, works.length)}   (원천의 식별자에 우리 arXiv id 실재)`);
  say(`제목만으로 재판정            : ${pct(titleStrict.length, works.length)}   (arXiv id 확증을 빼고 제목 F1>=0.6 & 커버리지>=0.75 만)`);
  say(`제목+연도로 재판정           : ${pct(titleYearStrict.length, works.length)}   <- 가장 보수적인 커버리지`);
  say("");
  say("해소 실패 목록:");
  const failures = works.filter(w => !w.resolved);
  if (!failures.length) say("  없음");
  for (const w of failures)
    say(`  - ${w.node_id.padEnd(12)} ${w.query_title.slice(0, 46).padEnd(48)} 사유: ${w.fail_reason}`);
  say("");
  say("연도가 어긋난(=메타데이터가 깨진) 해소 건:");
  if (!yearBad.length) say("  없음");
  for (const w of yearBad)
    say(`  - ${w.node_id.padEnd(12)} PAPERS ${w.query_year} vs ${src.label} ${w.work.publication_year} (${w.work.publication_date}) · 피인용 ${w.work.cited_by_count}`);
  say("");
  say(`출판일(publication_date) 이 비어 있는 해소 건: ${dateNull.length}건${dateNull.length ? " (" + dateNull.map(w => w.node_id).join(", ") + ")" : ""}`);
  say("  ※ 날짜가 없으면 시간 검열에서 제거되지 않고(항상 살아남고) 최근성 베이스라인에서는 바닥으로 간다.");
  say("");
  say("id 는 맞는데 제목이 다른 논문인 레코드 (conflict: arXiv 확증 O · 제목 검증 X):");
  say(`  ${conflicts.length}건 / 해소 ${resolved.length}건`);
  for (const w of conflicts.sort((a, b) => a.match.f1 - b.match.f1)) {
    say(`  - ${w.node_id.padEnd(10)} F1 ${String(w.match.f1).padEnd(6)} 연도차 ${String(w.match.year_diff).padEnd(3)} 근거 ${JSON.stringify(w.match.arxiv_evidence || {}).slice(0, 70)}`);
    say(`      질의: ${w.query_title.slice(0, 62)}`);
    say(`      원천: ${(w.work.display_name || "").slice(0, 62)}`);
  }
  if (conflicts.length)
    say("  ※ 그래프 구성에는 display_name 을 쓰지 않으므로 백테스트에는 영향이 없지만, 제목을 화면에 띄우는 코드에서는 그대로 쓰면 안 된다.");
  say("");
  say("제목 검증만 통과하고 arXiv 확증은 없는 건 (arXiv id 가 없거나 원천이 다른 판을 돌려준 경우):");
  const titleOnly = resolved.filter(w => !w.match.arxiv_confirmed);
  if (!titleOnly.length) say("  없음");
  for (const w of titleOnly)
    say(`  - ${w.node_id.padEnd(12)} F1 ${String(w.match.f1).padEnd(6)} 연도차 ${String(w.match.year_diff).padEnd(3)} 우리 arXiv ${w.query_arxiv || "(없음)"} · 원천 식별자 ${JSON.stringify(w.match.arxiv_evidence || w.work.external_ids || {}).slice(0, 60)}`);
  say("");
  say("어느 해소 전략이 먹혔는가 (채택된 전략 기준):");
  const byStrat = {};
  for (const w of resolved) byStrat[w.resolved_by] = (byStrat[w.resolved_by] || 0) + 1;
  for (const [k, v] of Object.entries(byStrat).sort((a, b) => b[1] - a[1])) say(`  ${k.padEnd(20)} ${v}편`);
  say("");
  say("전략별 단독 성공률 (실제로 시도된 건에 한함):");
  const tried = {}, hit = {}, hitTitle = {};
  for (const w of works) for (const a of w.attempts || []) {
    if (!a.ok) continue;
    tried[a.strategy] = (tried[a.strategy] || 0) + 1;
    if (a.title_ok) hit[a.strategy] = (hit[a.strategy] || 0) + 1;
    if (a.title_ok && a.year_diff != null && a.year_diff <= 1) hitTitle[a.strategy] = (hitTitle[a.strategy] || 0) + 1;
  }
  for (const k of Object.keys(tried).sort())
    say(`  ${k.padEnd(20)} ${String(hit[k] || 0).padStart(3)}/${String(tried[k]).padStart(3)} 성공 (연도까지 ${String(hitTitle[k] || 0).padStart(3)})`);
  if (cache.stats)
    say(`\n수집 통계: 요청 ${cache.stats.requests}건 · 재시도 ${cache.stats.retries ?? "-"} · 429 ${cache.stats.rate_limited ?? "-"}회 · 오류 ${cache.stats.errors ?? "-"} · ${cache.stats.elapsed_sec}s · 수집 ${cache.fetched_at}`);

  /* ─────────────── 2. 참고문헌 밀도 ─────────────── */
  say("");
  say("═".repeat(78));
  say(`2. 참고문헌 밀도 (${src.label}) - 참고문헌을 실제로 갖고 있는가`);
  say("═".repeat(78));
  const refCounts = resolved.map(w => w.work.referenced_works.length);
  const nonEmpty = refCounts.filter(c => c > 0);
  say(`참고문헌이 비어있지 않은 비율          : ${pct(nonEmpty.length, resolved.length)}`);
  say(`논문당 참고문헌 수 중앙값 (전체)       : ${quantile(refCounts, 0.5)}`);
  say(`논문당 참고문헌 수 중앙값 (비어있지 않은 것만): ${nonEmpty.length ? quantile(nonEmpty, 0.5) : "n/a"}`);
  say(`Q1 / Q3 (전체)                          : ${quantile(refCounts, 0.25)} / ${quantile(refCounts, 0.75)}`);
  // 원천이 "참고문헌 수" 를 따로 알려주는데 실제로 돌려준 목록이 그보다 짧은 경우 (잘린 응답)
  const truncated = resolved.filter(w => w.work.referenced_works_count != null && w.work.references_returned != null
    && w.work.references_returned < w.work.referenced_works_count);
  if (truncated.length)
    say(`참고문헌 수(referenceCount) 보다 실제 반환 목록이 짧은 건: ${truncated.length}건 (${truncated.map(w => `${w.node_id} ${w.work.references_returned}/${w.work.referenced_works_count}`).join(", ")})`);
  // 참고문헌 항목 중 arXiv id 가 붙은 비율 (우리 노드와 arXiv 경로로 이어질 수 있는 비율)
  const refTotal = resolved.reduce((s, w) => s + w.work.referenced_works.length, 0);
  const refArxiv = resolved.reduce((s, w) => s + ((w.work.referenced_arxiv || []).length), 0);
  if (refArxiv) say(`참고문헌 항목 중 arXiv id 가 붙은 비율     : ${pct(refArxiv, refTotal)}`);
  say("");
  say("발표 연도별 참고문헌 보유율 (우리 PAPERS 의 연도 기준):");
  const byYear = new Map();
  for (const w of resolved) {
    const y = w.query_year;
    if (!byYear.has(y)) byYear.set(y, { n: 0, k: 0 });
    const b = byYear.get(y); b.n++; if (w.work.referenced_works.length > 0) b.k++;
  }
  say(`  ${"연도".padEnd(6)} ${"보유".padEnd(10)} 비율`);
  for (const y of [...byYear.keys()].sort()) {
    const b = byYear.get(y);
    const bar = "█".repeat(Math.round(10 * b.k / b.n)) + "·".repeat(10 - Math.round(10 * b.k / b.n));
    say(`  ${String(y).padEnd(6)} ${(b.k + "/" + b.n).padEnd(10)} ${bar} ${(100 * b.k / b.n).toFixed(0)}%`);
  }
  const pre = resolved.filter(w => w.query_year < CUT_YEAR), post = resolved.filter(w => w.query_year >= CUT_YEAR);
  const preK = pre.filter(w => w.work.referenced_works.length > 0).length;
  const postK = post.filter(w => w.work.referenced_works.length > 0).length;
  say(`  ${CUT_YEAR - 1}년 이하: ${pct(preK, pre.length)}   ${CUT_YEAR}년 이후: ${pct(postK, post.length)}`);
  say("");

  return {
    src, cache, works, resolved, strict, arxivConfirmed, titleStrict, titleYearStrict, conflicts, yearBad, dateNull,
    failures, refCounts, nonEmpty, byYear, pre: { n: pre.length, k: preK }, post: { n: post.length, k: postK },
    truncated: truncated.map(w => w.node_id)
  };
}

const analyses = SOURCES.map(analyzeSource).filter(Boolean);

/* ─────────────── 3. 그래프 규모 비교 ─────────────── */
const gHand = graphHand();
const graphs = analyses.map(a => ({ a, g: graphFromCache({ file: a.src.file, name: a.src.key }) }));
const history = readingHistory();

function graphStats(g) {
  let iso = 0, degSum = 0;
  for (const id of g.nodes.keys()) { const d = (g.ADJ.get(id) || []).length; degSum += d; if (!d) iso++; }
  const connected = history.filter(e => (g.ADJ.get(e.node_id) || []).length > 0);
  const disconnected = history.filter(e => !((g.ADJ.get(e.node_id) || []).length > 0)).map(e => e.node_id);
  return {
    nodes: g.nodes.size, edges: g.edges.length, avgDeg: degSum / g.nodes.size, isolated: iso,
    historyConnected: connected.length, historyDisconnected: [...new Set(disconnected)],
    edgeBy: g.meta ? g.meta.edge_by : null
  };
}

say("═".repeat(78));
say("3. 그래프 조건의 규모 비교");
say("═".repeat(78));
say(`${"".padEnd(26)} ${"노드".padStart(6)} ${"엣지".padStart(6)} ${"평균차수".padStart(9)} ${"고립노드".padStart(9)} ${"이력 연결".padStart(10)}`);
const gs = [["조건 B (손으로 만든)", gHand], ...graphs.map(({ a, g }) => [`조건 ${a.src.cond} (${a.src.label})`, g])];
const gStats = new Map();
for (const [label, g] of gs) {
  if (!g) { say(`${label.padEnd(26)}  (캐시 없음)`); continue; }
  const st = graphStats(g); gStats.set(label, st);
  say(`${label.padEnd(26)} ${String(st.nodes).padStart(6)} ${String(st.edges).padStart(6)} ${st.avgDeg.toFixed(2).padStart(9)} ${String(st.isolated).padStart(9)} ${`${st.historyConnected}/${history.length}`.padStart(10)}`);
}
say("  '이력 연결' = 독서 이력 항목 중 그 그래프에서 차수 > 0 인 것");
for (const [label, g] of gs) {
  if (!g || !g.meta) continue;
  const st = gStats.get(label);
  say(`  ${label}: 엣지 매핑 경로 work id ${st.edgeBy.work_id} · arXiv id ${st.edgeBy.arxiv}${st.historyDisconnected.length ? ` · 이력 중 고립 ${st.historyDisconnected.length}건: ${st.historyDisconnected.join(" ")}` : " · 이력 전부 연결"}`);
}

/* ─────────────── 4. 도달률 상한 ─────────────── */
say("");
say("═".repeat(78));
say("4. 도달률 상한 - 시간 검열된 그래프에서 홀드아웃이 시드 K홉 안에 있는가");
say("═".repeat(78));
say("이 값이 랭킹 알고리즘의 천장이다. 여기 못 들어오면 어떤 방법도 그것을 맞힐 수 없다.");
say("");

const conditions = [
  { key: "B", label: "B  손그래프 · 읽은시각 타임라인", g: gHand, mode: "year", timeline: "read" },
  { key: "B'", label: "B' 손그래프 · 출판일 타임라인", g: gHand, mode: "year", timeline: "pubdate" }
];
for (const { a, g } of graphs) {
  conditions.push({ key: a.src.cond, label: `${a.src.cond}  ${a.src.label} · 읽은시각 타임라인`, g, mode: "date", timeline: "read", source: a.src.key });
  conditions.push({ key: a.src.cond + "'", label: `${a.src.cond}' ${a.src.label} · 출판일 타임라인`, g, mode: "date", timeline: "pubdate", source: a.src.key });
}

const reachRows = [];
for (const c of conditions) {
  if (!c.g) continue;
  const { folds } = makeFolds({ timeline: c.timeline, graph: c.g });
  let inGraph = 0, h1 = 0, h2 = 0, h3 = 0, censoredOut = 0, notInGraph = 0, poolSizes = [], removedNodes = [];
  const missing = [];
  for (const f of folds) {
    const cg = censor(c.g, f.cutoff, c.mode);
    removedNodes.push(c.g.nodes.size - cg.nodes.size);
    // 후보 풀은 정답과 무관하게 시드만으로 정해지므로 28폴드 전부에서 센다 (run.mjs 와 같은 정의)
    const seedIds = f.seeds.map(s => s.node_id);
    const { pool, dist } = candidatePool(cg, seedIds, 3);
    poolSizes.push(pool.length);
    if (!c.g.nodes.has(f.truth.node_id)) { notInGraph++; missing.push(f.truth.node_id); continue; }   // 애초에 그래프에 없다 (해소 실패/고립 유형)
    if (!cg.nodes.has(f.truth.node_id)) { censoredOut++; continue; }   // 시간 검열로 제거됐다
    inGraph++;
    const d = dist.get(f.truth.node_id);
    if (d === 1) h1++;
    if (d != null && d <= 2) h2++;
    if (d != null && d <= 3) h3++;
    else missing.push(f.truth.node_id);
  }
  const n = folds.length;
  reachRows.push({ key: c.key, label: c.label, source: c.source || "hand", n, censoredOut, notInGraph, h1, h2, h3, pool: poolSizes, removed: removedNodes, missing });
  say(`${c.label}`);
  say(`  폴드 수 ${n} · 정답이 그래프에 아예 없음 ${notInGraph} · 시간 검열로 제거됨 ${censoredOut} · 컷오프당 제거 노드 중앙값 ${quantile(removedNodes, 0.5)}`);
  say(`  1홉 이내 : ${pct(h1, n)}`);
  say(`  2홉 이내 : ${pct(h2, n)}   <- 도달률 상한(2홉)`);
  say(`  3홉 이내 : ${pct(h3, n)}   <- 도달률 상한(3홉) = 후보 풀에 정답이 들어있는 비율`);
  say(poolSizes.length
    ? `  후보 풀 크기: 중앙값 ${quantile(poolSizes, 0.5)} · 최소 ${Math.min(...poolSizes)} · 최대 ${Math.max(...poolSizes)} (전체 노드 ${c.g.nodes.size})`
    : `  후보 풀 크기: 측정 불가 (평가 가능한 폴드가 0개)`);
  if (missing.length) say(`  도달 불가 정답: ${missing.join(" ")}`);
  say("");
}

/* ─────────────── 5. 두 원천 나란히 비교 ─────────────── */
if (analyses.length >= 1) {
  say("═".repeat(78));
  say("5. 원천 비교 - 같은 78편 · 같은 절차");
  say("═".repeat(78));
  const cols = analyses.map(a => a.src.label);
  const W = 30, C = 22;
  say(`${"항목".padEnd(W)} ${cols.map(c => c.padStart(C)).join(" ")}`);
  say("-".repeat(W + (C + 1) * cols.length));
  const row = (label, vals) => say(`${label.padEnd(W)} ${vals.map(v => String(v).padStart(C)).join(" ")}`);
  row("해소 (id 기준)", analyses.map(a => pct(a.resolved.length, a.works.length)));
  row("제목+연도 보수적 커버리지", analyses.map(a => pct(a.titleYearStrict.length, a.works.length)));
  row("arXiv id 확증", analyses.map(a => pct(a.arxivConfirmed.length, a.works.length)));
  row("id 일치 · 제목 불일치 (conflict)", analyses.map(a => `${a.conflicts.length}건`));
  row("연도 어긋난 건", analyses.map(a => `${a.yearBad.length}건`));
  row("출판일 비어 있는 건", analyses.map(a => `${a.dateNull.length}건`));
  row("참고문헌 비어있지 않은 비율", analyses.map(a => pct(a.nonEmpty.length, a.resolved.length)));
  row("참고문헌 수 중앙값 (전체)", analyses.map(a => quantile(a.refCounts, 0.5)));
  row(`${CUT_YEAR - 1}년 이하 보유율`, analyses.map(a => pct(a.pre.k, a.pre.n)));
  row(`${CUT_YEAR}년 이후 보유율`, analyses.map(a => pct(a.post.k, a.post.n)));
  say("");
  say("연도별 참고문헌 보유율:");
  const years = [...new Set(analyses.flatMap(a => [...a.byYear.keys()]))].sort();
  say(`  ${"연도".padEnd(6)} ${cols.map(c => c.padStart(C)).join(" ")}`);
  for (const y of years)
    say(`  ${String(y).padEnd(6)} ${analyses.map(a => { const b = a.byYear.get(y); return b ? `${b.k}/${b.n} (${(100 * b.k / b.n).toFixed(0)}%)` : "-"; }).map(v => v.padStart(C)).join(" ")}`);
  say("");
  say("그래프:");
  const gRows = graphs.map(({ a, g }) => g ? graphStats(g) : null);
  row("노드", gRows.map(s => s ? s.nodes : "-"));
  row("엣지", gRows.map(s => s ? s.edges : "-"));
  row("평균 차수", gRows.map(s => s ? s.avgDeg.toFixed(2) : "-"));
  row("고립 노드", gRows.map(s => s ? s.isolated : "-"));
  row(`독서 이력 ${history.length}건 중 연결`, gRows.map(s => s ? `${s.historyConnected}/${history.length}` : "-"));
  say("");
  say("도달률 (읽은시각 타임라인, 3홉):");
  const hand = reachRows.find(r => r.key === "B");
  row("손 그래프 (B)", analyses.map(() => pct(hand.h3, hand.n)));
  row("이 원천", analyses.map(a => { const r = reachRows.find(x => x.key === a.src.cond); return r ? pct(r.h3, r.n) : "-"; }));
  row("  1홉 / 2홉 / 3홉", analyses.map(a => { const r = reachRows.find(x => x.key === a.src.cond); return r ? `${r.h1} / ${r.h2} / ${r.h3}` : "-"; }));
  row("  후보 풀 중앙값", analyses.map(a => { const r = reachRows.find(x => x.key === a.src.cond); return r && r.pool.length ? quantile(r.pool, 0.5) : "-"; }));
  say("");
  say("독서 이력 중 그래프에 연결되지 않은 id:");
  for (const { a, g } of graphs) {
    if (!g) continue;
    const st = graphStats(g);
    say(`  ${a.src.label.padEnd(18)} ${st.historyDisconnected.length}건: ${st.historyDisconnected.join(" ") || "(없음)"}`);
  }
}

if (JSON_OUT) {
  const p = join(CACHE_DIR, "coverage.json");
  const perSource = {};
  for (const a of analyses) {
    const g = graphs.find(x => x.a === a).g;
    perSource[a.src.key] = {
      coverage: {
        total: a.works.length, resolved: a.resolved.length, strict: a.strict.length,
        arxiv_confirmed: a.arxivConfirmed.length,
        title_only: a.titleStrict.length, title_year: a.titleYearStrict.length,
        conflicts: a.conflicts.map(w => ({ id: w.node_id, f1: w.match.f1, ours: w.query_title, theirs: w.work.display_name })),
        failures: a.failures.map(w => ({ id: w.node_id, reason: w.fail_reason })),
        year_mismatch: a.yearBad.map(w => ({ id: w.node_id, ours: w.query_year, theirs: w.work.publication_year })),
        date_null: a.dateNull.map(w => w.node_id)
      },
      ref_density: {
        non_empty: a.nonEmpty.length, of: a.resolved.length,
        median_all: quantile(a.refCounts, 0.5), median_non_empty: a.nonEmpty.length ? quantile(a.nonEmpty, 0.5) : null,
        by_year: Object.fromEntries([...a.byYear].map(([y, b]) => [y, b])),
        pre_cut: a.pre, post_cut: a.post, cut_year: CUT_YEAR, truncated: a.truncated
      },
      graph: g ? graphStats(g) : null
    };
  }
  // 과거 호환: 최상위 coverage/ref_density 는 openalex 것을 그대로 둔다
  const legacy = perSource.openalex ? { coverage: perSource.openalex.coverage, ref_density: perSource.openalex.ref_density } : {};
  writeFileSync(p, JSON.stringify({
    ...legacy,
    sources: perSource,
    hand_graph: graphStats(gHand),
    reach: reachRows.map(r => ({
      key: r.key, label: r.label, source: r.source, folds: r.n, censored_out: r.censoredOut, not_in_graph: r.notInGraph,
      hop1: r.h1, hop2: r.h2, hop3: r.h3,
      pool_median: r.pool.length ? quantile(r.pool, 0.5) : null,
      pool_min: r.pool.length ? Math.min(...r.pool) : null,
      pool_max: r.pool.length ? Math.max(...r.pool) : null,
      missing: r.missing
    }))
  }, null, 2));
  console.log(`\nJSON 저장: ${p}`);
}
