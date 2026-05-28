"use strict";

const PS_RADAR_DISPLAY_CACHE = new Map();

function psRadarCacheKey(p) {
  return String(p && (p.icao || p.callsign || p.raw?.hex || "")).trim();
}

function psGetRadarDisplayCache(p) {
  const key = psRadarCacheKey(p);

  if (!key) return null;

  if (!PS_RADAR_DISPLAY_CACHE.has(key)) {
    PS_RADAR_DISPLAY_CACHE.set(key, {
      dx: null,
      dy: null,
      radius: null,
      lastSeen: 0,
    });
  }

  return PS_RADAR_DISPLAY_CACHE.get(key);
}

function psPruneRadarDisplayCache(now) {
  for (const [key, value] of PS_RADAR_DISPLAY_CACHE.entries()) {
    if (!value || now - Number(value.lastSeen || 0) > 60000) {
      PS_RADAR_DISPLAY_CACHE.delete(key);
    }
  }
}

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

function psCanvasDirectionForAircraft(p) {
  const h = Math.hypot(Number(p.x || 0), Number(p.y || 0));
  let dx;
  let dy;

  if (h > 0.001) {
    dx = Number(p.x || 0) / h;
    dy = -Number(p.y || 0) / h;
  } else {
    const heading = Number(p.track || 0) * D2R;

    dx = Math.sin(heading);
    dy = -Math.cos(heading);
  }

  const cache = psGetRadarDisplayCache(p);

  if (
    !cache ||
    !Number.isFinite(Number(cache.dx)) ||
    !Number.isFinite(Number(cache.dy))
  ) {
    if (cache) {
      cache.dx = dx;
      cache.dy = dy;
      cache.lastSeen = Date.now();
    }

    return { dx, dy };
  }

  const alpha = 0.14;
  let sx = Number(cache.dx) * (1 - alpha) + dx * alpha;
  let sy = Number(cache.dy) * (1 - alpha) + dy * alpha;
  const len = Math.hypot(sx, sy) || 1;

  sx /= len;
  sy /= len;

  cache.dx = sx;
  cache.dy = sy;
  cache.lastSeen = Date.now();

  return { dx: sx, dy: sy };
}

function psTimedDisplayRadius(p, gridR) {
  const seconds = psTimedDisplaySeconds(p);

  if (seconds == null) return gridR * 0.72;

  const windowSeconds = p.status === "approaching" ? 420 : 300;
  const t = clamp(seconds / windowSeconds, 0, 1);

  return gridR * (0.3 + Math.sqrt(t) * 0.58);
}

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
  gridR,
  protectedRects = [],
) {
  const iconPad = Math.max(size + 8 * uiScale, 18 * uiScale);

  if (isTimed) {
    const cache = psGetRadarDisplayCache(p);
    const dir = psCanvasDirectionForAircraft(p);
    const minRadius = gridR * 0.28;
    const maxRadius = gridR * 0.86;
    const targetRadius = clamp(
      psTimedDisplayRadius(p, gridR),
      minRadius,
      maxRadius,
    );
    let displayRadius =
      cache && Number.isFinite(Number(cache.radius))
        ? Number(cache.radius)
        : targetRadius;

    displayRadius = displayRadius * 0.86 + targetRadius * 0.14;

    if (cache) {
      cache.radius = displayRadius;
      cache.lastSeen = Date.now();
    }

    const boundR = size + Math.max(10, 12 * uiScale);

    for (let i = 0; i <= 10; i++) {
      const radius = clamp(
        displayRadius - i * gridR * 0.035,
        minRadius,
        maxRadius,
      );
      const x = cx + dir.dx * radius;
      const y = cy + dir.dy * radius;

      if (
        x >= iconPad &&
        x <= W - iconPad &&
        y >= iconPad &&
        y <= H - iconPad &&
        psPointAvoidsProtectedRects(x, y, boundR, protectedRects)
      ) {
        return { visible: true, x, y };
      }
    }

    const fallbackRadius = clamp(displayRadius, minRadius, maxRadius);

    return {
      visible: true,
      x: clamp(cx + dir.dx * fallbackRadius, iconPad, W - iconPad),
      y: clamp(cy + dir.dy * fallbackRadius, iconPad, H - iconPad),
    };
  }

  const margin = 80 * uiScale;

  if (
    rawPx < -margin ||
    rawPx > W + margin ||
    rawPy < -margin ||
    rawPy > H + margin
  ) {
    return { visible: false, x: rawPx, y: rawPy };
  }

  return { visible: true, x: rawPx, y: rawPy };
}

function psRectOverlapsCircle(rect, circle) {
  const nearestX = clamp(circle.x, rect.x, rect.x + rect.w);
  const nearestY = clamp(circle.y, rect.y, rect.y + rect.h);
  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;

  return dx * dx + dy * dy < circle.r * circle.r;
}

