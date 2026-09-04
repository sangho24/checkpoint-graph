#!/usr/bin/env node
/* 롤링 오리진 백테스트 + 파라미터 스윕.

   폴드:  entries 를 시각 오름차순 정렬하고 i = 10 .. N-1 에 대해
            시드   = entries[0..i-1]
            정답   = entries[i]
            그래프 = 컷오프 시점으로 시간 검열한 스냅샷
   후보 풀: 시드에서 무방향 3홉 이내, 이미 반응한 노드 제외. 모든 방법이 같은 풀을 쓴다.
   방법:   PPR (허브지수 0/0.5/0.8) x (반감기 30일/90일/없음) 9조합 + 베이스라인 3종
   지표:   MRR, recall@10, recall@50, 도달 불가 비율. 폴드 평균과 산포를 함께 낸다.

   사용법: node backtest/run.mjs [--json] [--detail]
*/

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_DIR } from "./data.mjs";
import {
  graphHand, graphOpenAlex, censor, makeFolds, candidatePool,
  rankPPR, rankCites, rankRecency, rankRefFreq,
  mean, stdev, quantile
} from "./engine.mjs";

const JSON_OUT = process.argv.includes("--json");
const DETAIL = process.argv.includes("--detail");
const lines = [];
const say = (...a) => { const l = a.join(" "); lines.push(l); console.log(l); };

/* ── 방법 정의 ── */
const HUB = [0, 0.5, 0.8];
const HALF = [[30, "30일"], [90, "90일"], [null, "감쇠없음"]];
const METHODS = [];
for (const h of HUB) for (const [hl, hlName] of HALF)
  METHODS.push({
    key: `ppr_deg${h}_${hl == null ? "inf" : hl}`,
    label: `PPR deg^${h} · 반감기 ${hlName}`,
    family: "PPR",
    rank: (g, s, c, pool) => rankPPR(g, s, c, pool, { hubExp: h, halfLife: hl })
  });
METHODS.push({ key: "base_cites", label: "베이스라인: 피인용수 순", family: "baseline", rank: rankCites });
METHODS.push({ key: "base_recency", label: "베이스라인: 최근성 순", family: "baseline", rank: rankRecency });
METHODS.push({
  key: "base_reffreq", label: "베이스라인: 참고문헌 최빈", family: "baseline",
  rank: (g, s, c, pool) => rankRefFreq(g, s, c, pool, { halfLife: 90 })
});

/* ── 한 조건을 돌린다 ── */
function runCondition(cond) {
  const { folds } = makeFolds({ timeline: cond.timeline, graph: cond.g });
  const results = new Map(METHODS.map(m => [m.key, []]));   // key -> [{fold, rank|null}]
  const poolSizes = [];
  let unreachable = 0, evaluated = 0;
  const foldInfo = [];

  for (const f of folds) {
    const cg = censor(cond.g, f.cutoff, cond.mode);
    const seedIds = f.seeds.map(s => s.node_id);
    const { pool } = candidatePool(cg, seedIds, 3);
    poolSizes.push(pool.length);
    const inPool = pool.includes(f.truth.node_id);
    if (!inPool) unreachable++; else evaluated++;

    const info = { index: f.index, truth: f.truth.node_id, poolSize: pool.length, reachable: inPool, ranks: {} };
    for (const m of METHODS) {
      let rank = null;
      if (inPool) {
        const ordered = m.rank(cg, f.seeds, f.cutoff, pool);
        rank = ordered.indexOf(f.truth.node_id) + 1;
      }
      results.get(m.key).push({ fold: f.index, rank });
      info.ranks[m.key] = rank;
    }
    foldInfo.push(info);
  }

  /* 지표 집계.
     기본(all): 도달 불가 폴드를 역순위 0 · 히트 0 으로 세어 전체 폴드로 나눈다.
     참고(reach): 도달 가능한 폴드만 놓고 계산한다. */
  const rows = METHODS.map(m => {
    const rs = results.get(m.key);
    const rrAll = rs.map(r => (r.rank ? 1 / r.rank : 0));
    const rrReach = rs.filter(r => r.rank).map(r => 1 / r.rank);
    const hit = k => rs.map(r => (r.rank && r.rank <= k ? 1 : 0));
    const hitReach = k => rs.filter(r => r.rank).map(r => (r.rank <= k ? 1 : 0));
    const ranksReach = rs.filter(r => r.rank).map(r => r.rank);
    return {
      key: m.key, label: m.label, family: m.family,
      mrr: mean(rrAll), mrr_sd: stdev(rrAll),
      mrr_reach: mean(rrReach),
      r10: mean(hit(10)), r50: mean(hit(50)),
      r10_reach: mean(hitReach(10)), r50_reach: mean(hitReach(50)),
      medRank: quantile(ranksReach, 0.5), q1Rank: quantile(ranksReach, 0.25), q3Rank: quantile(ranksReach, 0.75)
    };
  });

  /* 무작위 순열 기대치. 후보 풀 크기가 방법 간 비교의 눈금이므로 반드시 같이 봐야 한다.
     풀 크기 P 인 폴드에서 정답이 균등분포라면 E[1/rank] = H_P / P, recall@k = min(k,P)/P.
     도달 불가 폴드는 0 점. */
  let rndMrr = 0, rndR10 = 0, rndR50 = 0;
  for (const f of foldInfo) {
    if (!f.reachable) continue;
    const P = f.poolSize;
    let H = 0; for (let i = 1; i <= P; i++) H += 1 / i;
    rndMrr += H / P; rndR10 += Math.min(10, P) / P; rndR50 += Math.min(50, P) / P;
  }
  const nF = folds.length;
  const random = { mrr: rndMrr / nF, r10: rndR10 / nF, r50: rndR50 / nF };

  return {
    label: cond.label, note: cond.note, random,
    folds: folds.length, evaluated, unreachable,
    poolMedian: quantile(poolSizes, 0.5), poolMin: Math.min(...poolSizes), poolMax: Math.max(...poolSizes),
    rows, foldInfo
  };
}

