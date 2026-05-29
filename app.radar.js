"use strict";

function resizeCanvas() {
  const c = $("radar");
  const wrap = c.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const vv = window.visualViewport?.height || window.innerHeight;
  const app = document.querySelector(".app");
  const nonRadar = [...app.children].filter(
    (el) => el !== wrap && !el.classList.contains("hidden"),
  );
  const used =
    nonRadar.reduce((s, el) => s + el.getBoundingClientRect().height, 0) +
    (nonRadar.length + 1) * 6 +
    16;

  const availH = Math.max(280, vv - used);
  const w = Math.floor(Math.max(280, wrap.clientWidth - 8));
  const h = Math.floor(availH);

  c.width = Math.floor(w * dpr);
  c.height = Math.floor(h * dpr);
  c.style.width = w + "px";
  c.style.height = h + "px";
}

function psPlaneColor(p) {
  if (p.status === "audible") return "#ff5050";
  if (p.status === "approaching") return "#ffd040";
  if (p.status === "no-risk" || p.status === "high") return "#607070";

  return "#00ff8a";
}

function psPlaneAlpha(p) {
  if (p.status === "no-risk" || p.status === "high") return 0.45;

  return 1;
}

function psPlaneShadowBlur(p) {
  if (p.status === "audible") return 12;
  if (p.status === "approaching") return 10;
  if (p.status === "no-risk" || p.status === "high") return 1;

  return 6;
}

function psPlaneTimeTag(p) {
  if (p.status === "audible" && p.exit != null) return "-" + fmt(p.exit);
  if (p.status === "approaching" && p.entry != null) return "+" + fmt(p.entry);

  return "";
}

function psPlaneHasTimer(p) {
  return psPlaneTimeTag(p) !== "";
}

function psTimedPlaneSize(p, uiScale) {
  const base = clamp((9 + p.risk * 8) * uiScale, 5, 22 * uiScale);

  return psPlaneHasTimer(p) ? clamp(base * 1.5, 8, 34 * uiScale) : base;
}

function psTimedDisplaySeconds(p) {
  if (p.status === "audible" && p.exit != null) return Math.max(0, p.exit);
  if (p.status === "approaching" && p.entry != null)
    return Math.max(0, p.entry);

  return null;
}

// Position an aircraft on the radar at its TRUE location (rawPx/rawPy are the
// real scaled coordinates). On-canvas aircraft are drawn exactly where they
// are, so motion matches how they actually fly — no synthetic time-radius, no
// bearing smoothing, hence no sideways drift or random jumps.
//
// A timed contact (approaching/audible) beyond the visible canvas is pinned to
// the canvas edge ALONG ITS TRUE BEARING from centre, so it stays visible as
// an edge contact pointing the right way. A non-timed off-canvas contact is
// hidden.
function psDisplayPointForAircraft(
  p,
  rawPx,
  rawPy,
  size,
  isTimed,
  W,
  H,
  uiScale,
  cx,
  cy,
) {
  const iconPad = Math.max(size + 6 * uiScale, 16 * uiScale);

  const onCanvas =
    rawPx >= iconPad &&
    rawPx <= W - iconPad &&
    rawPy >= iconPad &&
    rawPy <= H - iconPad;

  if (onCanvas) return { visible: true, x: rawPx, y: rawPy };

  if (!isTimed) {
    return { visible: false, x: rawPx, y: rawPy };
  }

  const dx = rawPx - cx;
  const dy = rawPy - cy;

  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return { visible: true, x: cx, y: cy };
  }

  let s = 1;

  if (dx > 0) s = Math.min(s, (W - iconPad - cx) / dx);
  else if (dx < 0) s = Math.min(s, (iconPad - cx) / dx);

  if (dy > 0) s = Math.min(s, (H - iconPad - cy) / dy);
  else if (dy < 0) s = Math.min(s, (iconPad - cy) / dy);

  s = clamp(s, 0, 1);

  return { visible: true, x: cx + dx * s, y: cy + dy * s, edge: s < 1 };
}

function psCanvasProtectedRects(canvas, uiScale) {
  const canvasRect = canvas.getBoundingClientRect();
  const ids = ["selectedMicList", "audioSourceBadge"];
  const margin = Math.max(8, 10 * uiScale);

  return ids
    .map((id) => {
      const el = document.getElementById(id);

      if (!el) return null;

      const r = el.getBoundingClientRect();

      if (!r.width || !r.height) return null;

      return {
        x: r.left - canvasRect.left - margin,
        y: r.top - canvasRect.top - margin,
        w: r.width + margin * 2,
        h: r.height + margin * 2,
      };
    })
    .filter(Boolean);
}

