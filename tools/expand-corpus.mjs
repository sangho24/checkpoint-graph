#!/usr/bin/env node
/* 손 코퍼스 78편을 Semantic Scholar 로 1홉 확장해 backtest/cache/s2-expanded.json 을 만든다.

   단계
     1. 참고문헌 1홉  78편의 references 중 arXiv id 가 있는 것 (캐시에서, 네트워크 없음)
     2. 피인용 1홉    78편 각각의 citations 를 최대 2000건 받아 arXiv id 가 있는 것 중 피인용 상위 25편
                      (attention 처럼 피인용이 10만인 논문은 첫 2000건 안에서만 고른다)
     3. 메타·엣지     신규 + 시드 전부를 POST /paper/batch 로 받고, references 는 코퍼스 안을 가리키는 것만 남긴다
     4. arXiv API     primary category · 제목 · 발표일. 제목·날짜는 arXiv 를 우선하고 S2 는 폴백

   레이트리밋: 요청 간 1.1초, 429/5xx 는 2초부터 2배씩 최대 6회, Retry-After 준수. S2_API_KEY 가 있으면 헤더로 보낸다.
   중간 저장: 각 단계·청크마다 partial 로 저장하고, 재실행하면 이어서 받는다. --force 로 처음부터.

   사용법: node tools/expand-corpus.mjs [--force] [--top-cit 25] [--stage 4] [--retry-batch]
           --retry-batch  429 로 통째로 빠진 batch 청크를 다시 받는다 (완료 후 보충용)
   출력:   backtest/cache/s2-expanded.json
           { fetched_at, stats, papers: [{ arxiv, s2_id, title, title_src, year, date, cites, cat, hop, via, refs_in_corpus }] }
           refs_in_corpus 의 키는 arXiv id 이고, arXiv id 가 없는 시드(lstm, gpt2)만 "s2:<paperId>" 다. */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CACHE_DIR } from "../backtest/data.mjs";

const API = "https://api.semanticscholar.org/graph/v1";
const ARXIV_API = "http://export.arxiv.org/api/query";
const IN = join(CACHE_DIR, "semanticscholar-works.json");
const OUT = join(CACHE_DIR, "s2-expanded.json");
const MIN_INTERVAL_MS = 1100;
const ARXIV_INTERVAL_MS = 3100;
const MAX_RETRY = 6;
const API_KEY = process.env.S2_API_KEY || "";
const argv = process.argv.slice(2);
const FORCE = argv.includes("--force");
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TOP_CIT = +arg("--top-cit", 25);
const STOP_AFTER = +arg("--stage", 4);          // 이 단계까지만 돌리고 저장 (나눠 돌릴 때)
const BATCH_SIZE = 200;
const CIT_PAGE = 1000, CIT_MAX = 2000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const normArxiv = a => a ? String(a).trim().toLowerCase().replace(/v\d+$/, "") : null;

/* ── 상태 (partial 저장 단위) ── */
let state = {
  fetched_at: null, partial: true,
  stats: { requests: 0, retries: 0, rate_limited: 0, errors: 0, arxiv_requests: 0, elapsed_sec: 0, runs: 0 },
  stage_done: 0,
  seeds: [],                 // { key, arxiv, s2_id, node_id }
  refs1: [],                 // arXiv ids (참고문헌 1홉)
  cit: {},                   // seed key -> { done, picked: [arxiv...], scanned, total }
  batch: {},                 // key -> S2 batch 레코드 (요약)
  arxiv_meta: {},            // arXiv id -> { title, published, cat }
  papers: []
};
if (existsSync(OUT) && !FORCE) {
  const prev = JSON.parse(readFileSync(OUT, "utf8"));
  if (prev.partial || prev.papers) {
    state = { ...state, ...prev };
    if (!state.stats.runs) state.stats.runs = 0;
    console.log(`이어서 진행: 단계 ${state.stage_done} 까지 완료된 상태에서 시작`);
  }
}
state.stats.runs++;
const t0 = Date.now();
const runStart = { requests: state.stats.requests, rate_limited: state.stats.rate_limited };
let lastSaveElapsed = 0;
/* 저장. elapsed 는 마지막 저장 이후 증가분만 더해 이중 계산을 피한다 */
function save(final = false) {
  const now = (Date.now() - t0) / 1000;
  state.stats.elapsed_sec = +(state.stats.elapsed_sec + (now - lastSaveElapsed)).toFixed(1);
  lastSaveElapsed = now;
  state.partial = !final;
  state.fetched_at = new Date().toISOString();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(state));
}
const saveTick = () => save(false);

