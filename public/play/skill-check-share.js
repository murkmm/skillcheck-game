// Skill Check — share image generator
// Called from Godot via: window.skillCheckShareImage(dataJson, callback)
//
// dataJson: JSON string with fields:
//   theme (string)           — e.g. "Disco Elysium: The Return of the Hanged"
//   rank (string)            — "S" | "A" | "B" | "C" | "D" | "F"
//   score (number)           — final score
//   streak (number)          — 0 if no streak
//   stages_cleared (number)  — how many stages completed
//   max_stages (number)      — usually 4
//   emojis (string)          — wordle-style emoji grid as concatenated string
//   is_perfect (bool)
//   date (string)            — "YYYY-MM-DD"
//   url (string)             — "skillcheckgame.com"
//
// callback: Godot callback — called with [status_string]
//   "shared"    — opened native share sheet successfully
//   "downloaded" — fell back to download
//   "cancelled" — user cancelled the share sheet
//   "error"     — something went wrong (logged to console)

(function () {
  "use strict";

  const W = 1200;
  const H = 1200;

  // --- COLOR PALETTE (matches the game's dark cyan theme) ---
  const COLORS = {
    bg:       "#0a0a12",
    panel:    "#151520",
    border:   "#2a2a3a",
    accent:   "#00e5ff",
    warning:  "#ffc94a",
    success:  "#4ade80",
    danger:   "#ff5a5a",
    text:     "#ffffff",
    text_dim: "#8888a0",
  };

  const RANK_COLORS = {
    S: "#ffc94a",
    A: "#4ade80",
    B: "#00e5ff",
    C: "#8888a0",
    D: "#ff8a5a",
    F: "#ff5a5a",
  };

  // ---------- main entry ----------
  window.skillCheckShareImage = async function (dataJson, callback) {
    try {
      const data = typeof dataJson === "string" ? JSON.parse(dataJson) : dataJson;
      const blob = await renderToBlob(data);
      if (!blob) { callback && callback("error"); return; }

      const filename = `skill-check-${data.date || "daily"}.png`;
      const file = new File([blob], filename, { type: "image/png" });
      const shareText = buildShareText(data);

      // --- 1. Try Web Share API (mobile only — desktop Chrome's share UI is flaky) ---
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: "Skill Check",
            text: shareText,
          });
          callback && callback("shared");
          return;
        } catch (err) {
          // User cancelled — that's fine
          if (err && err.name === "AbortError") {
            callback && callback("cancelled");
            return;
          }
          // Any other error — fall through to download
          console.warn("Web Share failed, falling back to download:", err);
        }
      }

      // --- 2. Fallback: download the PNG ---
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      callback && callback("downloaded");
    } catch (err) {
      console.error("skillCheckShareImage error:", err);
      callback && callback("error");
    }
  };

  // ---------- text builder (accompanies the image) ----------
  function buildShareText(d) {
    const lines = [];
    lines.push(`Daily Skill Check — ${d.theme || "Today's Daily"}`);
    lines.push(`Rank ${d.rank || "?"} · Score ${formatNumber(d.score || 0)}`);
    if (d.streak && d.streak > 1) lines.push(`🔥 ${d.streak}-day streak`);
    lines.push(d.url || "skillcheckgame.com");
    return lines.join("\n");
  }

  function formatNumber(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // ---------- canvas renderer ----------
  async function renderToBlob(d) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    drawBackground(ctx);
    drawFrame(ctx);
    drawHeader(ctx, d);
    drawTheme(ctx, d);
    drawRankBadge(ctx, d);
    drawStats(ctx, d);
    drawEmojiGrid(ctx, d);
    drawFooter(ctx, d);

    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  function drawBackground(ctx) {
    // Deep gradient backdrop
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#12121f");
    g.addColorStop(1, "#05050c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Subtle glow behind the center
    const glow = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 800);
    glow.addColorStop(0, "rgba(0, 229, 255, 0.10)");
    glow.addColorStop(1, "rgba(0, 229, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  function drawFrame(ctx) {
    // Rounded inner card
    const pad = 40;
    roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 32);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawHeader(ctx, d) {
    // Small "DAILY SKILL CHECK" eyebrow + date
    ctx.fillStyle = COLORS.text_dim;
    ctx.font = "600 28px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`DAILY SKILL CHECK · ${d.date || ""}`, W / 2, 120);
  }

  function drawTheme(ctx, d) {
    // Big theme name
    const theme = (d.theme || "Today's Daily").toUpperCase();
    ctx.fillStyle = COLORS.accent;
    ctx.textAlign = "center";

    // Auto-fit theme to width
    let size = 62;
    const maxWidth = W - 160;
    ctx.font = `700 ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    while (ctx.measureText(theme).width > maxWidth && size > 30) {
      size -= 2;
      ctx.font = `700 ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    }

    // Wrap if still too long
    const lines = wrapText(ctx, theme, maxWidth);
    const lineHeight = size * 1.1;
    const startY = 200;
    lines.slice(0, 2).forEach((line, i) => {
      ctx.fillText(line, W / 2, startY + i * lineHeight);
    });
  }

  function drawRankBadge(ctx, d) {
    const rank = (d.rank || "F").toUpperCase();
    const cx = W / 2;
    const cy = 480;
    const r = 130;

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.bg;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = RANK_COLORS[rank] || COLORS.text_dim;
    ctx.stroke();

    // Rank letter
    ctx.fillStyle = RANK_COLORS[rank] || COLORS.text_dim;
    ctx.font = "800 160px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(rank, cx, cy + 8);
    ctx.textBaseline = "alphabetic";

    // "RANK" label below
    ctx.fillStyle = COLORS.text_dim;
    ctx.font = "600 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText("RANK", cx, cy + r + 44);
  }

  function drawStats(ctx, d) {
    // Three columns: Score, Stages, Streak
    const y = 720;
    const col1 = W * 0.22;
    const col2 = W * 0.50;
    const col3 = W * 0.78;

    drawStatColumn(ctx, col1, y, "SCORE", formatNumber(d.score || 0), COLORS.accent);

    const stages = `${d.stages_cleared || 0}/${d.max_stages || 4}`;
    drawStatColumn(ctx, col2, y, "STAGES", stages, COLORS.text);

    const streakVal = (d.streak && d.streak > 0) ? `${d.streak}` : "—";
    const streakColor = (d.streak && d.streak > 1) ? COLORS.warning : COLORS.text_dim;
    drawStatColumn(ctx, col3, y, "STREAK", streakVal, streakColor);
  }

  function drawStatColumn(ctx, x, y, label, value, color) {
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.text_dim;
    ctx.font = "600 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(label, x, y);

    ctx.fillStyle = color;
    ctx.font = "800 58px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(value, x, y + 60);
  }

  function drawEmojiGrid(ctx, d) {
    const emojis = (d.emojis || "").trim();
    if (!emojis) return;

    // Split the emoji string into individual emoji (JS handles surrogate pairs via Array.from)
    const cells = Array.from(emojis).filter((c) => c.trim().length > 0);
    if (cells.length === 0) return;

    const maxCells = 15;
    const visible = cells.slice(0, maxCells);
    const perRow = 5;
    const rows = Math.ceil(visible.length / perRow);

    const cellSize = 52;
    const gap = 10;
    const gridW = perRow * cellSize + (perRow - 1) * gap;
    const startX = (W - gridW) / 2;
    const startY = 870;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${cellSize - 6}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

    for (let i = 0; i < visible.length; i++) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const x = startX + col * (cellSize + gap);
      const y = startY + row * (cellSize + gap);
      ctx.fillText(visible[i], x + cellSize / 2, y + cellSize / 2 + 4);
    }

    if (cells.length > maxCells) {
      ctx.fillStyle = COLORS.text_dim;
      ctx.font = "600 24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText("...", W / 2, startY + rows * (cellSize + gap) + 20);
    }

    ctx.textBaseline = "alphabetic";
  }

  function drawFooter(ctx, d) {
    const y = H - 80;

    // Streak banner (only if 2+)
    if (d.streak && d.streak > 1) {
      ctx.fillStyle = COLORS.warning;
      ctx.font = "700 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`🔥 ${d.streak}-DAY STREAK`, W / 2, y - 40);
    } else if (d.is_perfect) {
      ctx.fillStyle = COLORS.warning;
      ctx.font = "700 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("★ PERFECT RUN ★", W / 2, y - 40);
    }

    // URL
    ctx.fillStyle = COLORS.accent;
    ctx.font = "700 32px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(d.url || "skillcheckgame.com", W / 2, y);
  }

  // ---------- utilities ----------
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function wrapText(ctx, text, maxWidth) {
    const words = text.split(" ");
    const lines = [];
    let cur = "";
    for (const w of words) {
      const trial = cur ? cur + " " + w : w;
      if (ctx.measureText(trial).width > maxWidth && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = trial;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }
})();