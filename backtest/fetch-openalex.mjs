#!/usr/bin/env node
/* safari.html 의 PAPERS 78편을 OpenAlex 에서 해소해 캐시한다.
   - 의존성 0. node 내장 fetch 만 쓴다.
   - 해소 전략을 여러 개 모두 시도하고 "어느 전략이 먹혔는지"를 함께 기록한다.
   - 매칭 검증: 제목 토큰 F1 + 질의 제목 커버리지 + 연도 일치 + arXiv id 가 위치 URL 에 있는지.
   - polite pool 예절: mailto 항상 포함, 요청 간 최소 간격, 실패 시 지수 백오프 2회 재시도.
   - 결과는 backtest/cache/openalex-works.json. 캐시가 있으면 네트워크를 다시 때리지 않는다.

   사용법:  node backtest/fetch-openalex.mjs [--force]
*/

import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PAPERS, CACHE_DIR, titleF1, titleTokens, normTitle } from "./data.mjs";

const MAILTO = "sam9787@naver.com";
const API = "https://api.openalex.org/works";
const OUT = join(CACHE_DIR, "openalex-works.json");
const MIN_INTERVAL_MS = 120;     // polite pool: 요청 사이 최소 간격
const MAX_RETRY = 2;             // 실패 시 지수 백오프 재시도 횟수
const SELECT = "id,doi,ids,display_name,title,publication_date,publication_year,type,cited_by_count,referenced_works,referenced_works_count,locations";

const FORCE = process.argv.includes("--force");

let lastCall = 0;
const stats = { requests: 0, retries: 0, errors: 0 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(params) {
  const url = `${API}?${params}&per_page=25&select=${SELECT}&mailto=${encodeURIComponent(MAILTO)}`;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    stats.requests++;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": `checkpoint-graph-backtest (mailto:${MAILTO})` }
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, results: [] };
      const j = await res.json();
      return { ok: true, results: j.results || [], count: j.meta ? j.meta.count : null };
    } catch (e) {
      if (attempt === MAX_RETRY) { stats.errors++; return { ok: false, reason: String(e.message || e), results: [] }; }
      stats.retries++;
      await sleep(400 * Math.pow(3, attempt));   // 지수 백오프: 400ms -> 1200ms
    }
  }
  return { ok: false, reason: "unreachable", results: [] };
}

/* 후보 하나를 질의 논문과 대조해 점수를 낸다. */
function scoreCandidate(paper, w) {
  const cand = w.display_name || w.title || "";
  const f1 = titleF1(paper.title, cand);
  const A = titleTokens(paper.title), B = titleTokens(cand);
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  const coverage = A.size ? inter / A.size : 0;      // 내 제목이 후보에 얼마나 담겼나
  const yr = w.publication_year;
  const yearDiff = (yr && paper.year) ? Math.abs(yr - paper.year) : null;
  // arXiv id 가 위치 URL/DOI 에 실제로 등장하는가 (가장 강한 독립 검증)
  const urls = [];
  for (const l of (w.locations || [])) {
    if (l.landing_page_url) urls.push(l.landing_page_url);
    if (l.pdf_url) urls.push(l.pdf_url);
  }
  if (w.doi) urls.push(w.doi);
  if (w.ids && w.ids.doi) urls.push(w.ids.doi);
  const blob = urls.join(" ").toLowerCase();
  const arxivConfirmed = !!(paper.arxiv && blob.includes(paper.arxiv.toLowerCase()));
  const anyArxivUrl = blob.includes("arxiv.org") || blob.includes("10.48550");
  // 확증 근거가 된 URL 자체를 남긴다. 이걸 안 남기면 나중에 오프라인 재검증이 불가능하다.
  const arxivEvidence = paper.arxiv
    ? urls.filter(u => u.toLowerCase().includes(paper.arxiv.toLowerCase())).slice(0, 3)
    : [];
  return { f1, coverage, yearDiff, arxivConfirmed, anyArxivUrl, arxivEvidence };
}

/* 후보 목록에서 최선을 고른다. arXiv id 확인이 최우선, 그 다음 F1. */
function pickBest(paper, results) {
  let best = null;
  for (const w of results) {
    const s = scoreCandidate(paper, w);
    const rank = (s.arxivConfirmed ? 100 : 0) + s.f1 * 10 + (s.yearDiff === 0 ? 1 : 0)
      + Math.min(w.cited_by_count || 0, 1e6) / 1e9;
    if (!best || rank > best.rank) best = { w, s, rank };
  }
  return best;
}

/* 판정: 제목 기준 통과 / 제목+연도 기준 통과 */
function verdict(s) {
  const titleOk = s.arxivConfirmed || (s.f1 >= 0.60 && s.coverage >= 0.75);
  const yearOk = s.yearDiff !== null && s.yearDiff <= 1;
  return { titleOk, yearOk, strictOk: titleOk && yearOk };
}

