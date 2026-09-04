#!/usr/bin/env node
/* safari.html 의 PAPERS 78편을 Semantic Scholar Graph API 에서 해소해 캐시한다.
   fetch-openalex.mjs 와 같은 절차·같은 캐시 형태다. OpenAlex 에서 배운 함정 두 가지를 반영한다.
   - 함정 1: 연도를 필터에 넣으면 정답이 걸러진다. 여기서는 어떤 전략에도 연도를 넣지 않는다.
   - 함정 2: 식별자가 맞아도 제목이 딴 논문일 수 있다. arXiv 확증과 제목 검증을 따로 기록하고
             둘이 어긋나는 건(conflict)을 별도 필드로 남긴다. 확증 근거(externalIds)도 통째로 저장한다.
   - 의존성 0. node 내장 fetch 만 쓴다.
   - 키 없는 공용 풀은 1.5초 간격에도 429 가 난다. 요청 간 최소 간격 + 지수 백오프 + Retry-After 준수.
   - 10편마다 partial 캐시를 써 두고, --force 없이 재실행하면 거기서 이어받는다.

   사용법:  node backtest/fetch-semanticscholar.mjs [--force] [--all-strategies] [--enrich]
     --enrich  완료된 캐시에서 참고문헌 목록이 짧은 레코드만 paperId 단건 조회로 보충한다.
               검색 엔드포인트(search, search/match)는 references 를 돌려주지 않아서 제목으로 해소된
               논문은 참고문헌이 비어 온다. 그래서 보충 단계가 필요하다 (본 수집에서도 자동으로 건다).
   환경변수: S2_API_KEY 가 있으면 x-api-key 헤더로 보낸다 (없어도 동작한다)

   전략 순서: arxiv_batch(요청 1건으로 76편) -> 그걸로 arXiv 확증 + 제목 검증이 모두 통과하면 끝.
   통과하지 못한 논문(arXiv id 없음, batch null, id 는 맞는데 제목이 다름)에만 제목 매칭·검색을 건다.
   키 없는 공용 풀에서는 논문당 2건씩 78편에 전부 걸면 429 백오프 때문에 두 시간이 넘게 걸려서
   (실측: 13분에 6편) 기본값을 이렇게 잡았다. 전략 비교표가 필요하면 --all-strategies 를 켠다.
*/

import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PAPERS, CACHE_DIR, titleF1, titleTokens } from "./data.mjs";

const API = "https://api.semanticscholar.org/graph/v1";
const OUT = join(CACHE_DIR, "semanticscholar-works.json");
const MIN_INTERVAL_MS = 1100;    // 공용 풀 예절: 요청 사이 최소 간격
const MAX_RETRY = 6;             // 429/5xx 지수 백오프 재시도 횟수 (2s, 4s, ... 64s)
const FIELDS = "paperId,externalIds,title,year,publicationDate,citationCount,referenceCount,references.paperId,references.externalIds,references.title";
const API_KEY = process.env.S2_API_KEY || "";
const SAVE_EVERY = 10;

const FORCE = process.argv.includes("--force");
const ALL_STRATEGIES = process.argv.includes("--all-strategies");
const ENRICH_ONLY = process.argv.includes("--enrich");

let lastCall = 0;
const stats = { requests: 0, retries: 0, rate_limited: 0, errors: 0 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 공통 HTTP 호출. 성공하면 {ok, json}, 최종 실패하면 {ok:false, reason}. */
async function call(url, init = {}) {
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    stats.requests++;
    let res;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent": "checkpoint-graph-backtest",
          ...(API_KEY ? { "x-api-key": API_KEY } : {}),
          ...(init.headers || {})
        }
      });
    } catch (e) {
      if (attempt === MAX_RETRY) { stats.errors++; return { ok: false, reason: String(e.message || e) }; }
      stats.retries++;
      await sleep(2000 * Math.pow(2, attempt));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (res.status === 429) stats.rate_limited++;
      if (attempt === MAX_RETRY) { stats.errors++; return { ok: false, reason: `HTTP ${res.status}` }; }
      stats.retries++;
      const ra = Number(res.headers.get("retry-after"));
      const backoff = 2000 * Math.pow(2, attempt);
      await sleep(ra > 0 ? Math.max(ra * 1000, backoff) : backoff);
      continue;
    }
    if (res.status === 404) return { ok: false, reason: "HTTP 404", notFound: true };
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    try { return { ok: true, json: await res.json() }; }
    catch (e) { return { ok: false, reason: `JSON 파싱 실패: ${e.message}` }; }
  }
  return { ok: false, reason: "unreachable" };
}

