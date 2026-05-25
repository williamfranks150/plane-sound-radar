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
  if (p.status === "high") return "#607070";

  return "#00ff8a";
}

function psPlaneAlpha(p) {
  return p.status === "high" ? 0.55 : 1;
}

function psPlaneShadowBlur(p) {
  if (p.status === "audible") return 12;
  if (p.status === "approaching") return 10;

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

function psDrawAircraftPath(ctx, p, px, py, cx, cy, scale, col) {
  if (p.entry == null && p.exit == null) return;

  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(cx + (p.x + p.vx * 120) * scale, cy - (p.y + p.vy * 120) * scale);
  ctx.strokeStyle =
    p.status === "audible" ? "rgba(255,80,80,.35)" : "rgba(255,210,60,.3)";
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

  // Extra safety padding prevents the seconds from ever escaping the timer box.
  const tagW = Math.ceil(
    Math.max(measuredW + tagPad * 3.5 + 10 * uiScale, 82 * uiScale),
  );

  const heading = p.track * D2R;
  const forwardX = Math.sin(heading);
  const forwardY = -Math.cos(heading);
  const backX = -forwardX;
  const backY = -forwardY;
  const gap = Math.max(2, 3 * uiScale);

  let x;
  let y;

  if (Math.abs(backX) >= Math.abs(backY)) {
    x = backX >= 0 ? px + size * 0.72 + gap : px - tagW - size * 0.72 - gap;
    y = py - tagH / 2 + backY * size * 0.25;
  } else {
    x = px - tagW / 2 + backX * size * 0.25;
    y = backY >= 0 ? py + size * 0.72 + gap : py - tagH - size * 0.72 - gap;
  }

  const placed = {
    x: Math.round(clamp(x, 4, W - tagW - 4)),
    y: Math.round(clamp(y, 4, H - tagH - 4)),
    w: tagW,
    h: tagH,
  };

  placedLabels.push(placed);

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
  const placedLabels = [];

  ctx.clearRect(0, 0, c.width, c.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  psDrawRadarBackground(ctx, W, H, cx, cy, gridR, effectR, uiScale, pad);
  psDrawSweep(ctx, cx, cy, effectR);

  state.analyzed.forEach((p) => {
    if (p.status === "high" && p.h > rs.radar) return;

    const px = cx + p.x * scale;
    const py = cy - p.y * scale;
    const margin = 80 * uiScale;

    if (px < -margin || px > W + margin || py < -margin || py > H + margin) {
      return;
    }

    const col = psPlaneColor(p);
    const size = psTimedPlaneSize(p, uiScale);

    psDrawAircraftPath(ctx, p, px, py, cx, cy, scale, col);
    const tag = psPlaneTimeTag(p);

    psDrawTimeTag(ctx, tag, p, px, py, size, col, placedLabels, W, H, uiScale);
    psDrawAircraftIcon(ctx, p, px, py, size, col);
  });

  psDrawHomeMarker(ctx, cx, cy);
  ctx.restore();
}
