/* 앱 전체가 공유하는 프로필과 코퍼스 어댑터.
   - window.CORPUS (assets/corpus.js) 를 v2 형태로 정규화해 돌려준다. v1(papers/models/articles/cites/describes/pos)도 받는다.
   - localStorage `cg.profile` 하나가 온보딩 상태·범위·이력의 진실이다. 옛 `cg.onboard.*` 키는 처음 한 번 흡수한다.
   - 범위(scope)로 거른 부분그래프를 만든다. 페이지들은 이 부분그래프 위에서 PPR 을 돈다.
   전부 try/catch 이고, localStorage 가 깨져 있어도 페이지가 죽지 않게 형태를 검사한다. */
(function () {
  "use strict";
  const LS_KEY = "cg.profile";
  const OLD_KEYS = { hist: "cg.onboard.history", funnel: "cg.onboard.funnel", step: "cg.onboard.step", picks: "cg.onboard.picks" };
  const REACTIONS = new Set(["read", "liked", "skipped"]);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* 세부 주제 라벨·색. corpus.topics[] 에 label 이 있으면 그것을 우선한다 */
  const TOPIC_LABELS = { arch: "구조", moe: "MoE·조건부 계산", eff: "효율·서빙", align: "정렬·RLHF", reason: "추론", rag: "검색증강", sys: "분산학습", ssm: "상태공간", vis: "비전·멀티모달", eval: "평가", opt: "최적화", scale: "스케일링" };
  const TOPIC_COLORS = { arch: "#4C7DF0", moe: "#D2691E", eff: "#0C9C8A", align: "#B08010", reason: "#7B5BD6", rag: "#0E8FA8", sys: "#8A6FA8", ssm: "#C04A78", vis: "#3FA05A", eval: "#9AA13C", opt: "#CC5544", scale: "#5E6B8C" };
  const CAT_LABELS = { "cs.CL": "자연어 처리", "cs.LG": "기계학습", "cs.CV": "컴퓨터 비전", "cs.AI": "인공지능", "cs.IR": "정보검색", "cs.DC": "분산·병렬", "cs.NE": "신경망·진화", "cs.SD": "사운드", "eess.AS": "음성", "stat.ML": "통계 기계학습", "cs.CR": "보안", "cs.SE": "소프트웨어", "cs.RO": "로보틱스", "cs.HC": "HCI", "cs.PL": "프로그래밍 언어", "cs.AR": "하드웨어", "cs.MM": "멀티미디어", "cs.DB": "데이터베이스", "cs.CY": "사회·윤리", "math.OC": "최적화(수학)", "eess.IV": "영상 처리", "cs.GR": "그래픽스", "cs.MA": "멀티에이전트", "q-bio.QM": "정량 생물학" };

  const ls = {
    get(k) { try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  /* ── 코퍼스 정규화 ─────────────────────────────────────── */
  let CORPUS_CACHE = null;
  function corpus() {
    if (CORPUS_CACHE) return CORPUS_CACHE;
    const raw = window.CORPUS;
    if (!raw) throw new Error("assets/corpus.js 가 로드되지 않았다");
    let nodes = [], edges = [];
    if (raw.version >= 2 && Array.isArray(raw.nodes)) {
      nodes = raw.nodes.map(n => ({
        id: String(n.id), kind: n.kind || "paper", title: n.title || String(n.id), year: Number.isFinite(+n.year) ? +n.year : null,
        date: n.date || null, arxiv: n.arxiv || "", cites: +n.cites || 0, topic: n.topic || null, cat: n.cat || null,
        seed: n.seed !== false, hop: n.hop === 1 ? 1 : 0, x: +n.x || 0, y: +n.y || 0,
        paper: n.paper || null, license: n.license || "", host: n.host || ""
      }));
      edges = (raw.edges || []).map(e => ({ from: String(e.from), to: String(e.to), type: e.type === "describes" ? "describes" : "cites" }));
    } else {
      // v1: safari.html 의 손 코퍼스 그대로. 누락 필드는 기본값 (seed true, hop 0, cat null)
      const pos = raw.pos || {};
      const P = (raw.papers || []).map(p => ({ id: p.id, kind: "paper", title: p.title, year: +p.year || null, date: null, arxiv: p.arxiv || "", cites: +p.cites || 0, topic: p.topic || null, cat: null, seed: true, hop: 0, paper: null, license: "", host: "" }));
      const byPaper = new Map(P.map(p => [p.id, p]));
      const M = (raw.models || []).map(m => ({ id: m.id, kind: "model", title: m.name, year: (byPaper.get(m.paper) || {}).year || null, date: null, arxiv: "", cites: 0, topic: null, cat: null, seed: true, hop: 0, paper: m.paper || null, license: m.license || "", host: "" }));
      const A = (raw.articles || []).map(a => ({ id: a.id, kind: "article", title: a.title, year: +a.year || null, date: null, arxiv: "", cites: 0, topic: null, cat: null, seed: true, hop: 0, paper: null, license: "", host: a.host || "" }));
      nodes = [...P, ...M, ...A].map(n => { const xy = pos[n.id] || [0.5, 0.5]; return { ...n, x: +xy[0] || 0, y: +xy[1] || 0 }; });
      edges = [...(raw.cites || []).map(([a, b]) => ({ from: a, to: b, type: "cites" })), ...(raw.describes || []).map(([a, b]) => ({ from: a, to: b, type: "describes" }))];
    }
    const byId = new Map(nodes.map(n => [n.id, n]));
    // 중복·자기루프·끊긴 엣지 제거
    const seen = new Set(); const clean = [];
    for (const e of edges) { if (e.from === e.to || !byId.has(e.from) || !byId.has(e.to)) continue; const k = e.type + "|" + e.from + "|" + e.to; if (seen.has(k)) continue; seen.add(k); clean.push(e); }
    edges = clean;
    const adj = new Map(), out = new Map();
    for (const n of nodes) { adj.set(n.id, []); out.set(n.id, []); }
    for (const e of edges) { adj.get(e.from).push(e.to); adj.get(e.to).push(e.from); out.get(e.from).push(e.to); }
    // 주제·카테고리·연도 집계
    const tcount = new Map(), ccount = new Map(); let ymin = Infinity, ymax = -Infinity;
    for (const n of nodes) {
      if (n.topic) tcount.set(n.topic, (tcount.get(n.topic) || 0) + 1);
      if (n.cat) ccount.set(n.cat, (ccount.get(n.cat) || 0) + 1);
      if (n.kind === "paper" && n.year) { ymin = Math.min(ymin, n.year); ymax = Math.max(ymax, n.year); }
    }
    const rawTopics = Array.isArray(raw.topics) ? raw.topics : [];
    const topics = [...tcount.keys()].map(slug => { const t = rawTopics.find(x => x.slug === slug) || {}; return { slug, label: t.label || TOPIC_LABELS[slug] || slug, count: tcount.get(slug), color: TOPIC_COLORS[slug] || "#7A7466" }; })
      .sort((a, b) => b.count - a.count);
    const rawCats = Array.isArray(raw.cats) ? raw.cats : [];
    const cats = [...ccount.keys()].map(cat => { const c = rawCats.find(x => x.cat === cat) || {}; return { cat, label: c.label || CAT_LABELS[cat] || cat, count: ccount.get(cat) }; })
      .sort((a, b) => b.count - a.count);
    const years = (raw.years && Number.isFinite(+raw.years.min)) ? { min: +raw.years.min, max: +raw.years.max } : { min: isFinite(ymin) ? ymin : 2017, max: isFinite(ymax) ? ymax : 2025 };
    const stats = { nodes: nodes.length, edges: edges.length, seed_nodes: nodes.filter(n => n.seed).length, hop1_nodes: nodes.filter(n => n.hop === 1).length };
    const BY_ARXIV = new Map(nodes.filter(n => n.arxiv).map(n => [String(n.arxiv).toLowerCase(), n.id]));
    CORPUS_CACHE = {
      version: raw.version >= 2 ? 2 : 1, nodes, edges, topics, cats, years, stats, byId, adj, out, byArxiv: BY_ARXIV,
      topicLabel: s => (topics.find(t => t.slug === s) || {}).label || TOPIC_LABELS[s] || s || "",
      topicColor: s => TOPIC_COLORS[s] || "#7A7466",
      catLabel: c => (cats.find(x => x.cat === c) || {}).label || CAT_LABELS[c] || c || "",
      /* onboard-parse.js 가 기대하는 v1 모양 (papers[] 에 id·title·arxiv·year). 범위와 무관하게 코퍼스 전체로 해소한다 */
      parseIndex: { papers: nodes.filter(n => n.kind === "paper").map(n => ({ id: n.id, title: n.title, arxiv: n.arxiv, year: n.year, cites: n.cites, topic: n.topic })) }
    };
    return CORPUS_CACHE;
  }

  /* ── 범위 ───────────────────────────────────────────────── */
  /* 기본 범위 "추천 범위".
     손 코퍼스(89)에서는 전 기간·2홉. 확장 코퍼스(3천 노드·평균 차수 28)에서는 시드 이웃 1홉 + 최근 3년.
     실제 파일 기준 관심 3개면 약 170노드, mock 이력 38건이면 약 1,100노드가 나온다 (시드 노드는 연도와 무관하게 남는다) */
  const BIG = 500;
  function defaultScope(K) {
    K = K || corpus();
    const big = K.nodes.length > BIG;
    return { topics: null, cats: null, yearMin: big ? Math.max(K.years.min, K.years.max - 2) : K.years.min, yearMax: K.years.max, depth: big ? 1 : 2, preset: "rec" };
  }
  function presets(K) {
    K = K || corpus();
    const big = K.nodes.length > BIG;
    return [
      { key: "rec", label: "추천 범위", scope: defaultScope(K) },
      { key: "narrow", label: "좁게", scope: { topics: null, cats: null, yearMin: Math.max(K.years.min, K.years.max - (big ? 1 : 3)), yearMax: K.years.max, depth: 1, preset: "narrow" } },
      { key: "all", label: "전부", scope: { topics: null, cats: null, yearMin: K.years.min, yearMax: K.years.max, depth: null, preset: "all" } }
    ];
  }
  function normScope(s, K) {
    K = K || corpus();
    const d = defaultScope(K);
    if (!s || typeof s !== "object") return d;
    const topicSet = new Set(K.topics.map(t => t.slug)), catSet = new Set(K.cats.map(c => c.cat));
    const topics = Array.isArray(s.topics) ? s.topics.filter(t => typeof t === "string" && topicSet.has(t)) : null;
    const cats = Array.isArray(s.cats) ? s.cats.filter(c => typeof c === "string" && catSet.has(c)) : null;
    const yMin = Number.isFinite(+s.yearMin) ? Math.max(K.years.min, Math.min(K.years.max, +s.yearMin)) : d.yearMin;
    const yMax = Number.isFinite(+s.yearMax) ? Math.max(yMin, Math.min(K.years.max, +s.yearMax)) : d.yearMax;
    const depth = s.depth === null ? null : (s.depth === 1 || s.depth === 2 ? s.depth : d.depth);
    return { topics: topics && topics.length ? topics : null, cats: cats && cats.length ? cats : null, yearMin: yMin, yearMax: yMax, depth, preset: typeof s.preset === "string" ? s.preset : "custom" };
  }
  function scopeLabel(scope, K) {
    K = K || corpus();
    const s = normScope(scope, K);
    const t = s.topics ? `주제 ${s.topics.length}` : "주제 전체";
    const c = s.cats ? ` · 분야 ${s.cats.length}` : "";
    const y = s.yearMin === K.years.min && s.yearMax === K.years.max ? "전 기간" : `${s.yearMin}~${s.yearMax}`;
    const dpt = s.depth == null ? "깊이 제한 없음" : `${s.depth}홉`;
    return `${t}${c} · ${y} · ${dpt}`;
  }

  /* 범위로 거른 부분그래프.
     1) 주제·분야·연도로 거른다 (모델·아티클은 연도만, 주제 없는 노드는 주제 필터를 통과시키지 않는다. 단 시드 노드는 항상 남긴다)
     2) 시드가 있고 depth 가 있으면 거른 그래프 안에서 시드로부터 depth 홉 이내만 남긴다
     3) 시드가 없으면 거른 그래프 전부. 너무 크면 피인용 상위 cap 개만 (렌더 보호) */
  function scopeGraph(K, scope, seedIds, opts) {
    K = K || corpus();
    const s = normScope(scope, K);
    const cap = (opts && opts.cap) || 1500;
    const seeds = new Set((seedIds || []).filter(id => K.byId.has(id)));
    const topicSet = s.topics ? new Set(s.topics) : null, catSet = s.cats ? new Set(s.cats) : null;
    const pass = n => {
      if (seeds.has(n.id)) return true;
      if (n.kind === "paper") {
        if (n.year && (n.year < s.yearMin || n.year > s.yearMax)) return false;
        if (topicSet && !(n.topic && topicSet.has(n.topic))) return false;
        if (catSet && !(n.cat && catSet.has(n.cat))) return false;
        return true;
      }
      // 모델·아티클: 연도만 본다 (주제·분야 없음)
      if (n.year && (n.year < s.yearMin || n.year > s.yearMax)) return false;
      return true;
    };
    let ids = new Set(K.nodes.filter(pass).map(n => n.id));
    const filteredCount = ids.size;
    let capped = false;
    if (seeds.size && s.depth != null) {
      const dist = new Map(); let frontier = [];
      for (const id of seeds) { dist.set(id, 0); frontier.push(id); }
      for (let h = 1; h <= s.depth && frontier.length; h++) {
        const next = [];
        for (const id of frontier) for (const m of K.adj.get(id) || []) if (ids.has(m) && !dist.has(m)) { dist.set(m, h); next.push(m); }
        frontier = next;
      }
      ids = new Set(dist.keys());
    } else if (ids.size > cap) {
      const keep = K.nodes.filter(n => ids.has(n.id)).sort((a, b) => (seeds.has(b.id) - seeds.has(a.id)) || (b.cites - a.cites)).slice(0, cap);
      ids = new Set(keep.map(n => n.id)); capped = true;
    }
    const nodes = K.nodes.filter(n => ids.has(n.id));
    const edges = K.edges.filter(e => ids.has(e.from) && ids.has(e.to));
    return { nodes, edges, ids, filteredCount, capped, scope: s };
  }

  /* 페이지들이 쓰는 튜플 (graph.html · safari.html 의 기존 코드가 PAPERS/MODELS/ARTICLES/CITE_SRC 를 소비한다) */
  function tuples(sub) {
    const papers = sub.nodes.filter(n => n.kind === "paper").map(n => [n.id, n.title, n.year, n.arxiv || "", n.cites, n.topic || "arch"]);
    const describes = new Map(sub.edges.filter(e => e.type === "describes").map(e => [e.from, e.to]));
    const models = sub.nodes.filter(n => n.kind === "model").map(n => [n.id, n.title, n.paper || describes.get(n.id) || "", n.license || ""]);
    const articles = sub.nodes.filter(n => n.kind === "article").map(n => [n.id, n.title, n.host || "", n.year]);
    const outMap = new Map();
    for (const e of sub.edges) if (e.type === "cites") { if (!outMap.has(e.from)) outMap.set(e.from, []); outMap.get(e.from).push(e.to); }
    const citeSrc = [...outMap].map(([f, tos]) => `${f}: ${tos.join(" ")}`).join("\n");
    return { papers, models, articles, citeSrc };
  }

  /* ── 프로필 ─────────────────────────────────────────────── */
  function blank(K) {
    K = K || corpus();
    return { version: 1, scope: defaultScope(K), scopeSet: false, picks: [], history: [], funnel: { reach: [0, 0, 0, 0], done: [0, 0, 0, 0], skip: [0, 0, 0, 0] }, step: 0, updated_at: null };
  }
  function normHistory(v, K) {
    if (!Array.isArray(v)) return [];
    const out = [], seenNode = new Set(), seenArx = new Set();
    for (let i = v.length - 1; i >= 0; i--) {   // 뒤에서부터: 같은 노드는 최신이 이긴다
      const h = v[i];
      if (!h || typeof h !== "object" || !REACTIONS.has(h.reaction)) continue;
      const node_id = typeof h.node_id === "string" && K.byId.has(h.node_id) ? h.node_id : null;
      const arxiv = typeof h.arxiv === "string" && h.arxiv ? h.arxiv : null;
      if (!node_id && !arxiv) continue;
      if (node_id) { if (seenNode.has(node_id)) continue; seenNode.add(node_id); }
      else { if (seenArx.has(arxiv)) continue; seenArx.add(arxiv); }
      out.unshift({ node_id, arxiv, read_at: typeof h.read_at === "string" && !isNaN(Date.parse(h.read_at)) ? h.read_at : new Date().toISOString(), reaction: h.reaction, source: typeof h.source === "string" ? h.source : "unknown" });
    }
    return out;
  }
  function normFunnel(v) {
    const d = { reach: [0, 0, 0, 0], done: [0, 0, 0, 0], skip: [0, 0, 0, 0] };
    if (!v || typeof v !== "object") return d;
    for (const k of ["reach", "done", "skip"]) if (Array.isArray(v[k]) && v[k].length === 4 && v[k].every(x => Number.isInteger(x) && x >= 0)) d[k] = v[k].slice();
    return d;
  }
  function normalize(v, K) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const p = blank(K);
    p.scope = normScope(v.scope, K);
    p.scopeSet = v.scopeSet === true;
    p.picks = Array.isArray(v.picks) ? v.picks.filter(x => typeof x === "string" && K.byId.has(x)).slice(0, 12) : [];
    p.history = normHistory(v.history, K);
    p.funnel = normFunnel(v.funnel);
    p.step = Number.isInteger(v.step) && v.step >= 0 && v.step <= 3 ? v.step : 0;
    p.updated_at = typeof v.updated_at === "string" ? v.updated_at : null;
    return p;
  }
  /* 옛 키 흡수. cg.profile 이 없고 cg.onboard.* 가 있을 때 한 번만 */
  function migrate(K) {
    if (ls.get(LS_KEY)) return null;
    const hist = ls.get(OLD_KEYS.hist), picks = ls.get(OLD_KEYS.picks), funnel = ls.get(OLD_KEYS.funnel), step = ls.get(OLD_KEYS.step);
    if (hist == null && picks == null && funnel == null && step == null) return null;
    const p = normalize({ scope: null, scopeSet: false, picks, history: hist, funnel, step }, K);
    if (p && (p.picks.length || p.history.length)) { p.updated_at = new Date().toISOString(); ls.set(LS_KEY, p); }
    for (const k of Object.values(OLD_KEYS)) ls.del(k);
    return p && (p.picks.length || p.history.length) ? p : null;
  }
  function load() {
    const K = corpus();
    const v = ls.get(LS_KEY);
    if (v == null) return migrate(K);
    return normalize(v, K);
  }
  function save(p) {
    const K = corpus();
    const n = normalize(p, K); if (!n) return false;
    n.updated_at = new Date().toISOString();
    return ls.set(LS_KEY, n);
  }
  function reset() { ls.del(LS_KEY); for (const k of Object.values(OLD_KEYS)) ls.del(k); }
  function has() { const p = load(); return !!(p && (p.picks.length || p.history.length)); }
  /* 프로필이 있을 때만 기록한다. 없을 때는 mock 위에서 노는 중이라 세션 안에서만 반응한다 */
  function addReaction(nodeId, reaction, source, extra) {
    const p = load();
    if (!p || !REACTIONS.has(reaction)) return false;
    const K = corpus();
    const node_id = typeof nodeId === "string" && K.byId.has(nodeId) ? nodeId : null;
    const arxiv = (extra && extra.arxiv) || (node_id ? K.byId.get(node_id).arxiv : null) || null;
    if (!node_id && !arxiv) return false;
    p.history = p.history.filter(h => node_id ? h.node_id !== node_id : h.arxiv !== arxiv);
    p.history.push({ node_id, arxiv, read_at: (extra && extra.read_at) || new Date().toISOString(), reaction, source: source || "session" });
    return save(p);
  }
  /* 시드 목록: 이력 중 코퍼스 안 노드. 반응·시각·출처 포함 */
  function seeds(p) {
    p = p || load(); if (!p) return [];
    const K = corpus();
    return p.history.filter(h => h.node_id && K.byId.has(h.node_id)).map(h => ({ node_id: h.node_id, reaction: h.reaction, ts: Date.parse(h.read_at) || Date.now(), source: h.source }));
  }

  /* 페이지 진입 한 번에 필요한 것 전부. 프로필이 있으면 그 범위·시드, 없으면 기본 범위 + mock 이력 */
  function pageGraph(opts) {
    const K = corpus();
    const p = load();
    const usingProfile = !!(p && (p.picks.length || p.history.length));
    let seedIds, scope;
    if (usingProfile) { seedIds = seeds(p).filter(s => s.reaction !== "skipped").map(s => s.node_id); scope = p.scope; }
    else {
      // data/reading-history.js 는 const 라 window 속성이 아니다. 전역 렉시컬 스코프에서 직접 본다
      const mock = (typeof READING_HISTORY !== "undefined" && Array.isArray(READING_HISTORY)) ? READING_HISTORY
        : (typeof window !== "undefined" && Array.isArray(window.READING_HISTORY)) ? window.READING_HISTORY : (opts && opts.mock) || [];
      seedIds = mock.map(h => h[0]).filter(id => K.byId.has(id));
      // mock 은 손 코퍼스 위에서 설계된 이력이라 손 코퍼스(seed 노드)는 전부 보여주고, 확장 노드는 기본 범위로 거른다
      scope = defaultScope(K);
      if (K.nodes.length <= BIG) scope.depth = null;   // 손 코퍼스는 전부 보여준다 (예전 화면과 동일)
    }
    const sub = scopeGraph(K, scope, seedIds, opts);
    // 프로필이 없으면 시드 노드(손 코퍼스)는 항상 보이게 한다
    if (!usingProfile && K.nodes.length > sub.nodes.length) {
      const ids = new Set(sub.ids);
      for (const n of K.nodes) if (n.seed) ids.add(n.id);
      sub.ids = ids; sub.nodes = K.nodes.filter(n => ids.has(n.id)); sub.edges = K.edges.filter(e => ids.has(e.from) && ids.has(e.to));
    }
    const outside = usingProfile ? p.history.filter(h => !h.node_id).length : 0;
    return { corpus: K, profile: p, usingProfile, sub, tuples: tuples(sub), seedIds, scope: normScope(scope, K), outside,
      scopeLabel: scopeLabel(scope, K),
      /* graph.html · safari.html 이 공유하는 배너 HTML */
      bannerHTML: usingProfile
        ? `<span>온보딩 시드 <b>${esc(seedIds.length)}</b>개${outside ? ` · 그래프 밖 <b>${esc(outside)}</b>개 제외` : ""} · 범위: ${esc(scopeLabel(scope, K))} · 논문 <b>${esc(sub.nodes.filter(n => n.kind === "paper").length)}</b>편</span><span class="sp"></span><a href="./onboard.html#step=0">범위 바꾸기</a><a href="./onboard.html#step=1">이력 더하기</a>`
        : `<span>지금은 <b>mock 독서 이력</b> 위에서 보고 있습니다. 온보딩을 하면 내 시드로 바뀝니다</span><span class="sp"></span><a href="./onboard.html">온보딩 →</a>`
    };
  }

  window.CG = Object.assign(window.CG || {}, {
    esc, corpus, scopeGraph, tuples, scopeLabel, pageGraph, TOPIC_LABELS, TOPIC_COLORS, CAT_LABELS,
    profile: { KEY: LS_KEY, load, save, reset, has, blank, migrate, addReaction, seeds, defaultScope, presets, normScope }
  });
})();
