/* 온보딩 입력 파서. onboard.html 이 <script> 로 읽고, node 에서도 require 로 테스트한다.

   받는 형식
   - arXiv URL   arxiv.org/abs|pdf|html/<id>[vN]      버전 접미사는 뗀다
   - 맨 arXiv id 2401.04088, 2401.04088v2, hep-th/9901001 (옛 형식)
   - DOI         10.48550/arXiv.<id> 는 arXiv 로 바꾼다. 다른 DOI 는 그대로 남긴다
   - BibTeX      @article{...} 엔트리의 eprint / url / doi / title / dateadded
   - 트윗 링크   x.com·twitter.com URL 자체는 버리고 안에 든 arXiv 링크만 본다
   - 제목 문장   코퍼스 제목과 토큰 F1 >= 0.6 이면 매칭
   - 파일명      2401.04088v1.pdf 처럼 이름에 id 가 있으면 뽑는다. 내용은 읽지 않는다

   돌려주는 것: { items: [{ arxiv, node_id, title, via, line, read_at }], ignored: [{ line, why }] }
   parseHistoryJson 은 { candidates, ignored } 를 돌려준다. 외부 필드(eprint, arxiv)는 전체 일치로만 받는다.
   같은 논문이 여러 줄에 나오면 하나로 합친다. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CGParse = factory();
})(typeof self !== "undefined" ? self : this, function () {

  const NEW_ID = /(?:^|[^\d.])(\d{4}\.\d{4,5})(?:v\d+)?(?![\d.])/g;                 // 2401.04088[v2]
  const OLD_CATS = "astro-ph|cond-mat|gr-qc|hep-ex|hep-lat|hep-ph|hep-th|math-ph|nlin|nucl-ex|nucl-th|physics|quant-ph|math|cs|q-bio|q-fin|stat|eess|econ";
  const OLD_ID = new RegExp("\\b((?:" + OLD_CATS + ")(?:\\.[A-Za-z]{2})?\\/\\d{7})(?:v\\d+)?\\b", "g");   // hep-th/9901001. 카테고리 밖(x.com/a/status/1234567)은 오탐이라 제외
  const FULL_NEW = /^\d{4}\.\d{4,5}(?:v\d+)?$/;
  const FULL_OLD = new RegExp("^(?:" + OLD_CATS + ")(?:\\.[A-Za-z]{2})?\\/\\d{7}(?:v\\d+)?$");
  const ARXIV_URL = /arxiv\.org\/(?:abs|pdf|html|format)\/([^\s?#"'<>)]+?)(?:\.pdf)?(?=[\s?#"'<>)]|$)/gi;
  const ARXIV_DOI = /10\.48550\/arxiv\.([\w./-]+)/gi;
  const OTHER_DOI = /\b(10\.\d{4,9}\/[^\s"'<>]+)/g;
  const STOP = new Set(["a", "an", "the", "of", "for", "and", "with", "to", "in", "on", "is", "are", "via"]);

  function stripVersion(id) { return String(id).replace(/v\d+$/i, ""); }
  /* 통째로 arXiv id 인가 (부분 일치가 아니라 전체 일치). 외부 입력 필드(eprint, 히스토리 arxiv)는 이걸로 거른다 */
  function isArxivId(s) { s = String(s == null ? "" : s).trim(); return FULL_NEW.test(s) || FULL_OLD.test(s); }
  function normTitle(t) { return String(t).toLowerCase().replace(/[‐-―]/g, "-").replace(/[^a-z0-9]+/g, " ").trim(); }
  function titleTokens(t) { return new Set(normTitle(t).split(" ").filter(w => w && !STOP.has(w))); }
  function titleF1(a, b) {
    const A = titleTokens(a), B = titleTokens(b);
    if (!A.size || !B.size) return 0;
    let inter = 0; for (const w of A) if (B.has(w)) inter++;
    const p = inter / A.size, r = inter / B.size;
    return p + r === 0 ? 0 : (2 * p * r) / (p + r);
  }

  /* 한 줄(또는 한 덩어리)에서 arXiv id 들을 뽑는다 */
  function idsIn(text) {
    const out = new Set();
    let m;
    ARXIV_URL.lastIndex = 0;
    while ((m = ARXIV_URL.exec(text))) out.add(stripVersion(m[1]));
    ARXIV_DOI.lastIndex = 0;
    while ((m = ARXIV_DOI.exec(text))) out.add(stripVersion(m[1]));
    NEW_ID.lastIndex = 0;
    while ((m = NEW_ID.exec(text))) out.add(m[1]);
    OLD_ID.lastIndex = 0;
    while ((m = OLD_ID.exec(text))) out.add(m[1]);
    return [...out];
  }

  /* 코퍼스 색인 */
  function makeIndex(corpus) {
    const byArxiv = new Map(), papers = [];
    for (const p of (corpus && corpus.papers) || []) {
      papers.push(p);
      if (p.arxiv) byArxiv.set(stripVersion(p.arxiv).toLowerCase(), p);
    }
    return { byArxiv, papers };
  }
  function matchTitle(idx, text) {
    let best = null, bestF = 0;
    for (const p of idx.papers) {
      const f = titleF1(text, p.title);
      if (f > bestF) { bestF = f; best = p; }
    }
    return bestF >= 0.6 ? { paper: best, f1: bestF } : null;
  }

  /* BibTeX: 엔트리 단위로 자른다. 중괄호·따옴표 필드 모두 받는다 */
  function parseBibtex(text) {
    const entries = [];
    const re = /@(\w+)\s*\{\s*([^,\s]*)\s*,/g;
    let m;
    while ((m = re.exec(text))) {
      let i = re.lastIndex, depth = 1, start = i;
      while (i < text.length && depth > 0) { const c = text[i]; if (c === "{") depth++; else if (c === "}") depth--; i++; }
      const body = text.slice(start, depth === 0 ? i - 1 : i);   // 닫는 괄호가 없으면 끝까지
      const fields = {};
      const fre = /(\w[\w-]*)\s*=\s*(\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|([^,\n]+))/g;
      let f;
      while ((f = fre.exec(body))) fields[f[1].toLowerCase()] = (f[3] != null ? f[3] : f[4] != null ? f[4] : f[5]).trim().replace(/[{}]/g, "");
      entries.push({ type: m[1], key: m[2], fields, span: [m.index, i] });
      re.lastIndex = i;
    }
    return entries;
  }

  /* BibTeX 엔트리 하나를 항목으로 */
  function itemFromBib(idx, e) {
    const f = e.fields;
    let arxiv = null;
    if (f.eprint && isArxivId(f.eprint)) arxiv = stripVersion(f.eprint.trim());
    if (!arxiv) { const ids = idsIn([f.url, f.doi, f.journal, f.note, f.howpublished].filter(Boolean).join(" ")); if (ids.length) arxiv = ids[0]; }
    let paper = arxiv ? idx.byArxiv.get(arxiv.toLowerCase()) : null;
    let via = arxiv ? "bibtex" : null;
    if (!paper && f.title) { const mt = matchTitle(idx, f.title); if (mt) { paper = mt.paper; via = via || "bibtex-title"; if (!arxiv) arxiv = paper.arxiv || null; } }
    if (!arxiv && !paper) return null;
    const dateAdded = f.dateadded || f["date-added"] || f.timestamp || null;
    return {
      arxiv: arxiv || (paper && paper.arxiv) || null,
      node_id: paper ? paper.id : null,
      title: paper ? paper.title : (f.title || arxiv),
      via: via || "bibtex-title",
      line: `@${e.type}{${e.key}}`,
      read_at: dateAdded ? toIso(dateAdded) : null
    };
  }

  function toIso(s) { const t = Date.parse(s); return isNaN(t) ? null : new Date(t).toISOString(); }

  /* 자유 텍스트 전체 */
  function parseText(text, corpus) {
    const idx = makeIndex(corpus);
    const items = new Map();     // key(arxiv 또는 node_id) -> item
    const ignored = [];
    const put = it => {
      if (!it) return;
      const key = it.node_id ? "n:" + it.node_id : "a:" + it.arxiv;
      if (!items.has(key)) items.set(key, it);
      else { const cur = items.get(key); if (!cur.read_at && it.read_at) cur.read_at = it.read_at; if (!cur.node_id && it.node_id) Object.assign(cur, it); }
    };

    // 1) BibTeX 엔트리를 먼저 떼어낸다
    let rest = text || "";
    const entries = parseBibtex(rest);
    for (const e of entries) put(itemFromBib(idx, e));
    // 엔트리 구간을 중괄호 균형대로 잘라낸다 (lazy 정규식은 한 줄 엔트리 뒤의 줄을 삼킨다)
    for (let k = entries.length - 1; k >= 0; k--) { const [a, b] = entries[k].span; rest = rest.slice(0, a) + "\n" + rest.slice(b); }

    // 2) 나머지는 줄 단위
    for (const raw of rest.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const ids = idsIn(line);
      if (ids.length) {
        for (const a of ids) {
          const p = idx.byArxiv.get(a.toLowerCase());
          const via = /arxiv\.org/i.test(line) ? "url" : /10\.48550/i.test(line) ? "doi" : "id";
          put({ arxiv: a, node_id: p ? p.id : null, title: p ? p.title : a, via, line, read_at: null });
        }
        continue;
      }
      // 다른 DOI 는 arXiv 가 아니라 그래프 밖. 지금은 무시 목록으로
      OTHER_DOI.lastIndex = 0;
      if (OTHER_DOI.test(line)) { ignored.push({ line, why: "arXiv 가 아닌 DOI" }); continue; }
      if (/^https?:\/\//i.test(line)) { ignored.push({ line, why: "arXiv 링크가 아닌 URL" }); continue; }
      const mt = matchTitle(idx, line);
      if (mt) { put({ arxiv: mt.paper.arxiv || null, node_id: mt.paper.id, title: mt.paper.title, via: "title", f1: +mt.f1.toFixed(2), line, read_at: null }); continue; }
      ignored.push({ line, why: "논문을 못 찾음" });
    }
    return { items: [...items.values()], ignored };
  }

  /* 파일명: 내용은 읽지 않는다 */
  function parseFilename(name, corpus) {
    const idx = makeIndex(corpus);
    const ids = idsIn(String(name).replace(/\.pdf$/i, " "));
    if (!ids.length) return null;
    const p = idx.byArxiv.get(ids[0].toLowerCase());
    return { arxiv: ids[0], node_id: p ? p.id : null, title: p ? p.title : ids[0], via: "file", line: name, read_at: null };
  }

  /* 히스토리 CLI 산출 JSON: [{ arxiv|url, last_visit, visits, pdf }] 또는 { candidates: [...] } */
  function parseHistoryJson(json, corpus) {
    const idx = makeIndex(corpus);
    let data = typeof json === "string" ? JSON.parse(json) : json;
    if (data && data.candidates) data = data.candidates;
    if (!Array.isArray(data)) throw new Error("배열이 아니다");
    const candidates = [], ignored = [];
    for (const c of data) {
      if (!c || typeof c !== "object") { ignored.push({ line: String(c), why: "객체가 아님" }); continue; }
      let ids = [];
      if (c.arxiv != null) { if (isArxivId(c.arxiv)) ids = [stripVersion(String(c.arxiv).trim())]; else { ignored.push({ line: String(c.arxiv).slice(0, 80), why: "arXiv id 형식이 아님" }); continue; } }
      else ids = idsIn(String(c.url || ""));
      if (!ids.length) { ignored.push({ line: String(c.url || "").slice(0, 80), why: "arXiv id 없음" }); continue; }
      const p = idx.byArxiv.get(ids[0].toLowerCase());
      const lv = c.last_visit || c.lastVisit || null;
      candidates.push({
        arxiv: ids[0], node_id: p ? p.id : null, title: p ? p.title : (typeof c.title === "string" && c.title ? c.title : ids[0]),
        last_visit: lv && !isNaN(Date.parse(lv)) ? new Date(Date.parse(lv)).toISOString() : null,
        visits: Math.max(1, +(c.visits || 1) || 1), pdf: !!c.pdf, via: "history"
      });
    }
    return { candidates, ignored };
  }

  /* 판정 순서: 재방문 2회 이상 · PDF 열람 · 최근순 */
  function sortCandidates(list) {
    return list.slice().sort((a, b) => {
      const sa = (a.visits >= 2 ? 2 : 0) + (a.pdf ? 1 : 0), sb = (b.visits >= 2 ? 2 : 0) + (b.pdf ? 1 : 0);
      if (sb !== sa) return sb - sa;
      return (Date.parse(b.last_visit || 0) || 0) - (Date.parse(a.last_visit || 0) || 0);
    });
  }

  return { parseText, parseBibtex, parseFilename, parseHistoryJson, sortCandidates, idsIn, titleF1, stripVersion, isArxivId };
});