/* ── HTTP (fetch-semanticscholar.mjs 와 같은 규칙) ── */
let lastCall = 0;
async function call(url, init = {}) {
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    state.stats.requests++;
    let res;
    try {
      res = await fetch(url, { ...init, headers: { "User-Agent": "checkpoint-graph-expand", ...(API_KEY ? { "x-api-key": API_KEY } : {}), ...(init.headers || {}) } });
    } catch (e) {
      if (attempt === MAX_RETRY) { state.stats.errors++; return { ok: false, reason: String(e.message || e) }; }
      state.stats.retries++; await sleep(2000 * 2 ** attempt); continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (res.status === 429) state.stats.rate_limited++;
      if (attempt === MAX_RETRY) { state.stats.errors++; return { ok: false, reason: `HTTP ${res.status}` }; }
      state.stats.retries++;
      const ra = Number(res.headers.get("retry-after"));
      const backoff = 2000 * 2 ** attempt;
      await sleep(ra > 0 ? Math.max(ra * 1000, backoff) : backoff);
      continue;
    }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    try { return { ok: true, json: await res.json() }; } catch (e) { return { ok: false, reason: `JSON 파싱 실패: ${e.message}` }; }
  }
  return { ok: false, reason: "unreachable" };
}

/* ── 1. 시드와 참고문헌 1홉 (캐시) ── */
function stage1() {
  const cache = JSON.parse(readFileSync(IN, "utf8"));
  const seeds = [], refs = new Set();
  for (const w of cache.works) {
    if (!w.resolved || !w.work) continue;
    const arxiv = normArxiv(w.query_arxiv || w.work.arxiv);
    const key = arxiv || `s2:${w.work.id}`;
    seeds.push({ key, arxiv, s2_id: w.work.id, node_id: w.node_id });
    for (const r of (w.work.references || [])) { const a = normArxiv(r.arxiv); if (a) refs.add(a); }
  }
  const seedSet = new Set(seeds.map(s => s.key));
  state.seeds = seeds;
  state.refs1 = [...refs].filter(a => !seedSet.has(a)).sort();
  state.stage_done = 1;
  console.log(`1. 시드 ${seeds.length} · 참고문헌 1홉 arXiv id ${state.refs1.length}편 (시드 제외, 중복 제거)`);
}

/* ── 2. 피인용 1홉 ── */
async function stage2() {
  const seedSet = new Set(state.seeds.map(s => s.key));
  const todo = state.seeds.filter(s => !(state.cit[s.key] && state.cit[s.key].done));
  console.log(`2. 피인용 수집: ${todo.length}/${state.seeds.length} 편 남음 (각 최대 ${CIT_MAX}건, 상위 ${TOP_CIT}편 보존)`);
  for (const s of todo) {
    const id = s.arxiv ? `arXiv:${s.arxiv}` : s.s2_id;
    const cands = new Map(); let scanned = 0, total = null, failed = false;
    for (let offset = 0; offset < CIT_MAX; offset += CIT_PAGE) {
      const url = `${API}/paper/${encodeURIComponent(id)}/citations?fields=paperId,externalIds,citationCount,year&limit=${CIT_PAGE}&offset=${offset}`;
      const r = await call(url);
      if (!r.ok) { console.log(`   ${s.node_id}: 실패 (${r.reason}) offset ${offset}`); failed = offset === 0; break; }
      const data = r.json.data || [];
      for (const d of data) {
        const p = d.citingPaper || {}; scanned++;
        const a = normArxiv(p.externalIds && p.externalIds.ArXiv);
        if (!a || seedSet.has(a)) continue;
        const prev = cands.get(a);
        if (!prev || (p.citationCount || 0) > prev) cands.set(a, p.citationCount || 0);
      }
      if (r.json.next == null || data.length < CIT_PAGE) break;
    }
    const picked = [...cands.entries()].sort((x, y) => y[1] - x[1]).slice(0, TOP_CIT).map(([a]) => a);
    state.cit[s.key] = { done: !failed, picked, scanned, with_arxiv: cands.size };
    process.stdout.write(failed ? "X" : "O");
    saveTick();
  }
  process.stdout.write("\n");
  const ok = state.seeds.filter(s => state.cit[s.key] && state.cit[s.key].done).length;
  console.log(`   피인용 수집 완료 ${ok}/${state.seeds.length}`);
  if (ok === state.seeds.length) state.stage_done = 2;
}

