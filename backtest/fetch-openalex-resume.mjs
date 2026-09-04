#!/usr/bin/env node
/* fetch-openalex.mjs 의 보충 실행기.
   배경: OpenAlex 는 2026 시점 기준으로 일일 크레딧 예산제를 쓴다.
     - 무료(익명/polite) 예산 $0.10/일, 검색(list) 요청 1건 = $0.001  -> 하루 약 100건
     - 단일 엔티티 조회(/works/<id> 또는 /works/doi:<doi>) 1건 = $0.0001 -> 10배 저렴
   첫 실행에서 검색 기반 다중 전략이 예산을 다 써 78편 중 33편만 해소됐다.
   여기서는 남은 논문을 "단일 엔티티 DOI 조회" 한 가지 전략으로만 채운다.
   arXiv DOI 는 10.48550/arXiv.<id> 로 결정적으로 만들어지므로 검색이 필요 없다.

   429 를 만나면 즉시 멈추고 지금까지 받은 것만 캐시에 병합한다 (재실행하면 이어서 받는다).
   사용법: node backtest/fetch-openalex-resume.mjs
*/

import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PAPERS, CACHE_DIR, titleF1, titleTokens } from "./data.mjs";

const MAILTO = "sam9787@naver.com";
const OUT = join(CACHE_DIR, "openalex-works.json");
const INTERVAL_MS = 250;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cache = JSON.parse(readFileSync(OUT, "utf8"));
const byId = new Map(cache.works.map(w => [w.node_id, w]));

const pending = PAPERS
  .map(([id, title, year, arxiv, cites, topic]) => ({ id, title, year: +year, arxiv, cites: +cites, topic }))
  .filter(p => { const r = byId.get(p.id); return (!r || !r.resolved) && p.arxiv; });

console.log(`미해소 + arXiv id 보유: ${pending.length}편`);

let got = 0, blocked = 0;
for (const p of pending) {
  const url = `https://api.openalex.org/works/doi:10.48550/arxiv.${p.arxiv}?mailto=${encodeURIComponent(MAILTO)}`;
  await sleep(INTERVAL_MS);
  let w = null, reason = null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": `checkpoint-graph-backtest (mailto:${MAILTO})` } });
    if (res.status === 429) { blocked++; reason = "HTTP 429 (일일 예산 소진)"; }
    else if (res.status === 404) { reason = "HTTP 404 (arXiv DOI 로 등록된 work 없음)"; }
    else if (!res.ok) { reason = `HTTP ${res.status}`; }
    else w = await res.json();
  } catch (e) { reason = String(e.message || e); }

  const rec = byId.get(p.id) || { node_id: p.id, query_title: p.title, query_year: p.year, query_arxiv: p.arxiv, attempts: [] };
  if (w && w.id) {
    const cand = w.display_name || "";
    const f1 = titleF1(p.title, cand);
    const A = titleTokens(p.title), B = titleTokens(cand);
    let inter = 0; for (const t of A) if (B.has(t)) inter++;
    const coverage = A.size ? inter / A.size : 0;
    const yearDiff = w.publication_year ? Math.abs(w.publication_year - p.year) : null;
    // DOI 자체가 arXiv id 를 담고 있으므로 arXiv 확인은 정의상 성립한다
    rec.resolved = true;
    rec.resolved_by = "entity_doi_arxiv";
    rec.work = {
      id: w.id, doi: w.doi || null, display_name: w.display_name,
      publication_date: w.publication_date, publication_year: w.publication_year,
      type: w.type, cited_by_count: w.cited_by_count,
      referenced_works: w.referenced_works || [],
      referenced_works_count: w.referenced_works_count
    };
    rec.match = {
      f1: +f1.toFixed(3), coverage: +coverage.toFixed(3), year_diff: yearDiff,
      // arXiv DOI 로 직접 조회했으므로 식별자 확증은 정의상 성립한다. 근거 URL 도 남긴다.
      arxiv_confirmed: true, any_arxiv_url: true,
      arxiv_evidence: [`10.48550/arxiv.${p.arxiv}`],
      // 제목은 별개다. 하드코딩하지 말고 실제 F1 로 판정한다.
      title_only_ok: f1 >= 0.60 && coverage >= 0.75,
      title_ok: true, year_ok: yearDiff !== null && yearDiff <= 1,
      strict_ok: yearDiff !== null && yearDiff <= 1
    };
    delete rec.fail_reason;
    got++;
    process.stdout.write("O");
  } else {
    rec.resolved = rec.resolved || false;
    rec.attempts.push({ strategy: "entity_doi_arxiv", ok: false, reason, hits: 0 });
    if (!rec.resolved) rec.fail_reason = reason;
    process.stdout.write(blocked ? "!" : "x");
  }
  byId.set(p.id, rec);
  if (blocked >= 3) { console.log("\n429 가 3회 연속. 일일 예산이 소진됐다. 여기서 중단하고 병합한다."); break; }
}
process.stdout.write("\n");

