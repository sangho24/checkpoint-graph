#!/usr/bin/env node
/* 커버리지 · 참고문헌 밀도 · 도달률 상한.
   RESULTS.md 의 앞 세 절에 들어갈 수치를 낸다.
   사용법: node backtest/coverage.mjs [--json] */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PAPERS, CACHE_DIR } from "./data.mjs";
import {
  graphHand, graphOpenAlex, censor, makeFolds, candidatePool, quantile, mean
} from "./engine.mjs";
import { readFileSync } from "node:fs";

const JSON_OUT = process.argv.includes("--json");
const out = [];
const say = (...a) => { const l = a.join(" "); out.push(l); console.log(l); };
const pct = (a, b) => b ? `${a}/${b} (${(100 * a / b).toFixed(1)}%)` : "n/a";

/* ─────────────── 1. 커버리지 ─────────────── */
const cache = JSON.parse(readFileSync(join(CACHE_DIR, "openalex-works.json"), "utf8"));
const works = cache.works;
const resolved = works.filter(w => w.resolved);
const strict = resolved.filter(w => w.match && w.match.strict_ok);
const arxivConfirmed = resolved.filter(w => w.match && w.match.arxiv_confirmed);

say("═".repeat(78));
say("1. 커버리지 - OpenAlex 에서 78편이 올바르게 해소되는가");
say("═".repeat(78));
say(`대상 논문            : ${PAPERS.length}편`);
say(`해소 성공(제목 또는 arXiv id) : ${pct(resolved.length, works.length)}`);
say(`  + 연도(±1년)까지 통과       : ${pct(strict.length, works.length)}`);
say(`arXiv id 로 확증             : ${pct(arxivConfirmed.length, works.length)}   (DOI/랜딩 URL 에 arXiv id 실재)`);
// 주의: fetch 쪽 판정은 arXiv id 확증이 제목 검증을 덮어쓴다. 제목만으로 다시 세면 이렇게 된다.
const titleStrict = resolved.filter(w => w.match.f1 >= 0.6 && w.match.coverage >= 0.75);
const titleYearStrict = titleStrict.filter(w => w.match.year_ok);
say(`제목만으로 재판정            : ${pct(titleStrict.length, works.length)}   (arXiv id 확증을 빼고 제목 F1>=0.6 & 커버리지>=0.75 만)`);
say(`제목+연도로 재판정           : ${pct(titleYearStrict.length, works.length)}   <- 가장 보수적인 커버리지`);
say("");
say("해소 실패 목록:");
for (const w of works.filter(w => !w.resolved))
  say(`  - ${w.node_id.padEnd(12)} ${w.query_title.slice(0, 46).padEnd(48)} 사유: ${w.fail_reason}`);
say("");
say("연도가 어긋난(=메타데이터가 깨진) 해소 건:");
const yearBad = resolved.filter(w => !w.match.year_ok);
if (!yearBad.length) say("  없음");
for (const w of yearBad)
  say(`  - ${w.node_id.padEnd(12)} PAPERS ${w.query_year} vs OpenAlex ${w.work.publication_year} (${w.work.publication_date}) · 피인용 ${w.work.cited_by_count}`);