function strategiesFor(paper) {
  const t = encodeURIComponent(paper.title);
  const list = [];
  if (paper.arxiv) {
    list.push(["doi_arxiv_url", `filter=doi:https://doi.org/10.48550/arxiv.${paper.arxiv}`]);
    list.push(["doi_arxiv_bare", `filter=doi:10.48550/arxiv.${paper.arxiv}`]);
  }
  list.push(["title_search", `filter=title.search:${t}`]);
  list.push(["title_search_year", `filter=title.search:${t},publication_year:${paper.year}`]);
  list.push(["search", `search=${t}`]);
  return list;
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (existsSync(OUT) && !FORCE) {
    const cached = JSON.parse(readFileSync(OUT, "utf8"));
    console.log(`캐시 사용: ${OUT} (${cached.works.length}편, 생성 ${cached.fetched_at}). 다시 받으려면 --force`);
    return;
  }

  const works = [];
  const t0 = Date.now();
  for (const [id, title, year, arxiv, cites, topic] of PAPERS) {
    const paper = { id, title, year: +year, arxiv, cites: +cites, topic };
    const attempts = [];
    let chosen = null, chosenStrategy = null;

    for (const [name, params] of strategiesFor(paper)) {
      const r = await api(params);
      if (!r.ok) { attempts.push({ strategy: name, ok: false, reason: r.reason, hits: 0 }); continue; }
      const best = pickBest(paper, r.results);
      const v = best ? verdict(best.s) : null;
      attempts.push({
        strategy: name, ok: true, hits: r.count,
        best_id: best ? best.w.id : null,
        best_title: best ? (best.w.display_name || "") : null,
        f1: best ? +best.s.f1.toFixed(3) : null,
        coverage: best ? +best.s.coverage.toFixed(3) : null,
        year_diff: best ? best.s.yearDiff : null,
        arxiv_confirmed: best ? best.s.arxivConfirmed : false,
        title_ok: v ? v.titleOk : false,
        strict_ok: v ? v.strictOk : false
      });
      if (best && verdict(best.s).titleOk) {
        // 더 강한 증거(arXiv id 확인)가 나오면 갈아탄다
        if (!chosen || (best.s.arxivConfirmed && !chosen.s.arxivConfirmed)
          || (best.s.arxivConfirmed === chosen.s.arxivConfirmed && best.s.f1 > chosen.s.f1)) {
          chosen = best; chosenStrategy = name;
        }
      }
    }

    const rec = {
      node_id: id, query_title: title, query_year: +year, query_arxiv: arxiv,
      resolved: !!chosen,
      resolved_by: chosenStrategy,
      attempts
    };
    if (chosen) {
      const w = chosen.w, s = chosen.s, v = verdict(s);
      rec.work = {
        id: w.id,
        doi: w.doi || null,
        display_name: w.display_name,
        publication_date: w.publication_date,
        publication_year: w.publication_year,
        type: w.type,
        cited_by_count: w.cited_by_count,
        referenced_works: w.referenced_works || [],
        referenced_works_count: w.referenced_works_count
      };
      rec.match = {
        f1: +s.f1.toFixed(3), coverage: +s.coverage.toFixed(3),
        year_diff: s.yearDiff, arxiv_confirmed: s.arxivConfirmed,
        any_arxiv_url: s.anyArxivUrl,
        arxiv_evidence: s.arxivEvidence,           // 확증 근거 URL (재검증용)
        // title_ok 는 arxiv 확증이 덮어쓴 값이다. 제목만의 판정은 title_only_ok 를 보라.
        title_only_ok: s.f1 >= 0.60 && s.coverage >= 0.75,
        title_ok: v.titleOk, year_ok: v.yearOk, strict_ok: v.strictOk
      };
    } else {
      // 왜 실패했는지 남긴다
      const anyHit = attempts.some(a => a.ok && a.hits > 0);
      rec.fail_reason = !anyHit ? "모든 전략에서 검색 결과 0건"
        : "검색 결과는 있으나 제목 검증 통과 후보 없음";
    }
    works.push(rec);
    process.stdout.write(`${chosen ? "O" : "X"}`);
  }
  process.stdout.write("\n");

  const payload = {
    fetched_at: new Date().toISOString(),
    mailto: MAILTO,
    stats: { ...stats, elapsed_sec: +((Date.now() - t0) / 1000).toFixed(1) },
    works
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  const ok = works.filter(w => w.resolved).length;
  console.log(`저장: ${OUT}`);
  console.log(`해소 ${ok}/${works.length} · 요청 ${stats.requests}건 · 재시도 ${stats.retries} · 실패 ${stats.errors} · ${payload.stats.elapsed_sec}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