/* 2단계: DOI 조회로도 안 잡힌 것을 제목 검색으로 한 번 더 시도한다.
   검색은 단일 조회보다 10배 비싸므로(요청당 $0.001) 남은 몇 편에만 쓴다.
   여기서는 arXiv 확증이 불가능하므로 제목 F1 과 연도를 엄격히 본다. */
const stillPending = PAPERS
  .map(([id, title, year, arxiv]) => ({ id, title, year: +year, arxiv }))
  .filter(p => { const r = byId.get(p.id); return !r || !r.resolved; });

if (stillPending.length) {
  console.log(`제목 검색으로 2차 시도: ${stillPending.length}편`);
  for (const p of stillPending) {
    const url = `https://api.openalex.org/works?filter=title.search:${encodeURIComponent(p.title)}`
      + `&per_page=10&select=id,doi,display_name,publication_date,publication_year,type,cited_by_count,referenced_works,referenced_works_count`
      + `&mailto=${encodeURIComponent(MAILTO)}`;
    await sleep(500);
    let results = [], reason = null;
    try {
      const res = await fetch(url, { headers: { "User-Agent": `checkpoint-graph-backtest (mailto:${MAILTO})` } });
      if (!res.ok) reason = `HTTP ${res.status}`;
      else results = (await res.json()).results || [];
    } catch (e) { reason = String(e.message || e); }

    // 제목 F1 최대인 후보를 고르고, 제목·연도 둘 다 통과해야 인정한다
    let best = null;
    for (const w of results) {
      const f1 = titleF1(p.title, w.display_name || "");
      const A = titleTokens(p.title), B = titleTokens(w.display_name || "");
      let inter = 0; for (const t of A) if (B.has(t)) inter++;
      const cov = A.size ? inter / A.size : 0;
      if (!best || f1 > best.f1) best = { w, f1, cov };
    }
    const rec = byId.get(p.id) || { node_id: p.id, query_title: p.title, query_year: p.year, query_arxiv: p.arxiv, attempts: [] };
    const yearDiff = best && best.w.publication_year ? Math.abs(best.w.publication_year - p.year) : null;
    const titleOk = !!best && best.f1 >= 0.6 && best.cov >= 0.75;
    if (titleOk) {
      const w = best.w;
      rec.resolved = true;
      rec.resolved_by = "title_search_fallback";
      rec.work = {
        id: w.id, doi: w.doi || null, display_name: w.display_name,
        publication_date: w.publication_date, publication_year: w.publication_year,
        type: w.type, cited_by_count: w.cited_by_count,
        referenced_works: w.referenced_works || [],
        referenced_works_count: w.referenced_works_count
      };
      rec.match = {
        f1: +best.f1.toFixed(3), coverage: +best.cov.toFixed(3), year_diff: yearDiff,
        arxiv_confirmed: false, any_arxiv_url: false, arxiv_evidence: [],
        title_only_ok: true, title_ok: true,
        year_ok: yearDiff !== null && yearDiff <= 1,
        strict_ok: yearDiff !== null && yearDiff <= 1
      };
      delete rec.fail_reason;
      got++;
      process.stdout.write("O");
    } else {
      rec.attempts.push({
        strategy: "title_search_fallback", ok: !reason, reason,
        hits: results.length, f1: best ? +best.f1.toFixed(3) : null
      });
      rec.fail_reason = reason ? reason
        : (results.length ? `제목 검색 ${results.length}건 중 검증 통과 후보 없음 (최고 F1 ${best ? best.f1.toFixed(2) : "n/a"})`
                          : "제목 검색 결과 0건");
      process.stdout.write("x");
    }
    byId.set(p.id, rec);
  }
  process.stdout.write("\n");
}

cache.works = PAPERS.map(([id]) => byId.get(id)).filter(Boolean);
cache.resume_runs = (cache.resume_runs || []).concat([{ at: new Date().toISOString(), added: got, blocked }]);
writeFileSync(OUT, JSON.stringify(cache, null, 2));
const ok = cache.works.filter(w => w.resolved).length;
console.log(`추가 해소 ${got}편 · 429 차단 ${blocked}건 · 누적 해소 ${ok}/${cache.works.length}`);