say("");
say("제목이 어긋나는데도 해소로 잡힌 건 (arXiv id 확증이 제목 검증을 덮어쓴 경우):");
const titleBad = resolved.filter(w => w.match.f1 < 0.6);
say(`  ${titleBad.length}건 / 해소 ${resolved.length}건`);
for (const w of titleBad.sort((a, b) => a.match.f1 - b.match.f1)) {
  const arxDoi = (w.work.doi || "").includes(`10.48550/arxiv.${(w.query_arxiv || "").toLowerCase()}`);
  say(`  - ${w.node_id.padEnd(10)} F1 ${String(w.match.f1).padEnd(6)} 연도차 ${String(w.match.year_diff).padEnd(3)} arXiv DOI ${arxDoi ? "일치" : "불일치(" + (w.work.doi || "null").replace("https://doi.org/", "") + ")"}`);
  say(`      질의: ${w.query_title.slice(0, 62)}`);
  say(`      OA  : ${(w.work.display_name || "").slice(0, 62)}`);
}
say("  ※ 출판일·참고문헌·arXiv id 는 맞는데 display_name 만 다른 논문 것인 레코드가 섞여 있다.");
say("    그래프 구성에는 display_name 을 쓰지 않으므로 백테스트 결과에는 영향이 없지만,");
say("    제목을 화면에 띄우는 제품 코드에서는 그대로 쓰면 안 된다.");
say("");
say("어느 해소 전략이 먹혔는가 (채택된 전략 기준):");
const byStrat = {};
for (const w of resolved) byStrat[w.resolved_by] = (byStrat[w.resolved_by] || 0) + 1;
for (const [k, v] of Object.entries(byStrat).sort((a, b) => b[1] - a[1])) say(`  ${k.padEnd(20)} ${v}편`);
say("");
say("전략별 단독 성공률 (1차 실행에서 예산 소진 전까지 실제로 시도된 건에 한함):");
const tried = {}, hit = {};
for (const w of works) for (const a of w.attempts || []) {
  if (!a.ok) continue;
  tried[a.strategy] = (tried[a.strategy] || 0) + 1;
  if (a.title_ok) hit[a.strategy] = (hit[a.strategy] || 0) + 1;
}
for (const k of Object.keys(tried).sort())
  say(`  ${k.padEnd(20)} ${String(hit[k] || 0).padStart(3)}/${String(tried[k]).padStart(3)} 성공`);

/* ─────────────── 2. 참고문헌 밀도 ─────────────── */
say("");
say("═".repeat(78));
say("2. 참고문헌 밀도 - OpenAlex 가 referenced_works 를 실제로 갖고 있는가");
say("═".repeat(78));
const refCounts = resolved.map(w => w.work.referenced_works.length);
const nonEmpty = refCounts.filter(c => c > 0);
say(`referenced_works 가 비어있지 않은 비율 : ${pct(nonEmpty.length, resolved.length)}`);
say(`논문당 참고문헌 수 중앙값 (전체)       : ${quantile(refCounts, 0.5)}`);
say(`논문당 참고문헌 수 중앙값 (비어있지 않은 것만): ${quantile(nonEmpty, 0.5)}`);
say(`Q1 / Q3 (전체)                          : ${quantile(refCounts, 0.25)} / ${quantile(refCounts, 0.75)}`);
say("");
say("발표 연도별 referenced_works 보유율:");
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

/* ─────────────── 3. 그래프 비교 ─────────────── */
const gHand = graphHand();
const gOA = graphOpenAlex();
say("");
say("═".repeat(78));
say("3. 두 그래프 조건의 규모 비교");
say("═".repeat(78));
say(`${"".padEnd(22)} ${"노드".padStart(6)} ${"엣지".padStart(6)} ${"평균차수".padStart(9)} ${"고립노드".padStart(9)}`);
for (const [label, g] of [["조건 B (손으로 만든)", gHand], ["조건 A (OpenAlex)", gOA]]) {
  if (!g) { say(`${label.padEnd(22)}  (캐시 없음)`); continue; }
  let iso = 0, degSum = 0;
  for (const id of g.nodes.keys()) { const d = (g.ADJ.get(id) || []).length; degSum += d; if (!d) iso++; }
  say(`${label.padEnd(22)} ${String(g.nodes.size).padStart(6)} ${String(g.edges.length).padStart(6)} ${(degSum / g.nodes.size).toFixed(2).padStart(9)} ${String(iso).padStart(9)}`);
}

/* ─────────────── 4. 도달률 상한 ─────────────── */
say("");
say("═".repeat(78));
say("4. 도달률 상한 - 시간 검열된 그래프에서 홀드아웃이 시드 K홉 안에 있는가");
say("═".repeat(78));
say("이 값이 랭킹 알고리즘의 천장이다. 여기 못 들어오면 어떤 방법도 그것을 맞힐 수 없다.");
say("");