/* 코퍼스 키 목록: 시드 + 참고문헌 1홉 + 피인용 1홉 */
function corpusKeys() {
  const keys = new Map();   // key -> { hop, via }
  for (const s of state.seeds) keys.set(s.key, { hop: 0, via: "seed" });
  for (const a of state.refs1) if (!keys.has(a)) keys.set(a, { hop: 1, via: "ref" });
  for (const c of Object.values(state.cit)) for (const a of (c.picked || [])) {
    if (!keys.has(a)) keys.set(a, { hop: 1, via: "cit" });
    else if (keys.get(a).via === "ref") keys.get(a).via = "ref+cit";
  }
  return keys;
}

/* ── 3. batch 메타·엣지 ── */
async function stage3() {
  const keys = corpusKeys();
  const all = [...keys.keys()];
  // 청크 단위 429 로 missing 이 된 것은 다시 시도한다 (S2 가 null 을 준 것은 재시도하지 않는다)
  const retryable = k => !state.batch[k] || (state.batch[k].missing && state.batch[k].reason !== "batch null");
  const todo = all.filter(retryable);
  console.log(`3. batch 메타: 코퍼스 ${all.length}편 중 ${todo.length}편 남음 (${BATCH_SIZE}건씩)`);
  const fields = "paperId,externalIds,title,year,publicationDate,citationCount,referenceCount,references.paperId,references.externalIds";
  const s2ToKey = new Map(state.seeds.filter(s => !s.arxiv).map(s => [s.s2_id, s.key]));
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const chunk = todo.slice(i, i + BATCH_SIZE);
    const ids = chunk.map(k => k.startsWith("s2:") ? k.slice(3) : `ARXIV:${k}`);
    const r = await call(`${API}/paper/batch?fields=${fields}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    if (!r.ok) { console.log(`   청크 ${i / BATCH_SIZE} 실패: ${r.reason}`); for (const k of chunk) state.batch[k] = { missing: true, reason: r.reason }; saveTick(); continue; }
    r.json.forEach((p, j) => {
      const k = chunk[j];
      if (!p) { state.batch[k] = { missing: true, reason: "batch null" }; return; }
      const refs = [];
      for (const ref of (p.references || [])) {
        const a = normArxiv(ref.externalIds && ref.externalIds.ArXiv);
        if (a && keys.has(a)) refs.push(a);
        else if (ref.paperId && s2ToKey.has(ref.paperId)) refs.push(s2ToKey.get(ref.paperId));
      }
      state.batch[k] = {
        s2_id: p.paperId, title: p.title || null, year: p.year || null, date: p.publicationDate || null,
        cites: p.citationCount || 0, ref_count: p.referenceCount || 0, refs: [...new Set(refs)].filter(x => x !== k)
      };
    });
    process.stdout.write(`   청크 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(todo.length / BATCH_SIZE)} 완료\n`);
    saveTick();
  }
  const got = all.filter(k => state.batch[k] && !state.batch[k].missing).length;
  console.log(`   batch 메타 확보 ${got}/${all.length}`);
  if (all.every(k => state.batch[k])) state.stage_done = 3;
}

/* ── 4. arXiv API: primary category · 제목 · 발표일 ── */
function parseAtom(xml) {
  const out = {};
  const entries = xml.split("<entry>").slice(1);
  for (const e of entries) {
    const id = (e.match(/<id>\s*https?:\/\/arxiv\.org\/abs\/([^<\s]+)\s*<\/id>/) || [])[1];
    if (!id) continue;
    const title = ((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").replace(/\s+/g, " ").trim();
    const published = ((e.match(/<published>([^<]+)<\/published>/) || [])[1] || "").slice(0, 10) || null;
    const cat = (e.match(/<arxiv:primary_category[^>]*term="([^"]+)"/) || [])[1] || null;
    out[normArxiv(id)] = { title: title || null, published, cat };
  }
  return out;
}
let lastArxiv = 0;
async function stage4() {
  const keys = [...corpusKeys().keys()].filter(k => !k.startsWith("s2:"));
  const todo = keys.filter(k => !state.arxiv_meta[k]);
  console.log(`4. arXiv 메타: ${keys.length}편 중 ${todo.length}편 남음 (100건씩, ${ARXIV_INTERVAL_MS}ms 간격)`);
  for (let i = 0; i < todo.length; i += 100) {
    const chunk = todo.slice(i, i + 100);
    let got = null;
    for (let attempt = 0; attempt < 4 && !got; attempt++) {
      const wait = ARXIV_INTERVAL_MS - (Date.now() - lastArxiv);
      if (wait > 0) await sleep(wait);
      lastArxiv = Date.now();
      state.stats.arxiv_requests++;
      try {
        const res = await fetch(`${ARXIV_API}?id_list=${chunk.join(",")}&max_results=100`, { headers: { "User-Agent": "checkpoint-graph-expand (mailto:sam9787@naver.com)" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        got = parseAtom(await res.text());
      } catch (e) { console.log(`   arXiv 청크 ${i / 100} 시도 ${attempt + 1} 실패: ${e.message}`); await sleep(10000 * (attempt + 1)); }
    }
    if (!got) { for (const k of chunk) state.arxiv_meta[k] = { missing: true }; saveTick(); continue; }
    for (const k of chunk) state.arxiv_meta[k] = got[k] || { missing: true };
    process.stdout.write(`   arXiv 청크 ${Math.floor(i / 100) + 1}/${Math.ceil(todo.length / 100)} (받음 ${Object.keys(got).length})\n`);
    saveTick();
  }
  if (keys.every(k => state.arxiv_meta[k])) state.stage_done = 4;
}

/* ── 조립 ── */
function assemble() {
  const keys = corpusKeys();
  // 피인용 경로로 들어온 논문은 "그 시드를 인용한다"는 사실을 citations 엔드포인트가 이미 보증한다.
  // 최근 논문은 S2 가 아직 references 를 파싱하지 않아 batch 응답의 references 가 비어 있는 경우가 많으므로
  // 그 엣지를 여기서 보탠다 (2026년 논문 다수가 이 경우다).
  const citEdges = new Map();   // citing key -> Set(seed key)
  for (const s of state.seeds) for (const a of ((state.cit[s.key] || {}).picked || [])) {
    if (!citEdges.has(a)) citEdges.set(a, new Set());
    citEdges.get(a).add(s.key);
  }
  const papers = [];
  for (const [k, info] of keys) {
    const b = state.batch[k]; const am = state.arxiv_meta[k];
    if (!b || b.missing) continue;                       // S2 에 없는 것은 코퍼스에서 뺀다 (엣지 원천이 없다)
    const arxiv = k.startsWith("s2:") ? null : k;
    const useArxiv = am && !am.missing;
    papers.push({
      arxiv, s2_id: b.s2_id,
      title: (useArxiv && am.title) || b.title || null,
      title_src: (useArxiv && am.title) ? "arxiv" : (b.title ? "s2" : null),
      year: (useArxiv && am.published) ? +am.published.slice(0, 4) : b.year,
      date: (useArxiv && am.published) || b.date || null,
      cites: b.cites, ref_count: b.ref_count,
      cat: useArxiv ? am.cat : null,
      hop: info.hop, via: info.via,
      refs_in_corpus: [...new Set([...b.refs, ...(citEdges.get(k) || [])])].filter(r => r !== k && state.batch[r] && !state.batch[r].missing),
      refs_from_batch: b.refs.length
    });
  }
  state.papers = papers;
}

async function main() {
  if (state.stage_done < 1) stage1();
  if (STOP_AFTER >= 2 && state.stage_done < 2) await stage2();
  if (STOP_AFTER >= 3 && state.stage_done >= 2 && state.stage_done < 3) await stage3();
  if (STOP_AFTER >= 4 && state.stage_done >= 3 && state.stage_done < 4) await stage4();
  if (argv.includes("--retry-batch") && state.stage_done >= 3) { await stage3(); if (state.stage_done >= 3) await stage4(); }
  assemble();
  const final = state.stage_done >= 4;
  save(final);
  const s = state.stats;
  console.log(`저장: ${OUT} (${final ? "완료" : "partial, 단계 " + state.stage_done})`);
  console.log(`논문 ${state.papers.length} · 이번 실행 요청 ${s.requests - runStart.requests}건 · 429 ${s.rate_limited - runStart.rate_limited}회 · 누적 요청 ${s.requests} · 429 ${s.rate_limited} · 오류 ${s.errors} · arXiv 요청 ${s.arxiv_requests} · 누적 ${s.elapsed_sec}s`);
}
main().catch(e => { console.error(e); save(false); process.exit(1); });