function psClampPointToCanvas(x, y, W, H, inset) {
  return {
    x: clamp(x, inset, W - inset),
    y: clamp(y, inset, H - inset),
  };
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

function psCircleOverlapsRect(x, y, r, rect) {
  const nearestX = clamp(x, rect.x, rect.x + rect.w);
  const nearestY = clamp(y, rect.y, rect.y + rect.h);
  const dx = x - nearestX;
  const dy = y - nearestY;

  return dx * dx + dy * dy < r * r;
}

function psPointAvoidsProtectedRects(x, y, r, protectedRects) {
  return !protectedRects.some((rect) => psCircleOverlapsRect(x, y, r, rect));
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

  // Bind cardinal labels to the visible outer radar circle.
  // On tall/narrow mobile layouts, the full circle can extend beyond the visible canvas,
  // so N/S need independent vertical clamping instead of one shared radius.
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

function psPlaceTimeLabel(preferred, placedLabels, W, H, uiScale) {
  const minX = 4;
  const minY = 4;
  const maxX = W - 4;
  const maxY = H - 4;
  const step = Math.max(24, 28 * uiScale);
  const baseX = clamp(preferred.x, minX, maxX - preferred.w);
  const baseY = clamp(preferred.y, minY, maxY - preferred.h);
  const candidates = [{ x: baseX, y: baseY, w: preferred.w, h: preferred.h }];

  for (let i = 1; i <= 10; i++) {
    candidates.push({
      x: baseX,
      y: clamp(baseY + i * step, minY, maxY - preferred.h),
      w: preferred.w,
      h: preferred.h,
    });
    candidates.push({
      x: baseX,
      y: clamp(baseY - i * step, minY, maxY - preferred.h),
      w: preferred.w,
      h: preferred.h,
    });
  }

  for (const candidate of candidates) {
    if (!placedLabels.some((label) => psLabelOverlaps(label, candidate))) {
      placedLabels.push(candidate);
      return candidate;
    }
  }

  placedLabels.push(candidates[0]);
  return candidates[0];
}

function psDrawTimeTag(
  ctx,
  tag,
  p,
  px,
  py,
  size,
  col,
  placedLabels,
  W,
  H,
  uiScale,
  cx,
  cy,
) {
  if (!tag) return false;

  const tagFont = Math.round(Math.max(18, 19 * uiScale));
  const tagPad = Math.max(7, 7 * uiScale);
  const tagH = Math.max(32, 32 * uiScale);

  ctx.font =
    "800 " +
    tagFont +
    "px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(tag);
  const measuredW = Math.ceil(
    Math.max(
      metrics.width,
      Math.abs(metrics.actualBoundingBoxLeft || 0) +
        Math.abs(metrics.actualBoundingBoxRight || 0),
    ),
  );
  const tagW = Math.ceil(
    Math.max(measuredW + tagPad * 3.5 + 10 * uiScale, 82 * uiScale),
  );

  const radialX = px - cx;
  const radialY = py - cy;
  const radialLen = Math.hypot(radialX, radialY) || 1;
  const inwardX = -radialX / radialLen;
  const inwardY = -radialY / radialLen;
  const gap = Math.max(5, 6 * uiScale);
  const centerDistance = size + gap + tagW / 2;

  let x = px + inwardX * centerDistance - tagW / 2;
  let y = py + inwardY * (size + gap + tagH / 2) - tagH / 2;

  x = Math.round(clamp(x, 4, W - tagW - 4));
  y = Math.round(clamp(y, 4, H - tagH - 4));

  const arrowBound = {
    x: px,
    y: py,
    r: size + Math.max(4, 5 * uiScale),
  };
  let placed = { x, y, w: tagW, h: tagH };

  if (psRectOverlapsCircle(placed, arrowBound)) {
    const nudge = size + tagH + gap * 2;

    placed = {
      x: Math.round(clamp(x + inwardX * nudge, 4, W - tagW - 4)),
      y: Math.round(clamp(y + inwardY * nudge, 4, H - tagH - 4)),
      w: tagW,
      h: tagH,
    };
  }

  ctx.fillStyle = "rgba(0,0,0,.78)";
  ctx.fillRect(placed.x, placed.y, tagW, tagH);
  ctx.strokeStyle = col;
  ctx.strokeRect(placed.x, placed.y, tagW, tagH);
  ctx.fillStyle = col;
  ctx.fillText(tag, placed.x + tagPad, placed.y + tagH / 2);

  ctx.textBaseline = "alphabetic";

  return true;
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
  psPruneRadarDisplayCache(Date.now());
  const protectedRects = psCanvasProtectedRects(c, uiScale);
  const placedLabels = [...protectedRects];

  ctx.clearRect(0, 0, c.width, c.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  psDrawRadarBackground(ctx, W, H, cx, cy, gridR, effectR, uiScale, pad);
  psDrawSweep(ctx, cx, cy, effectR);

  state.analyzed.forEach((p) => {
    if ((p.status === "high" || p.status === "no-risk") && p.h > rs.radar)
      return;

    const rawPx = cx + p.x * scale;
    const rawPy = cy - p.y * scale;
    const tag = psPlaneTimeTag(p);
    const isTimed = tag !== "";
    const col = psPlaneColor(p);
    const size = psTimedPlaneSize(p, uiScale);
    const displayPoint = psDisplayPointForAircraft(
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
      gridR,
      protectedRects,
    );

    if (!displayPoint.visible) return;

    const px = displayPoint.x;
    const py = displayPoint.y;
    psDrawAircraftIcon(ctx, p, px, py, size, col);
    psDrawTimeTag(
      ctx,
      tag,
      p,
      px,
      py,
      size,
      col,
      placedLabels,
      W,
      H,
      uiScale,
      cx,
      cy,
    );
  });

  psDrawHomeMarker(ctx, cx, cy);
  ctx.restore();
}