/* ── 출력 ── */
function printCondition(r) {
  say("");
  say("═".repeat(96));
  say(`조건 ${r.label}`);
  say("═".repeat(96));
  if (r.note) say(`※ ${r.note}`);
  say(`폴드 ${r.folds}개 · 도달 가능 ${r.evaluated} · 도달 불가 ${r.unreachable} (${(100 * r.unreachable / r.folds).toFixed(1)}%)`);
  say(`후보 풀 크기: 중앙값 ${r.poolMedian} (${r.poolMin}~${r.poolMax})`);
  say("");
  const sorted = r.rows.slice().sort((a, b) => b.mrr - a.mrr);
  say(`${"방법".padEnd(26)} ${"MRR".padStart(6)} ${"±sd".padStart(6)} ${"R@10".padStart(6)} ${"R@50".padStart(6)} ${"MRR*".padStart(6)} ${"R@10*".padStart(6)} ${"순위 중앙(Q1~Q3)".padStart(18)}`);
  say("-".repeat(96));
  for (const x of sorted) {
    say([
      x.label.padEnd(26),
      x.mrr.toFixed(3).padStart(6),
      x.mrr_sd.toFixed(3).padStart(6),
      x.r10.toFixed(3).padStart(6),
      x.r50.toFixed(3).padStart(6),
      x.mrr_reach.toFixed(3).padStart(6),
      x.r10_reach.toFixed(3).padStart(6),
      `${x.medRank} (${x.q1Rank}~${x.q3Rank})`.padStart(18)
    ].join(" "));
  }
  say("-".repeat(96));
  say([
    "(참고) 무작위 순열 기대치".padEnd(26),
    r.random.mrr.toFixed(3).padStart(6),
    "-".padStart(6),
    r.random.r10.toFixed(3).padStart(6),
    r.random.r50.toFixed(3).padStart(6)
  ].join(" ") + "   <- 이 눈금 위에 있어야 그래프 계산이 값을 한 것이다");
  say("* 표시는 도달 가능한 폴드만 놓고 계산한 값. 표시 없는 것은 도달 불가를 0점으로 세어 전체 폴드로 나눈 값.");
}

const gHand = graphHand();
const gOA = graphOpenAlex();

const conditions = [
  {
    label: "B · 손으로 만든 인용 그래프 · 읽은시각 타임라인 (주 조건)",
    g: gHand, mode: "year", timeline: "read",
    note: "시간 검열은 '연도 > 컷오프 연도' 근사. 독서 이력이 2026년이고 논문은 전부 2025년 이하라 실제로 제거되는 노드가 0개다 (검열이 무효)."
  },
  {
    label: "A · OpenAlex 실제 인용 그래프 · 읽은시각 타임라인",
    g: gOA, mode: "date", timeline: "read",
    note: "참고문헌 데이터가 2022년 이후 거의 비어 있어 그래프가 붕괴해 있다. 도달률 상한이 낮아 방법 비교용으로 쓸 수 없다."
  },
  {
    label: "B' · 손으로 만든 그래프 · 출판일 타임라인 (검열 민감도 확인용)",
    g: gHand, mode: "year", timeline: "pubdate",
    note: "읽은 시각을 그 논문의 출판일로 바꿔 '나올 때마다 읽는 연구자'를 흉내낸 합성 조건. 컷오프가 정답의 출판일이라 최근성 베이스라인은 정답을 항상 1위로 둔다 - 최근성 행은 무효다."
  }
].filter(c => c.g);

const all = conditions.map(runCondition);
for (const r of all) printCondition(r);