function psDrawRadarBackground(
  ctx,
  W,
  H,
  cx,
  cy,
  gridR,
  effectR,
  uiScale,
  pad,
) {
  ctx.fillStyle = "#020907";
  ctx.fillRect(0, 0, W, H);

  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, effectR);
  bg.addColorStop(0, "#061510");
  bg.addColorStop(0.58, "#03100b");
  bg.addColorStop(1, "#020907");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(0,100,60,.17)";
  ctx.lineWidth = 0.7;

  [0.25, 0.5, 0.75, 1].forEach((k) => {
    ctx.beginPath();
    ctx.arc(cx, cy, gridR * k, 0, Math.PI * 2);
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, H);
  ctx.moveTo(0, cy);
  ctx.lineTo(W, cy);
  ctx.stroke();

  ctx.fillStyle = "rgba(80,150,95,.6)";
  ctx.font =
    "800 " +
    Math.round(Math.max(14, 14 * uiScale)) +
    "px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const labelInset = Math.max(14, 16 * uiScale);
  const ringInset = Math.max(8, 10 * uiScale);

  const westR = Math.min(gridR - ringInset, cx - labelInset);
  const eastR = Math.min(gridR - ringInset, W - cx - labelInset);
  const northR = Math.min(gridR - ringInset, cy - labelInset);
  const southR = Math.min(gridR - ringInset, H - cy - labelInset);

  ctx.fillText("N", cx, cy - Math.max(0, northR));
  ctx.fillText("S", cx, cy + Math.max(0, southR));
  ctx.fillText("E", cx + Math.max(0, eastR), cy);
  ctx.fillText("W", cx - Math.max(0, westR), cy);

  ctx.textBaseline = "alphabetic";
}

function psDrawSweep(ctx, cx, cy, effectR) {
  const sr = (state.sweep - 90) * D2R;

  for (let i = 0; i < 30; i++) {
    const t = i / 30;
    const a0 = sr - (1 - t + 1 / 30) * 1.1;
    const a1 = sr - (1 - t) * 1.1;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, effectR, a0, a1);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,255,110," + (1 - t) * 0.055 + ")";
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + effectR * Math.cos(sr), cy + effectR * Math.sin(sr));
  ctx.strokeStyle = "rgba(0,255,100,.92)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function psDrawAircraftIcon(ctx, p, px, py, size, col) {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(p.track * D2R);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.58, size * 0.78);
  ctx.lineTo(0, size * 0.35);
  ctx.lineTo(-size * 0.58, size * 0.78);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = psPlaneShadowBlur(p);
  ctx.globalAlpha = psPlaneAlpha(p);
  ctx.fill();
  ctx.restore();
}

function psLabelOverlaps(a, b) {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

function psBadgeSize(ctx, tag, uiScale) {
  const tagFont = Math.round(Math.max(16, 17 * uiScale));
  const tagPad = Math.max(6, 6 * uiScale);
  const tagH = Math.max(28, 28 * uiScale);

  ctx.font =
    "800 " +
    tagFont +
    "px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";

  const metrics = ctx.measureText(tag);
  const measuredW = Math.ceil(
    Math.max(
      metrics.width,
      Math.abs(metrics.actualBoundingBoxLeft || 0) +
        Math.abs(metrics.actualBoundingBoxRight || 0),
    ),
  );
  const tagW = Math.ceil(
    Math.max(measuredW + tagPad * 2 + 8 * uiScale, 64 * uiScale),
  );

  return { w: tagW, h: tagH, font: tagFont, pad: tagPad };
}

// Place a badge tight against its arrow, preferring the side BEHIND the
// aircraft (opposite its heading) so the label trails it and never sits in
// front of where it is going. On a collision it sweeps around the arrow and,
// only if needed, pushes a little further out. The badge always stays attached
// to its arrow.
function psPlaceBadgeNearArrow(
  px,
  py,
  w,
  h,
  trackDeg,
  size,
  placed,
  W,
  H,
  uiScale,
) {
  const gap = Math.max(5, 6 * uiScale);
  const baseReach = size + gap + Math.max(w / 2, h / 2);
  const minX = 4;
  const minY = 4;
  const maxX = W - 4;
  const maxY = H - 4;

  // Heading unit vector on canvas: x = sin(hdg), y = -cos(hdg).
  // "Behind" the aircraft is the opposite direction.
  const hdg = Number(trackDeg || 0) * D2R;
  const baseAngle = Math.atan2(Math.cos(hdg), -Math.sin(hdg));

  const angleOffsets = [
    0, 30, -30, 60, -60, 95, -95, 130, -130, 165, -165, 180,
  ].map((d) => (d * Math.PI) / 180);
  const reachMults = [1, 1.3, 1.7, 2.1, 2.6];

  for (let m = 0; m < reachMults.length; m++) {
    const reach = baseReach * reachMults[m];

    for (let k = 0; k < angleOffsets.length; k++) {
      const a = baseAngle + angleOffsets[k];
      const bx = px + Math.cos(a) * reach - w / 2;
      const by = py + Math.sin(a) * reach - h / 2;

      if (bx < minX || by < minY || bx + w > maxX || by + h > maxY) continue;

      const cand = { x: bx, y: by, w, h };

      if (!placed.some((r) => psLabelOverlaps(r, cand))) {
        const displaced = m > 0 || Math.abs(angleOffsets[k]) > 0.6;

        return { x: bx, y: by, w, h, displaced };
      }
    }
  }

  const bx = clamp(
    px + Math.cos(baseAngle) * baseReach - w / 2,
    minX,
    maxX - w,
  );
  const by = clamp(
    py + Math.sin(baseAngle) * baseReach - h / 2,
    minY,
    maxY - h,
  );

  return { x: bx, y: by, w, h, displaced: true };
}

function psDrawBadge(ctx, tag, box, col, px, py, size, uiScale, font, pad) {
  if (box.displaced) {
    const nx = clamp(px, box.x, box.x + box.w);
    const ny = clamp(py, box.y, box.y + box.h);
    const d = Math.hypot(nx - px, ny - py);

    if (d > size + 2) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(nx, ny);
      ctx.strokeStyle = "rgba(255,255,255,.20)";
      ctx.lineWidth = Math.max(1, uiScale);
      ctx.stroke();
    }
  }

  ctx.font =
    "800 " +
    font +
    "px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "rgba(0,0,0,.82)";
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = col;
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = col;
  ctx.fillText(tag, box.x + pad, box.y + box.h / 2);

  ctx.textBaseline = "alphabetic";
}

