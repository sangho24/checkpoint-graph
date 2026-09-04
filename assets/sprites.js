/* ═══════════════════════════════════════════════════════════════
   CG_SPRITES — Checkpoint Graph 사람 캐릭터 스프라이트 렌더러

   · 순수 Canvas 2D 프리미티브만 사용 (이미지/SVG/외부 라이브러리 없음)
   · 어두운 배경(#0A0E1C) 위에서 실루엣이 뜨도록 어두운 외곽선 + 등불색 림라이트
   · 전역 노출은 CG_SPRITES 하나뿐

   API
     CG_SPRITES.CHARACTERS                     4인 캐릭터 정의
     CG_SPRITES.drawWalker(ctx, cx, cy, opts)  필드용 소형 스프라이트 (몸통 중심 기준)
     CG_SPRITES.drawPortrait(ctx, cx, cy, opts) 선택 화면용 대형 초상
   ═══════════════════════════════════════════════════════════════ */
(function (root) {
  "use strict";

  var TAU = Math.PI * 2;
  var OUTLINE = "#060911";              // 파츠 분리용 어두운 테두리
  var EYE = "#161A28";
  var RIM = "rgba(255,233,168,.52)";    // 등불색 림라이트
  var SHADOW = "rgba(0,0,0,.35)";

  /* ── 색 유틸 ─────────────────────────────────────────────── */
  function hex2rgb(h) {
    h = String(h).replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
  /** k<1 이면 어둡게, k>1 이면 흰색 쪽으로 밝게 */
  function shade(h, k) {
    var c = hex2rgb(h);
    var f = function (v) { return clamp255(k < 1 ? v * k : v + (255 - v) * (k - 1)); };
    return "rgb(" + f(c[0]) + "," + f(c[1]) + "," + f(c[2]) + ")";
  }
  function rgba(h, a) {
    var c = hex2rgb(h);
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }

  /* ── 도형 유틸 ───────────────────────────────────────────── */
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function ell(ctx, x, y, rx, ry, rot) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot || 0, 0, TAU);
  }
  /** 현재 path 를 채우고 어두운 테두리를 두른다 */
  function ink(ctx, fill, lw, stroke) {
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (lw > 0) {
      ctx.lineJoin = "round";
      ctx.lineWidth = lw;
      ctx.strokeStyle = stroke || OUTLINE;
      ctx.stroke();
    }
  }

  /* ═══════════════════════════════════════════════════════════
     머리모양 / 장식 스타일
     각 스타일은 back(머리 뒤 레이어) · front(머리 위 레이어) ·
     deco(몸통 위 레이어) · hand(손 소지품) 을 선택적으로 갖는다.
     g = 렌더 컨텍스트 묶음 {ctx,P,S,hR,headCY,shY,hipY,footY,bw,side,back,sw,LW,detail}
     ═══════════════════════════════════════════════════════════ */
  var HAIR = {

    /* ── 챙 넓은 탐사모 : 가로로 넓은 실루엣 ── */
    hat: {
      front: function (g) {
        var ctx = g.ctx, P = g.P, hR = g.hR, cy = g.headCY, LW = g.LW;
        var hatC = shade(P.top, 0.60), hatD = shade(P.top, 0.42);
        var ox = g.side ? 0.3 : 0;

        // 모자 밑으로 삐져나온 머리칼 (앞/옆 방향만)
        if (!g.back) {
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(ox, cy + 0.2, hR * 1.0, hR * 1.04, 0, 0, TAU);
          ctx.clip();
          ell(ctx, ox, cy - hR * 0.42, hR * 1.08, hR * 0.9);
          ink(ctx, P.hair, 0);
          if (!g.side) {
            // 귀 옆으로 흘러내린 잔머리
            ell(ctx, -hR * 0.86, cy + 0.15, hR * 0.32, hR * 0.8);
            ink(ctx, P.hair, 0);
            ell(ctx, hR * 0.86, cy + 0.15, hR * 0.32, hR * 0.8);
            ink(ctx, P.hair, 0);
          } else {
            ell(ctx, -hR * 0.55, cy + 0.1, hR * 0.7, hR * 0.95);
            ink(ctx, P.hair, 0);
          }
          ctx.restore();
        }

        // 크라운
        var cw = hR * 0.8, ch = hR * 1.05;
        var cxo = g.side ? -0.7 : 0;
        rrect(ctx, cxo - cw, cy - hR * 0.42 - ch, cw * 2, ch + 1.4, hR * 0.44);
        ink(ctx, hatC, LW);
        // 모자 띠
        rrect(ctx, cxo - cw, cy - hR * 0.72, cw * 2, hR * 0.36, 0.35);
        ink(ctx, P.accent, 0);

        // 챙
        if (g.side) {
          ell(ctx, -0.7, cy - hR * 0.36, hR * 1.72, hR * 0.34);
          ink(ctx, hatD, LW);
        } else {
          ell(ctx, 0, cy - hR * 0.36, hR * 1.86, hR * 0.46);
          ink(ctx, hatD, LW);
        }
        // 림라이트 (크라운 좌상단)
        ctx.beginPath();
        ctx.arc(cxo, cy - hR * 0.42 - ch * 0.4, cw * 1.0, Math.PI * 1.06, Math.PI * 1.55);
        ctx.lineWidth = LW * 0.95; ctx.strokeStyle = RIM; ctx.lineCap = "round"; ctx.stroke();
        ctx.lineCap = "butt";
      },
      deco: function (g) {
        // 어깨에 두른 가방끈 + 허리 가방
        var ctx = g.ctx, P = g.P, LW = g.LW, bw = g.bw, shY = g.shY;
        ctx.beginPath();
        ctx.moveTo(-bw * 0.85, shY + 0.2);
        ctx.lineTo(bw * 0.7, g.hipY + 0.4);
        ctx.lineWidth = LW * 1.5; ctx.strokeStyle = P.accent; ctx.stroke();
        rrect(ctx, bw * 0.45, g.hipY - 0.4, 3.0, 2.8, 0.8);
        ink(ctx, shade(P.bottom, 1.25), g.LW);
      }
    },

    /* ── 후드 망토 : 둥글고 부드러운 실루엣 ── */
    hood: {
      back: function (g) {
        var ctx = g.ctx, P = g.P, hR = g.hR, LW = g.LW;
        var cloak = shade(P.top, 0.62);          // 망토는 몸통보다 확실히 어둡게
        // 등 뒤 망토 (몸통 실루엣을 감싸되 폭은 절제)
        ctx.beginPath();
        ctx.moveTo(-g.bw - 0.4, g.shY + 0.2);
        ctx.quadraticCurveTo(-g.bw - 2.2, g.hipY + 2.6, -g.bw * 0.5 + g.sw * 0.7, g.footY - 2.2);
        ctx.lineTo(g.bw * 0.5 + g.sw * 0.7, g.footY - 2.2);
        ctx.quadraticCurveTo(g.bw + 2.2, g.hipY + 2.6, g.bw + 0.4, g.shY + 0.2);
        ctx.closePath();
        ink(ctx, cloak, LW);
        // 뒤통수를 감싼 후드 볼륨 (머리보다 살짝만 크게)
        ell(ctx, g.side ? -1.0 : 0, g.headCY - 0.3, hR * 1.13, hR * 1.16);
        ink(ctx, cloak, LW);
      },
      front: function (g) {
        var ctx = g.ctx, P = g.P, hR = g.hR, cy = g.headCY, LW = g.LW;
        var ox = g.side ? -0.5 : 0;
        if (g.back) {
          // 뒤통수: 후드가 머리 전체를 덮는다
          ell(ctx, 0, cy - 0.2, hR * 1.1, hR * 1.14);
          ink(ctx, P.top, LW);
          ctx.beginPath();
          ctx.arc(0, cy - 0.2, hR * 0.62, Math.PI * 0.15, Math.PI * 0.85);
          ctx.lineWidth = LW; ctx.strokeStyle = shade(P.top, 0.7); ctx.stroke();
        } else {
          // 앞머리
          ctx.save();
          ell(ctx, g.side ? 0.5 : 0, cy, hR * 0.99, hR * 1.05);
          ctx.clip();
          ell(ctx, ox, cy - hR * 0.55, hR * 1.1, hR * 0.86);
          ink(ctx, P.hair, 0);
          ctx.restore();
          // 후드 앞 테두리 — 볼 옆까지 감싸는 두꺼운 천
          ctx.beginPath();
          ctx.ellipse(ox, cy - 0.2, hR * 1.30, hR * 1.34, 0, Math.PI * 0.80, Math.PI * 2.20);
          ctx.ellipse(ox, cy - 0.2, hR * 0.88, hR * 0.94, 0, Math.PI * 2.20, Math.PI * 0.80, true);
          ctx.closePath();
          ink(ctx, P.top, LW);
          // 얼굴에 지는 후드 그늘
          ctx.save();
          ell(ctx, g.side ? 0.5 : 0, cy, hR * 0.97, hR * 1.03);
          ctx.clip();
          ell(ctx, ox, cy - hR * 1.15, hR * 1.2, hR * 0.95);
          ctx.fillStyle = "rgba(20,14,4,.16)"; ctx.fill();
          ctx.restore();
        }
        // 후드 뒤로 넘어간 뾰족한 끝
        ctx.beginPath();
        ctx.moveTo(ox - hR * 0.55, cy - hR * 0.9);
        ctx.quadraticCurveTo(ox - hR * 0.1, cy - hR * 1.85, ox + hR * 0.5, cy - hR * 1.0);
        ctx.quadraticCurveTo(ox, cy - hR * 1.1, ox - hR * 0.55, cy - hR * 0.9);
        ctx.closePath();
        ink(ctx, shade(P.top, 0.86), LW);
        ctx.beginPath();
        ctx.arc(ox, cy - 0.2, hR * 1.31, Math.PI * 1.02, Math.PI * 1.48);
        ctx.lineWidth = g.LW; ctx.strokeStyle = RIM; ctx.lineCap = "round"; ctx.stroke();
        ctx.lineCap = "butt";
      },
      /** 앞손에 든 등불 */
      hand: function (g, hx, hy) {
        var ctx = g.ctx, P = g.P, LW = g.LW;
        var gy = hy + 2.0;
        var gl = ctx.createRadialGradient(hx, gy, 0.5, hx, gy, 5.4);
        gl.addColorStop(0, rgba(P.accent, 0.42));
        gl.addColorStop(1, rgba(P.accent, 0));
        ctx.fillStyle = gl;
        ell(ctx, hx, gy, 5.4, 5.4); ctx.fill();
        ctx.beginPath(); ctx.moveTo(hx, hy - 0.2); ctx.lineTo(hx, hy + 0.9);
        ctx.lineWidth = LW; ctx.strokeStyle = shade(P.bottom, 0.6); ctx.stroke();
        rrect(ctx, hx - 1.2, hy + 0.8, 2.4, 2.7, 0.6);
        ink(ctx, P.accent, LW);
      }
    },

    /* ── 높은 포니테일 + 스카프 : 길고 날렵한 실루엣 ── */
    pony: {
      back: function (g) {
        var ctx = g.ctx, P = g.P, hR = g.hR, cy = g.headCY, LW = g.LW;
        var sway = g.sw * 1.1;
        if (g.back) return;                       // 위 방향은 앞 레이어에서 그린다
        if (g.side) {
          // 옆모습: 뒤로 뻗은 꼬리
          ctx.beginPath();
          ctx.moveTo(-hR * 0.2, cy - hR * 0.95);
          ctx.quadraticCurveTo(-hR * 2.3, cy - hR * 1.5 + sway, -hR * 2.5, cy + hR * 0.35 + sway);
          ctx.quadraticCurveTo(-hR * 1.5, cy - hR * 0.15, -hR * 0.6, cy - hR * 0.2);
          ctx.closePath();
        } else {
          // 정면: 머리 뒤로 솟은 꼬리
          ctx.beginPath();
          ctx.moveTo(hR * 0.15, cy - hR * 0.9);
          ctx.quadraticCurveTo(hR * 1.9, cy - hR * 1.9, hR * 2.15 + sway, cy - hR * 0.35);
          ctx.quadraticCurveTo(hR * 1.25, cy - hR * 0.85, hR * 0.5, cy - hR * 0.35);
          ctx.closePath();
        }
        ink(ctx, P.hair, LW);
      },
      front: function (g) {
        var ctx = g.ctx, P = g.P, hR = g.hR, cy = g.headCY, LW = g.LW;
        var ox = g.side ? 0.5 : 0;
        // 머리 캡
        ctx.save();
        ell(ctx, ox, cy, hR * 1.04, hR * 1.08);
        ctx.clip();
        ell(ctx, ox, cy - hR * 0.42, hR * 1.12, hR * 0.98);
        ink(ctx, P.hair, 0);
        ctx.restore();
        if (g.back) {
          // 뒤통수 전체 + 등으로 늘어진 꼬리
          ell(ctx, 0, cy, hR * 1.02, hR * 1.06);
          ink(ctx, P.hair, LW);
          rrect(ctx, -1.5 + g.sw * 0.7, cy + hR * 0.2, 3.0, hR * 2.0, 1.4);
          ink(ctx, shade(P.hair, 1.18), LW);
        }
        // 이마 위로 묶어 올린 매듭
        ell(ctx, ox + (g.side ? -0.4 : 0), cy - hR * 0.98, hR * 0.42, hR * 0.34);
        ink(ctx, shade(P.hair, 1.2), LW);
        ctx.beginPath();
        ctx.arc(ox, cy, hR * 1.06, Math.PI * 1.06, Math.PI * 1.5);
        ctx.lineWidth = g.LW; ctx.strokeStyle = RIM; ctx.lineCap = "round"; ctx.stroke();
        ctx.lineCap = "butt";
      },
      deco: function (g) {
        // 목에 감은 스카프 + 뒤로 날리는 자락
        var ctx = g.ctx, P = g.P, LW = g.LW, shY = g.shY, bw = g.bw;
        var sway = g.sw * 1.4;
        ctx.beginPath();
        if (g.side) {
          ctx.moveTo(-0.5, shY - 0.6);
          ctx.quadraticCurveTo(-4.5, shY - 2.6 + sway, -7.5, shY + 1.2 + sway);
          ctx.quadraticCurveTo(-4.5, shY + 0.4 + sway * 0.4, -0.5, shY + 1.4);
        } else {
          ctx.moveTo(bw * 0.2, shY - 0.4);
          ctx.quadraticCurveTo(bw + 3.2, shY - 2.4 + sway, bw + 5.4, shY + 2.0 + sway);
          ctx.quadraticCurveTo(bw + 1.6, shY + 0.6 + sway * 0.4, bw * 0.2, shY + 1.6);
        }
        ctx.closePath();
        ink(ctx, shade(P.accent, 0.96), LW);
        rrect(ctx, -bw * 0.95, shY - 1.5, bw * 1.9, 2.4, 1.0);
        ink(ctx, P.accent, LW);
      }
    },

    /* ── 짧게 친 머리 + 각진 어깨 : 묵직한 실루엣 ── */
    crop: {
      front: function (g) {
        var ctx = g.ctx, P = g.P, hR = g.hR, cy = g.headCY, LW = g.LW;
        var ox = g.side ? 0.5 : 0;
        if (g.back) {
          ell(ctx, 0, cy - 0.1, hR * 1.03, hR * 1.06);
          ink(ctx, P.hair, LW);
          ctx.beginPath();
          ctx.moveTo(-hR * 0.75, cy + hR * 0.75);
          ctx.quadraticCurveTo(0, cy + hR * 0.3, hR * 0.75, cy + hR * 0.75);
          ctx.lineWidth = LW; ctx.strokeStyle = shade(P.hair, 1.5); ctx.stroke();
        } else {
          // 각진 앞머리
          ctx.save();
          ell(ctx, ox, cy, hR * 1.04, hR * 1.08);
          ctx.clip();
          ctx.beginPath();
          ctx.moveTo(-hR * 1.2, cy - hR * 1.3);
          ctx.lineTo(hR * 1.2, cy - hR * 1.3);
          ctx.lineTo(hR * 1.2, cy - hR * 0.22);
          ctx.lineTo(hR * 0.15, cy - hR * 0.52);
          ctx.lineTo(-hR * 1.2, cy - hR * 0.12);
          ctx.closePath();
          ink(ctx, P.hair, 0);
          ctx.restore();
        }
        // 이마 서클릿
        ctx.beginPath();
        ctx.moveTo(ox - hR * 0.92, cy - hR * 0.14);
        ctx.quadraticCurveTo(ox, cy - hR * 0.44, ox + hR * 0.92, cy - hR * 0.14);
        ctx.lineWidth = g.LW * 1.1; ctx.strokeStyle = P.accent; ctx.stroke();
        ctx.beginPath();
        ctx.arc(ox, cy, hR * 1.06, Math.PI * 1.04, Math.PI * 1.5);
        ctx.lineWidth = g.LW * 1.15; ctx.strokeStyle = RIM; ctx.lineCap = "round"; ctx.stroke();
        ctx.lineCap = "butt";
      },
      deco: function (g) {
        // 각진 어깨 갑주 + 세로 라인
        var ctx = g.ctx, P = g.P, LW = g.LW, shY = g.shY, bw = g.bw;
        var pad = function (sx) {
          ctx.beginPath();
          ctx.moveTo(sx * bw * 0.42, shY - 1.5);
          ctx.lineTo(sx * (bw + 1.5), shY - 0.7);
          ctx.lineTo(sx * (bw + 1.1), shY + 2.3);
          ctx.lineTo(sx * bw * 0.42, shY + 1.4);
          ctx.closePath();
          ink(ctx, shade(P.top, 1.45), LW);
        };
        pad(-1); pad(1);
        // 밝은 옷깃 (어두운 배경에서 실루엣을 살린다)
        ctx.beginPath();
        ctx.moveTo(-bw * 0.5, shY - 1.4);
        ctx.lineTo(0, shY + 2.2);
        ctx.lineTo(bw * 0.5, shY - 1.4);
        ctx.closePath();
        ink(ctx, P.accent, LW * 0.8);
        // 로브 가운데 라인
        ctx.beginPath();
        ctx.moveTo(0, shY + 2.4);
        ctx.lineTo(0, g.hipY + (g.S.hem || 0) - 0.4);
        ctx.lineWidth = LW * 0.9; ctx.strokeStyle = shade(P.accent, 0.72); ctx.stroke();
      }
    }
  };

  /* ═══════════════════════════════════════════════════════════
     캐릭터 4인
     - 밝은 계열 : 등불지기 / 어두운 계열 : 야경꾼 / 중간톤 : 측량가·전령
     - 피부톤 4종 전부 다름
     - palette.style 은 렌더러가 읽는 실루엣 키 (drawWalker 에 palette 만 넘겨도 동작)
     ═══════════════════════════════════════════════════════════ */
  var CHARACTERS = [
    {
      id: "surveyor",
      name: "측량가",
      blurb: "지도에 없는 길을 먼저 밟는다",
      trait: { key: "sight", label: "비콘 인지 +50%", mult: 1.5 },
      palette: {
        style: "surveyor",
        skin: "#E7B98D", hair: "#4A3323",
        top: "#D2AC63", bottom: "#46566E", accent: "#7FD4E8"
      }
    },
    {
      id: "lamplighter",
      name: "등불지기",
      blurb: "꺼진 인용을 다시 밝히는 사람",
      trait: { key: "light", label: "등불 반경 +30%", mult: 1.3 },
      palette: {
        style: "lamplighter",
        skin: "#F6DCC0", hair: "#E7DECA",
        top: "#F2EEE2", bottom: "#A9814F", accent: "#FFE9A8"
      }
    },
    {
      id: "courier",
      name: "전령",
      blurb: "소문보다 한 걸음 빠르다",
      trait: { key: "speed", label: "이동 속도 +28%", mult: 1.28 },
      palette: {
        style: "courier",
        skin: "#8C5A32", hair: "#241A15",
        top: "#E2624A", bottom: "#33405A", accent: "#FFD9A0"
      }
    },
    {
      id: "warden",
      name: "야경꾼",
      blurb: "어둠 속에서 더 멀리 손을 뻗는다",
      trait: { key: "reach", label: "조우 반경 +50%", mult: 1.5 },
      palette: {
        style: "warden",
        skin: "#C1854E", hair: "#1E2233",
        top: "#312E4E", bottom: "#3B3757", accent: "#A79BFF"
      }
    }
  ];

  /* 실루엣 파라미터 (체형·옷 길이·머리모양) */
  var STYLES = {
    surveyor:    { headR: 5.2, bodyW: 5.0, legGap: 2.4, hem: 2.9, flare: 1.3, tall: 0.0, hair: "hat" },
    lamplighter: { headR: 5.0, bodyW: 4.3, legGap: 2.1, hem: 1.8, flare: 0.7, tall: 0.0, hair: "hood" },
    courier:     { headR: 4.7, bodyW: 4.0, legGap: 2.0, hem: 0.5, flare: 0.0, tall: 1.4, hair: "pony" },
    warden:      { headR: 5.0, bodyW: 5.7, legGap: 2.8, hem: 4.4, flare: 2.4, tall: 0.7, hair: "crop" }
  };
  var DEFAULT_PALETTE = CHARACTERS[0].palette;

  function resolveStyle(opts) {
    var key = (opts && (opts.style || opts.id)) ||
              (opts && opts.palette && opts.palette.style) || "surveyor";
    return STYLES[key] || STYLES.surveyor;
  }

  /* ═══════════════════════════════════════════════════════════
     본체 렌더 (로컬 단위: 전체 높이 약 27~29, 원점 = 몸통 중심)
     ═══════════════════════════════════════════════════════════ */
  function drawFigure(ctx, dir, phase, P, S, LW, detail) {
    var side = (dir === "right" || dir === "left");
    var back = (dir === "up");
    var sw = Math.sin(phase * TAU);              // 걷기 위상 (-1..1)
    var t = S.tall || 0;

    var footY = 12 + t * 0.5;
    var hipY = 3.8 + t * 0.2;
    var shY = -2.8 - t * 0.5;                    // 어깨선
    var hR = S.headR;
    var headCY = shY - hR * 0.9;
    var bw = side ? S.bodyW * 0.76 : S.bodyW;
    var hem = hipY + (S.hem == null ? 1.0 : S.hem);
    var flare = S.flare || 0;
    var hair = HAIR[S.hair] || {};

    /* 발밑 그림자 — 몸 흔들림과 무관하게 바닥에 고정 */
    ell(ctx, 0, footY + 1.5, 6.0 + S.bodyW * 0.32, 2.2);
    ctx.fillStyle = SHADOW; ctx.fill();

    var bob = -Math.abs(sw) * 0.8;               // 걸을 때 몸통 상하 흔들림
    ctx.save();
    ctx.translate(0, bob);

    var g = {
      ctx: ctx, P: P, S: S, LW: LW, detail: detail,
      hR: hR, headCY: headCY, shY: shY, hipY: hipY, footY: footY,
      bw: bw, side: side, back: back, sw: sw
    };

    /* 1. 머리 뒤 레이어 (포니테일 / 후드 볼륨 / 망토) */
    if (hair.back) hair.back(g);

    /* 2. 다리 */
    var bootC = shade(P.bottom, 0.58);
    function leg(x, lift, col) {
      var len = footY - hipY - lift;
      rrect(ctx, x - 1.7, hipY - 0.6, 3.4, len + 0.6, 1.5);
      ink(ctx, col, LW);
      ell(ctx, x + (side ? 0.5 : 0), hipY + len - 0.5, side ? 2.6 : 2.2, 1.5);
      ink(ctx, bootC, LW);
    }
    if (side) {
      leg(-sw * 2.7, 0.5, shade(P.bottom, 0.68));   // 뒤쪽 다리는 어둡게
      leg(sw * 2.7, 0, P.bottom);
    } else {
      leg(-S.legGap, Math.max(0, sw) * 1.8, P.bottom);
      leg(S.legGap, Math.max(0, -sw) * 1.8, P.bottom);
    }

    /* 3. 뒤쪽 팔 (옆모습에서만 별도) */
    function arm(x, ang, col) {
      ctx.save();
      ctx.translate(x, shY + 0.6);
      ctx.rotate(ang);
      rrect(ctx, -1.3, -1.2, 2.6, 6.6, 1.25);
      ink(ctx, col, LW);
      ctx.restore();
      // 손 위치를 회산해 돌려준다
      return [x - 5.0 * Math.sin(ang), shY + 0.6 + 5.0 * Math.cos(ang)];
    }
    var sleeveDark = shade(P.top, 0.72);
    if (side) arm(-1.2, -sw * 0.62, sleeveDark);

    /* 4. 몸통 (옷) */
    ctx.beginPath();
    ctx.moveTo(-bw, shY + 1.6);
    ctx.quadraticCurveTo(-bw - 0.5, shY - 0.8, -bw * 0.52, shY - 1.5);
    ctx.lineTo(bw * 0.52, shY - 1.5);
    ctx.quadraticCurveTo(bw + 0.5, shY - 0.8, bw, shY + 1.6);
    ctx.lineTo(bw * 0.94 + flare, hem);
    ctx.quadraticCurveTo(0, hem + 1.6, -(bw * 0.94 + flare), hem);
    ctx.closePath();
    ink(ctx, P.top, LW);

    /* 5. 몸통 장식 (가방끈 / 스카프 / 어깨갑주) */
    if (hair.deco) hair.deco(g);

    /* 6. 앞쪽 팔 + 손 */
    var handPos;
    var skinHand = P.skin;
    if (side) {
      handPos = arm(1.4, sw * 0.62, P.top);
    } else {
      arm(-(bw + 0.5), sw * 0.30, P.top);
      handPos = arm(bw + 0.5, -sw * 0.30, P.top);
    }
    function hand(pos, col) {
      ell(ctx, pos[0], pos[1], 1.5, 1.45);
      ink(ctx, col, LW);
    }
    if (side) {
      hand([-1.2 - 5.0 * Math.sin(-sw * 0.62), shY + 0.6 + 5.0 * Math.cos(-sw * 0.62)], shade(P.skin, 0.8));
      hand(handPos, skinHand);
    } else {
      hand([-(bw + 0.5) - 5.0 * Math.sin(sw * 0.30), shY + 0.6 + 5.0 * Math.cos(sw * 0.30)], skinHand);
      hand(handPos, skinHand);
    }

    /* 7. 목 + 머리 */
    rrect(ctx, -1.5, shY - 2.6, 3.0, 3.2, 1.1);
    ink(ctx, shade(P.skin, 0.82), LW);
    if (side) ell(ctx, 0.5, headCY, hR * 0.97, hR * 1.06);
    else ell(ctx, 0, headCY, hR, hR * 1.06);
    ink(ctx, P.skin, LW);
    if (side) {
      // 코
      ctx.beginPath();
      ctx.moveTo(hR * 0.82, headCY - 0.2);
      ctx.quadraticCurveTo(hR * 1.28, headCY + 0.5, hR * 0.78, headCY + 1.3);
      ctx.closePath();
      ink(ctx, shade(P.skin, 0.93), LW * 0.8);
    }

    /* 8. 머리 위 레이어 (머리카락 / 모자 / 후드) */
    if (hair.front) hair.front(g);

    /* 9. 얼굴 (위 방향은 뒤통수라 생략) */
    if (!back) {
      var ey = headCY + hR * 0.16;
      ctx.fillStyle = EYE;
      if (side) {
        ell(ctx, hR * 0.5, ey, 0.72, 1.02); ctx.fill();
        if (detail) {
          ctx.fillStyle = "#FFFFFF";
          ell(ctx, hR * 0.5 + 0.28, ey - 0.4, 0.26, 0.3); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(hR * 0.16, ey - 1.65); ctx.lineTo(hR * 0.86, ey - 1.5);
          ctx.lineWidth = LW * 1.1; ctx.strokeStyle = shade(P.hair, 0.9); ctx.stroke();
          ctx.beginPath();
          ctx.arc(hR * 0.62, ey + 2.0, 0.75, 0.15, Math.PI * 0.85);
          ctx.lineWidth = LW; ctx.strokeStyle = shade(P.skin, 0.55); ctx.stroke();
        }
      } else {
        ell(ctx, -hR * 0.4, ey, 0.76, 1.04); ctx.fill();
        ell(ctx, hR * 0.4, ey, 0.76, 1.04); ctx.fill();
        if (detail) {
          ctx.fillStyle = "#FFFFFF";
          ell(ctx, -hR * 0.4 + 0.26, ey - 0.42, 0.26, 0.3); ctx.fill();
          ell(ctx, hR * 0.4 + 0.26, ey - 0.42, 0.26, 0.3); ctx.fill();
          ctx.strokeStyle = shade(P.hair, 0.9); ctx.lineWidth = LW * 1.1;
          ctx.beginPath();
          ctx.moveTo(-hR * 0.72, ey - 1.75); ctx.lineTo(-hR * 0.1, ey - 1.6);
          ctx.moveTo(hR * 0.72, ey - 1.75); ctx.lineTo(hR * 0.1, ey - 1.6);
          ctx.stroke();
          // 입
          ctx.beginPath();
          ctx.arc(0, ey + 1.9, 0.95, 0.2, Math.PI * 0.8);
          ctx.lineWidth = LW; ctx.strokeStyle = shade(P.skin, 0.5); ctx.stroke();
          // 볼
          ctx.fillStyle = rgba("#E88A6A", 0.28);
          ell(ctx, -hR * 0.72, ey + 1.2, 0.9, 0.6); ctx.fill();
          ell(ctx, hR * 0.72, ey + 1.2, 0.9, 0.6); ctx.fill();
        }
      }
    }

    /* 10. 어깨 림라이트 — 어두운 배경에서 실루엣을 띄운다 */
    ctx.beginPath();
    ctx.moveTo(-bw * 0.98, shY + 1.9);
    ctx.quadraticCurveTo(-bw - 0.55, shY - 0.85, -bw * 0.5, shY - 1.5);
    ctx.lineWidth = LW * 0.9; ctx.strokeStyle = RIM;
    ctx.lineCap = "round"; ctx.stroke(); ctx.lineCap = "butt";

    /* 11. 손 소지품 (등불 등) */
    if (hair.hand) hair.hand(g, handPos[0], handPos[1]);

    ctx.restore();
  }

  /* ═══════════════════════════════════════════════════════════
     공개 API
     ═══════════════════════════════════════════════════════════ */

  /**
   * 필드용 걷기 스프라이트.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cx 몸통 중심 x (노드 좌표를 그대로 넣으면 된다)
   * @param {number} cy 몸통 중심 y
   * @param {{dir?:string, phase?:number, scale?:number, palette?:object}} opts
   */
  function drawWalker(ctx, cx, cy, opts) {
    opts = opts || {};
    var dir = opts.dir || "down";
    var phase = typeof opts.phase === "number" ? opts.phase : 0;
    var scale = opts.scale || 1;
    var P = opts.palette || DEFAULT_PALETTE;
    var S = resolveStyle(opts);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    if (dir === "left") ctx.scale(-1, 1);        // 좌향은 우향을 좌우 반전
    drawFigure(ctx, dir === "left" ? "right" : dir, phase, P, S, 1.1, false);
    ctx.restore();
  }

  /**
   * 선택 화면용 큰 초상 (전체 높이 약 100px).
   * @param {{scale?:number, palette?:object, dir?:string, phase?:number}} opts
   */
  function drawPortrait(ctx, cx, cy, opts) {
    opts = opts || {};
    var scale = (opts.scale || 1) * 3.5;
    var P = opts.palette || DEFAULT_PALETTE;
    var S = resolveStyle(opts);
    var dir = opts.dir || "down";
    var phase = typeof opts.phase === "number" ? opts.phase : 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    if (dir === "left") ctx.scale(-1, 1);
    drawFigure(ctx, dir === "left" ? "right" : dir, phase, P, S, 0.42, true);
    ctx.restore();
  }

  root.CG_SPRITES = {
    CHARACTERS: CHARACTERS,
    drawWalker: drawWalker,
    drawPortrait: drawPortrait
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