/* 주 조건 요약: 최고 PPR vs 최고 베이스라인 */
say("");
say("═".repeat(96));
say("요약 - 주 조건(B) 에서 PPR 최고 조합 vs 베이스라인");
say("═".repeat(96));
const main = all[0];
const bestPPR = main.rows.filter(r => r.family === "PPR").sort((a, b) => b.mrr - a.mrr)[0];
const bestBase = main.rows.filter(r => r.family === "baseline").sort((a, b) => b.mrr - a.mrr)[0];
say(`PPR 최고    : ${bestPPR.label}  MRR ${bestPPR.mrr.toFixed(3)}  R@10 ${bestPPR.r10.toFixed(3)}`);
say(`베이스라인 최고: ${bestBase.label}  MRR ${bestBase.mrr.toFixed(3)}  R@10 ${bestBase.r10.toFixed(3)}`);
const diff = bestPPR.mrr - bestBase.mrr;
say(`차이 (MRR)  : ${diff >= 0 ? "+" : ""}${diff.toFixed(3)}  → ${diff > 0 ? "PPR 우위" : diff < 0 ? "베이스라인 우위" : "동률"}`);

/* 폴드별 부호 검정용 승패 (PPR 최고 vs 베이스라인 최고) */
let win = 0, lose = 0, tie = 0;
for (const f of main.foldInfo) {
  const a = f.ranks[bestPPR.key], b = f.ranks[bestBase.key];
  if (a == null && b == null) { tie++; continue; }
  if (a == null) { lose++; continue; }
  if (b == null) { win++; continue; }
  if (a < b) win++; else if (a > b) lose++; else tie++;
}
say(`폴드별 승패 : PPR 승 ${win} · 패 ${lose} · 무 ${tie} (총 ${main.folds}폴드)`);

/* 더 엄격한 비교: 폴드마다 베이스라인 3종 중 그 폴드에서 가장 잘한 것과 붙인다.
   "총 MRR 이 가장 높은 베이스라인 하나"와 붙이는 것보다 정직한 기준선이다. */
const baseKeys = main.rows.filter(r => r.family === "baseline").map(r => r.key);
let win2 = 0, lose2 = 0, tie2 = 0;
for (const f of main.foldInfo) {
  const a = f.ranks[bestPPR.key];
  const bs = baseKeys.map(k => f.ranks[k]).filter(v => v != null);
  const b = bs.length ? Math.min(...bs) : null;
  if (a == null && b == null) { tie2++; continue; }
  if (a == null) { lose2++; continue; }
  if (b == null) { win2++; continue; }
  if (a < b) win2++; else if (a > b) lose2++; else tie2++;
}
say(`폴드별 승패 (베이스라인 3종 중 그 폴드 최선과 비교): PPR 승 ${win2} · 패 ${lose2} · 무 ${tie2}`);

/* 스킵 가중치 민감도: skipped = -1 (기본) vs 0 (스킵을 그냥 무시) */
say("");
say("스킵 반응 가중치 민감도 (주 조건, PPR deg^0.8 · 반감기 90일):");
for (const sw of [-1, 0, -0.5]) {
  const { folds } = makeFolds({ timeline: "read", graph: gHand });
  const rr = [], h10 = [];
  for (const f of folds) {
    const cg = censor(gHand, f.cutoff, "year");
    const { pool } = candidatePool(cg, f.seeds.map(s => s.node_id), 3);
    if (!pool.includes(f.truth.node_id)) { rr.push(0); h10.push(0); continue; }
    const ordered = rankPPR(cg, f.seeds, f.cutoff, pool, { hubExp: 0.8, halfLife: 90, skippedWeight: sw });
    const rank = ordered.indexOf(f.truth.node_id) + 1;
    rr.push(1 / rank); h10.push(rank <= 10 ? 1 : 0);
  }
  say(`  skipped = ${String(sw).padStart(4)} → MRR ${mean(rr).toFixed(4)} · R@10 ${mean(h10).toFixed(3)}`);
}

if (DETAIL) {
  say("");
  say("주 조건 폴드별 정답 순위 (PPR 최고 vs 베이스라인 최고, x = 후보 풀 밖)");
  say(`${"폴드".padStart(4)} ${"정답".padEnd(14)} ${"풀".padStart(4)} ${"PPR".padStart(5)} ${"기준선".padStart(6)}`);
  for (const f of main.foldInfo)
    say(`${String(f.index).padStart(4)} ${f.truth.padEnd(14)} ${String(f.poolSize).padStart(4)} ${String(f.ranks[bestPPR.key] ?? "x").padStart(5)} ${String(f.ranks[bestBase.key] ?? "x").padStart(6)}`);
}

if (JSON_OUT) {
  const p = join(CACHE_DIR, "backtest-results.json");
  writeFileSync(p, JSON.stringify({
    generated_at: new Date().toISOString(),
    conditions: all.map(r => ({ ...r, foldInfo: r.foldInfo }))
  }, null, 2));
  console.log(`\nJSON 저장: ${p}`);
}