/* 후보 하나를 질의 논문과 대조해 점수를 낸다. OpenAlex 쪽과 같은 4겹 검증. */
function scoreCandidate(paper, w) {
  const cand = w.title || "";
  const f1 = titleF1(paper.title, cand);
  const A = titleTokens(paper.title), B = titleTokens(cand);
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  const coverage = A.size ? inter / A.size : 0;      // 내 제목이 후보에 얼마나 담겼나
  const yr = w.year;
  const yearDiff = (yr && paper.year) ? Math.abs(yr - paper.year) : null;
  const ext = w.externalIds || {};
  const mine = (paper.arxiv || "").toLowerCase();
  const extArxiv = String(ext.ArXiv || "").toLowerCase();
  const extDoi = String(ext.DOI || "").toLowerCase();
  const arxivConfirmed = !!mine && (extArxiv === mine || extDoi === `10.48550/arxiv.${mine}`);
  const anyArxiv = !!(ext.ArXiv || extDoi.startsWith("10.48550/"));
  return { f1, coverage, yearDiff, arxivConfirmed, anyArxiv, externalIds: ext };
}

/* 후보 목록에서 최선을 고른다. arXiv id 확인이 최우선, 그 다음 F1, 그 다음 연도 일치. */
function pickBest(paper, results) {
  let best = null;
  for (const w of results) {
    if (!w || !w.paperId) continue;
    const s = scoreCandidate(paper, w);
    const rank = (s.arxivConfirmed ? 100 : 0) + s.f1 * 10 + (s.yearDiff === 0 ? 1 : 0)
      + Math.min(w.citationCount || 0, 1e6) / 1e9;
    if (!best || rank > best.rank) best = { w, s, rank };
  }
  return best;
}

/* 판정. title_ok 는 arXiv 확증이 덮어쓴 값이고, conflict 는 그 둘이 어긋난 경우다. */
function verdict(s) {
  const titleOnlyOk = s.f1 >= 0.60 && s.coverage >= 0.75;
  const titleOk = s.arxivConfirmed || titleOnlyOk;
  const yearOk = s.yearDiff !== null && s.yearDiff <= 1;
  return { titleOnlyOk, titleOk, yearOk, strictOk: titleOk && yearOk, conflict: s.arxivConfirmed && !titleOnlyOk };
}

function attemptRecord(name, r, best) {
  if (!r.ok) return { strategy: name, ok: false, reason: r.reason, hits: 0 };
  const v = best ? verdict(best.s) : null;
  return {
    strategy: name, ok: true, hits: r.hits,
    best_id: best ? best.w.paperId : null,
    best_title: best ? (best.w.title || "") : null,
    f1: best ? +best.s.f1.toFixed(3) : null,
    coverage: best ? +best.s.coverage.toFixed(3) : null,
    year_diff: best ? best.s.yearDiff : null,
    arxiv_confirmed: best ? best.s.arxivConfirmed : false,
    title_only_ok: v ? v.titleOnlyOk : false,
    title_ok: v ? v.titleOk : false,
    strict_ok: v ? v.strictOk : false,
    conflict: v ? v.conflict : false
  };
}

/* 더 강한 증거가 나오면 갈아탄다: arXiv 확증 > F1 */
function better(cand, cur) {
  if (!cur) return true;
  if (cand.s.arxivConfirmed !== cur.s.arxivConfirmed) return cand.s.arxivConfirmed;
  return cand.s.f1 > cur.s.f1;
}

function toWork(w) {
  const refs = (w.references || []).map(r => ({
    paperId: r.paperId || null,
    arxiv: (r.externalIds && r.externalIds.ArXiv) || null,
    title: r.title || null
  }));
  return {
    id: w.paperId,
    arxiv: (w.externalIds && w.externalIds.ArXiv) || null,
    doi: (w.externalIds && w.externalIds.DOI) || null,
    external_ids: w.externalIds || {},
    display_name: w.title,
    publication_date: w.publicationDate || null,
    publication_year: w.year,
    cited_by_count: w.citationCount,
    referenced_works: refs.map(r => r.paperId).filter(Boolean),
    referenced_arxiv: refs.map(r => r.arxiv).filter(Boolean),
    references: refs,
    referenced_works_count: w.referenceCount,
    references_returned: refs.length
  };
}

/* 참고문헌 보충: 원천이 알려준 참고문헌 수보다 받은 목록이 짧으면 paperId 로 단건 조회한다.
   검색 엔드포인트는 references 를 돌려주지 않으므로 제목 전략으로 해소된 건이 여기에 걸린다. */
function needsEnrich(rec) {
  return rec.resolved && rec.work && rec.work.referenced_works_count != null
    && rec.work.references_returned < rec.work.referenced_works_count;
}
async function enrich(rec) {
  const r = await call(`${API}/paper/${rec.work.id}?fields=${encodeURIComponent(FIELDS)}`);
  if (!r.ok || !r.json || !r.json.paperId) { rec.enriched = { ok: false, reason: r.reason || "응답 없음" }; return false; }
  const before = rec.work.references_returned;
  rec.work = toWork(r.json);
  rec.enriched = { ok: true, strategy: "paper_id_entity", references_before: before, references_after: rec.work.references_returned };
  return true;
}