const conditions = [
  { label: "B  손그래프 · 읽은시각 타임라인", g: gHand, mode: "year", timeline: "read" },
  { label: "B' 손그래프 · 출판일 타임라인", g: gHand, mode: "year", timeline: "pubdate" },
  { label: "A  OpenAlex · 읽은시각 타임라인", g: gOA, mode: "date", timeline: "read" },
  { label: "A' OpenAlex · 출판일 타임라인", g: gOA, mode: "date", timeline: "pubdate" }
];

const reachRows = [];
for (const c of conditions) {
  if (!c.g) continue;
  const { folds } = makeFolds({ timeline: c.timeline, graph: c.g });
  let inGraph = 0, h1 = 0, h2 = 0, h3 = 0, censoredOut = 0, notInGraph = 0, poolSizes = [], removedNodes = [];
  for (const f of folds) {
    const cg = censor(c.g, f.cutoff, c.mode);
    removedNodes.push(c.g.nodes.size - cg.nodes.size);
    if (!c.g.nodes.has(f.truth.node_id)) { notInGraph++; continue; }   // 애초에 그래프에 없다 (해소 실패/고립 유형)
    if (!cg.nodes.has(f.truth.node_id)) { censoredOut++; continue; }   // 시간 검열로 제거됐다
    inGraph++;
    const seedIds = f.seeds.map(s => s.node_id);
    const { pool, dist } = candidatePool(cg, seedIds, 3);
    poolSizes.push(pool.length);
    const d = dist.get(f.truth.node_id);
    if (d === 1) h1++;
    if (d != null && d <= 2) h2++;
    if (d != null && d <= 3) h3++;
  }
  const n = folds.length;
  reachRows.push({ label: c.label, n, censoredOut, notInGraph, h1, h2, h3, pool: poolSizes, removed: removedNodes });
  say(`${c.label}`);
  say(`  폴드 수 ${n} · 정답이 그래프에 아예 없음 ${notInGraph} · 시간 검열로 제거됨 ${censoredOut} · 컷오프당 제거 노드 중앙값 ${quantile(removedNodes, 0.5)}`);
  say(`  1홉 이내 : ${pct(h1, n)}`);
  say(`  2홉 이내 : ${pct(h2, n)}   <- 도달률 상한(2홉)`);
  say(`  3홉 이내 : ${pct(h3, n)}   <- 도달률 상한(3홉) = 후보 풀에 정답이 들어있는 비율`);
  say(poolSizes.length
    ? `  후보 풀 크기: 중앙값 ${quantile(poolSizes, 0.5)} · 최소 ${Math.min(...poolSizes)} · 최대 ${Math.max(...poolSizes)} (전체 노드 ${c.g.nodes.size})`
    : `  후보 풀 크기: 측정 불가 (평가 가능한 폴드가 0개)`);
  say("");
}

if (JSON_OUT) {
  const p = join(CACHE_DIR, "coverage.json");
  writeFileSync(p, JSON.stringify({
    coverage: {
      total: works.length, resolved: resolved.length, strict: strict.length,
      arxiv_confirmed: arxivConfirmed.length,
      failures: works.filter(w => !w.resolved).map(w => ({ id: w.node_id, reason: w.fail_reason })),
      year_mismatch: yearBad.map(w => ({ id: w.node_id, ours: w.query_year, oa: w.work.publication_year }))
    },
    ref_density: {
      non_empty: nonEmpty.length, of: resolved.length,
      median_all: quantile(refCounts, 0.5), median_non_empty: quantile(nonEmpty, 0.5),
      by_year: Object.fromEntries([...byYear].map(([y, b]) => [y, b]))
    },
    reach: reachRows.map(r => ({
      label: r.label, folds: r.n, censored_out: r.censoredOut, not_in_graph: r.notInGraph,
      hop1: r.h1, hop2: r.h2, hop3: r.h3,
      pool_median: r.pool.length ? quantile(r.pool, 0.5) : null,
      pool_min: r.pool.length ? Math.min(...r.pool) : null,
      pool_max: r.pool.length ? Math.max(...r.pool) : null
    }))
  }, null, 2));
  console.log(`\nJSON 저장: ${p}`);
}