function psDrawHomeMarker(ctx, cx, cy) {
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#d4a017";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, 11, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(212,160,23,.35)";
  ctx.stroke();
}

function drawRadar() {
  const c = $("radar");
  const dpr = window.devicePixelRatio || 1;
  const ctx = c.getContext("2d");
  const W = c.width / dpr;
  const H = c.height / dpr;
  const cx = W / 2;
  const cy = H / 2;
  const pad = 18;
  const farR = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + 18;
  const effectR = Math.max(120, farR);
  const gridR = Math.max(120, Math.min(W, H) / 2 - pad);
  const uiScale = clamp(gridR / 420, 0.55, 1.12);
  const rs = rangeSettings();
  const scale = gridR / rs.radar;
  const protectedRects = psCanvasProtectedRects(c, uiScale);

  ctx.clearRect(0, 0, c.width, c.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  psDrawRadarBackground(ctx, W, H, cx, cy, gridR, effectR, uiScale, pad);
  psDrawSweep(ctx, cx, cy, effectR);

  // ---- Pass 1: resolve all arrow positions, draw arrows, collect obstacles.
  // Every arrow's final position is known before ANY badge is placed, so a
  // badge can avoid all aircraft, not just the ones drawn before it.
  const badges = [];
  const arrowRects = [];

  state.analyzed.forEach((p) => {
    if ((p.status === "high" || p.status === "no-risk") && p.h > rs.radar)
      return;

    const rawPx = cx + p.x * scale;
    const rawPy = cy - p.y * scale;
    const tag = psPlaneTimeTag(p);
    const isTimed = tag !== "";
    const col = psPlaneColor(p);
    const size = psTimedPlaneSize(p, uiScale);
    const dp = psDisplayPointForAircraft(
      p,
      rawPx,
      rawPy,
      size,
      isTimed,
      W,
      H,
      uiScale,
      cx,
      cy,
    );

    if (!dp.visible) return;

    psDrawAircraftIcon(ctx, p, dp.x, dp.y, size, col);

    arrowRects.push({
      x: dp.x - size,
      y: dp.y - size,
      w: size * 2,
      h: size * 2,
    });

    if (isTimed) {
      const bs = psBadgeSize(ctx, tag, uiScale);
      badges.push({
        tag,
        px: dp.x,
        py: dp.y,
        size,
        col,
        track: p.track,
        w: bs.w,
        h: bs.h,
        font: bs.font,
        pad: bs.pad,
        status: p.status,
        sortT: psTimedDisplaySeconds(p) ?? 1e9,
      });
    }
  });

  // ---- Pass 2: place + draw badges, most-urgent first so they win the spot
  // next to their arrow; later ones flow around the clutter.
  const statusOrder = { audible: 0, approaching: 1 };
  badges.sort(
    (a, b) =>
      (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2) ||
      a.sortT - b.sortT,
  );

  const placed = [
    ...protectedRects,
    ...arrowRects,
    { x: cx - 13, y: cy - 13, w: 26, h: 26 }, // home marker
  ];

  badges.forEach((b) => {
    const box = psPlaceBadgeNearArrow(
      b.px,
      b.py,
      b.w,
      b.h,
      b.track,
      b.size,
      placed,
      W,
      H,
      uiScale,
    );

    placed.push({ x: box.x, y: box.y, w: box.w, h: box.h });
    psDrawBadge(
      ctx,
      b.tag,
      box,
      b.col,
      b.px,
      b.py,
      b.size,
      uiScale,
      b.font,
      b.pad,
    );
  });

  psDrawHomeMarker(ctx, cx, cy);
  ctx.restore();
}