function save(works, batchInfo, t0, partial) {
  const payload = {
    fetched_at: new Date().toISOString(),
    source: "semanticscholar",
    api_key_used: !!API_KEY,
    all_strategies: ALL_STRATEGIES,
    stats: { ...stats, elapsed_sec: +((Date.now() - t0) / 1000).toFixed(1) },
    batch: batchInfo,
    works
  };
  if (partial) payload.partial = true;
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  let works = [];
  let batchInfo = null;
  let resume = null;
  if (existsSync(OUT) && !FORCE) {
    const cached = JSON.parse(readFileSync(OUT, "utf8"));
    if (!cached.partial && ENRICH_ONLY) {
      const t0 = Date.now();
      const targets = cached.works.filter(needsEnrich);
      console.log(`보충 대상 ${targets.length}편: ${targets.map(w => w.node_id).join(", ") || "(없음)"}`);
      let okN = 0;
      for (const rec of targets) { if (await enrich(rec)) okN++; process.stdout.write(rec.enriched.ok ? "O" : "X"); }
      if (targets.length) process.stdout.write("\n");
      for (const k of ["requests", "retries", "rate_limited", "errors"]) stats[k] += (cached.stats && cached.stats[k]) || 0;
      stats.prev_elapsed_sec = ((cached.stats && cached.stats.prev_elapsed_sec) || 0) + ((cached.stats && cached.stats.elapsed_sec) || 0);
      stats.runs = ((cached.stats && cached.stats.runs) || 1) + 1;
      stats.note = cached.stats && cached.stats.note;
      writeFileSync(OUT, JSON.stringify({ ...cached, fetched_at: new Date().toISOString(),
        stats: { ...stats, elapsed_sec: +((Date.now() - t0) / 1000).toFixed(1) }, works: cached.works }, null, 2));
      console.log(`보충 완료 ${okN}/${targets.length} · 저장: ${OUT}`);
      return;
    }
    if (!cached.partial) {
      console.log(`캐시 사용: ${OUT} (${cached.works.length}편, 생성 ${cached.fetched_at}). 다시 받으려면 --force`);
      return;
    }
    resume = cached;
    works = cached.works;
    batchInfo = cached.batch;
    // 통계는 이전 실행분에 누적한다 (요청·429 수가 실행 전체를 반영하도록)
    if (cached.stats) {
      for (const k of ["requests", "retries", "rate_limited", "errors"]) stats[k] += cached.stats[k] || 0;
      stats.prev_elapsed_sec = (cached.stats.prev_elapsed_sec || 0) + (cached.stats.elapsed_sec || 0);
      stats.runs = (cached.stats.runs || 1) + 1;
    }
    console.log(`partial 캐시에서 이어받는다: ${works.length}편 완료 상태`);
  }
  const t0 = Date.now();
  const done = new Set(works.map(w => w.node_id));

  /* a. arxiv_batch: arXiv id 가 있는 논문 전부를 요청 1건으로 조회한다.
        partial 재개 시 batch 결과는 저장돼 있지 않으므로 다시 받는다 (요청 1건이라 싸다). */
  const withArxiv = PAPERS.filter(p => p[3]);
  const batchMap = new Map();          // arXiv id -> paper 객체 | null
  let batchResult = null;
  {
    const ids = withArxiv.map(p => `ARXIV:${p[3]}`);
    const r = await call(`${API}/paper/batch?fields=${encodeURIComponent(FIELDS)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids })
    });
    if (r.ok && Array.isArray(r.json)) {
      r.json.forEach((w, i) => batchMap.set(withArxiv[i][3], w || null));
      const nulls = withArxiv.filter((p, i) => !r.json[i]).map(p => p[0]);
      batchResult = { ok: true, requested: ids.length, returned: r.json.filter(Boolean).length, nulls };
      console.log(`arxiv_batch: ${ids.length}건 요청 · ${batchResult.returned}건 반환 · null ${nulls.length}건${nulls.length ? " (" + nulls.join(", ") + ")" : ""}`);
    } else {
      batchResult = { ok: false, reason: r.reason || "응답 형식 오류" };
      console.log(`arxiv_batch 실패: ${batchResult.reason}. 논문별 arxiv_entity 로 대체한다`);
    }
  }
  batchInfo = batchResult;

  for (const [id, title, year, arxiv, cites, topic] of PAPERS) {
    if (done.has(id)) continue;
    const paper = { id, title, year: +year, arxiv, cites: +cites, topic };
    const attempts = [];
    let chosen = null, chosenStrategy = null;
    const consider = (name, r, results) => {
      const best = r.ok ? pickBest(paper, results) : null;
      attempts.push(attemptRecord(name, r, best));
      if (best && verdict(best.s).titleOk && better(best, chosen)) { chosen = best; chosenStrategy = name; }
      return best;
    };

    if (arxiv) {
      // a. batch 결과
      if (batchResult.ok) {
        const w = batchMap.get(arxiv);
        consider("arxiv_batch", w ? { ok: true, hits: 1 } : { ok: false, reason: "batch 응답 null" }, w ? [w] : []);
      }
      // b. 단건 조회: batch 가 없거나 null 을 준 경우에만
      if (!batchResult.ok || !batchMap.get(arxiv)) {
        const r = await call(`${API}/paper/arXiv:${arxiv}?fields=${encodeURIComponent(FIELDS)}`);
        consider("arxiv_entity", r.ok ? { ok: true, hits: 1 } : r, r.ok ? [r.json] : []);
      }
    }
    // 제목 전략은 batch/entity 로 확증+제목검증이 모두 통과했으면 건너뛴다 (--all-strategies 면 전부 시도)
    const settled = chosen && chosen.s.arxivConfirmed && verdict(chosen.s).titleOnlyOk;
    // c. 제목 정확 매칭 (연도 필터 없음)
    if (ALL_STRATEGIES || !settled) {
      const r = await call(`${API}/paper/search/match?query=${encodeURIComponent(title)}&fields=${encodeURIComponent(FIELDS)}`);
      const data = r.ok ? (r.json.data || []) : [];
      consider("title_match", r.ok ? { ok: true, hits: data.length } : (r.notFound ? { ok: true, hits: 0 } : r), data);
    }
    // d. 제목 검색 상위 5 (연도 필터 없음)
    if (ALL_STRATEGIES || !settled) {
      const r = await call(`${API}/paper/search?query=${encodeURIComponent(title)}&limit=5&fields=${encodeURIComponent(FIELDS)}`);
      const data = r.ok ? (r.json.data || []) : [];
      consider("title_search", r.ok ? { ok: true, hits: r.json.total ?? data.length } : r, data);
    }

    const rec = {
      node_id: id, query_title: title, query_year: +year, query_arxiv: arxiv,
      resolved: !!chosen,
      resolved_by: chosenStrategy,
      title_strategies_tried: attempts.some(a => a.strategy.startsWith("title_")),
      attempts
    };
    if (chosen) {
      const s = chosen.s, v = verdict(s);
      rec.work = toWork(chosen.w);
      if (needsEnrich(rec)) await enrich(rec);
      rec.match = {
        f1: +s.f1.toFixed(3), coverage: +s.coverage.toFixed(3),
        year_diff: s.yearDiff, arxiv_confirmed: s.arxivConfirmed,
        any_arxiv: s.anyArxiv,
        arxiv_evidence: s.externalIds,            // 확증 근거 (externalIds 원본, 재검증용)
        title_only_ok: v.titleOnlyOk,
        title_ok: v.titleOk, year_ok: v.yearOk, strict_ok: v.strictOk,
        conflict: v.conflict                       // id 는 맞는데 제목이 다른 레코드
      };
    } else {
      const anyHit = attempts.some(a => a.ok && a.hits > 0);
      const allErr = attempts.every(a => !a.ok);
      rec.fail_reason = allErr ? "모든 전략이 HTTP 오류"
        : !anyHit ? "모든 전략에서 검색 결과 0건"
        : "검색 결과는 있으나 제목 검증 통과 후보 없음";
    }
    works.push(rec);
    process.stdout.write(chosen ? (settled ? "O" : "o") : "X");   // O 확증+제목, o 제목 또는 id 한쪽만, X 실패
    if (works.length % SAVE_EVERY === 0) save(works, batchInfo, t0, true);
  }
  process.stdout.write("\n");

  // PAPERS 순서로 정렬해 저장 (partial 재개 시 순서가 유지되지만 안전하게)
  const order = new Map(PAPERS.map((p, i) => [p[0], i]));
  works.sort((a, b) => order.get(a.node_id) - order.get(b.node_id));
  save(works, batchInfo, t0, false);
  const ok = works.filter(w => w.resolved).length;
  const el = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`저장: ${OUT}`);
  console.log(`해소 ${ok}/${works.length} · 요청 ${stats.requests}건 · 재시도 ${stats.retries} · 429 ${stats.rate_limited}회 · 오류 ${stats.errors} · ${el}s${resume ? ` (이번 실행분 소요. 이전 실행 누적 ${stats.prev_elapsed_sec}s, 요청·429 는 누적치)` : ""}`);
}

main().catch(e => { console.error(e); process.exit(1); });
