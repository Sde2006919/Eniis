/* =========================================================
   手机版专属的几个「会玩」的模块
   1. 天气水晶球：能拖、能晃，球里按当前天气实时下雪/下雨/放晴
   2. 今日温度河：24 小时气温连成一条会呼吸的曲线，可以摸着看每小时
   3. 穿衣小人：体感温度决定穿几层
   4. 今日一句：按天气和时辰写的一句话
   5. 环境音：用 Web Audio 现场合成雨声 / 风声（不需要音频文件）
   6. 滚动渐入 + 主画面视差
   数据从 script.js 广播的 weather:update 事件里拿，不重复请求接口。
   ========================================================= */
(function () {
  const $ = (id) => document.getElementById(id);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------------------------------------------------------
     1. 天气水晶球
     --------------------------------------------------------- */
  const BALL_SKY = {
    sun: ['#bfe6ff', '#3f86c4'],
    cloud: ['#c3d6e4', '#5a7a94'],
    rain: ['#4a6c8c', '#0d2135'],
    snow: ['#eaf4ff', '#9fb9cf'],
    fog: ['#cfd8de', '#808f9b'],
    night: ['#1b2b4e', '#050b16'],
  };

  const BALL = {
    canvas: $('ballCanvas'),
    ctx: null,
    w: 0,
    h: 0,
    dpr: 1,
    kind: 'sun',
    sky: BALL_SKY.sun,
    parts: [],
    tilt: 0,       // -1 ~ 1，球体的光斑偏移
    tiltTarget: 0,
    shake: 0,      // 晃动能量，点一下会飙到 1 再衰减
    raf: null,
    last: 0,
    t: 0,
  };

  /** 按球内天气生成粒子 */
  function buildBallParts() {
    const { w, h, kind } = BALL;
    if (!w || !h) return;
    const r = Math.min(w, h) / 2 - 8;
    const parts = [];

    if (kind === 'rain') {
      for (let i = 0; i < 70; i += 1) {
        parts.push({
          x: Math.random() * w, y: Math.random() * h,
          vy: 260 + Math.random() * 220, len: 6 + Math.random() * 10,
        });
      }
    } else if (kind === 'snow') {
      for (let i = 0; i < 55; i += 1) {
        parts.push({
          x: Math.random() * w, y: Math.random() * h,
          r: 1 + Math.random() * 2.2, vy: 20 + Math.random() * 26,
          phase: Math.random() * 6.28,
        });
      }
    } else if (kind === 'cloud' || kind === 'fog') {
      const n = kind === 'fog' ? 4 : 5;
      for (let i = 0; i < n; i += 1) {
        parts.push({
          x: Math.random() * w, y: r * 0.6 + Math.random() * r * 0.9,
          rx: 18 + Math.random() * 26, ry: 7 + Math.random() * 7,
          vx: 8 + Math.random() * 14,
          a: kind === 'fog' ? 0.16 : 0.42,
        });
      }
    } else if (kind === 'night') {
      for (let i = 0; i < 46; i += 1) {
        parts.push({
          x: Math.random() * w, y: Math.random() * (h * 0.7),
          r: 0.5 + Math.random() * 1.1, tw: Math.random() * 6.28,
        });
      }
    } else {
      // 晴天：几缕慢慢飘的卷云
      for (let i = 0; i < 3; i += 1) {
        parts.push({
          x: Math.random() * w, y: r * 0.9 + Math.random() * r * 0.6,
          rx: 14 + Math.random() * 18, ry: 4 + Math.random() * 4,
          vx: 6 + Math.random() * 8, a: 0.3,
        });
      }
    }
    BALL.parts = parts;
  }

  function resizeBall() {
    if (!BALL.canvas) return;
    const rect = BALL.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    BALL.dpr = Math.min(2, window.devicePixelRatio || 1);
    BALL.w = rect.width;
    BALL.h = rect.height;
    BALL.canvas.width = Math.round(rect.width * BALL.dpr);
    BALL.canvas.height = Math.round(rect.height * BALL.dpr);
    BALL.ctx = BALL.canvas.getContext('2d');
    BALL.ctx.setTransform(BALL.dpr, 0, 0, BALL.dpr, 0, 0);
    buildBallParts();
    if (reduce) drawBall(0);
  }

  function drawBall(dt) {
    const { ctx, w, h } = BALL;
    if (!ctx || !w) return;

    BALL.t += dt;
    BALL.tilt += (BALL.tiltTarget - BALL.tilt) * 0.12;
    BALL.shake *= 0.94;

    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2 - 8;
    const wind = BALL.tilt * 40 + BALL.shake * 90;
    const boost = 1 + BALL.shake * 3;

    ctx.clearRect(0, 0, w, h);

    // 球底下的影子
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.98, r * 0.7, r * 0.13, 0, 0, 6.2832);
    ctx.fillStyle = 'rgba(4, 14, 28, 0.34)';
    ctx.fill();
    ctx.restore();

    // 球内世界
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 6.2832);
    ctx.clip();

    const g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    g.addColorStop(0, BALL.sky[0]);
    g.addColorStop(1, BALL.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    const kind = BALL.kind;

    if (kind === 'sun') {
      // 太阳 + 缓慢旋转的光芒
      const sx = cx + BALL.tilt * 8;
      const sy = cy - r * 0.32;
      const glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, r * 0.55);
      glow.addColorStop(0, 'rgba(255, 236, 180, 0.95)');
      glow.addColorStop(1, 'rgba(255, 214, 120, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.19, 0, 6.2832);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 240, 190, 0.7)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 12; i += 1) {
        const a = BALL.t * 0.0004 + (i / 12) * 6.2832;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a) * r * 0.28, sy + Math.sin(a) * r * 0.28);
        ctx.lineTo(sx + Math.cos(a) * r * 0.42, sy + Math.sin(a) * r * 0.42);
        ctx.stroke();
      }
    }

    if (kind === 'night') {
      // 月亮
      const mx = cx + r * 0.34 + BALL.tilt * 6;
      const my = cy - r * 0.38;
      ctx.fillStyle = '#eaf2ff';
      ctx.beginPath();
      ctx.arc(mx, my, r * 0.17, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = BALL.sky[0];
      ctx.beginPath();
      ctx.arc(mx - r * 0.07, my - r * 0.04, r * 0.15, 0, 6.2832);
      ctx.fill();
    }

    BALL.parts.forEach((p) => {
      if (kind === 'rain') {
        p.y += p.vy * dt * boost;
        p.x += wind * dt;
        if (p.y > h) { p.y = -p.len; p.x = Math.random() * w; }
        if (p.x < -20) p.x += w + 20;
        if (p.x > w + 20) p.x -= w + 20;
        ctx.strokeStyle = 'rgba(220, 240, 255, 0.62)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - wind * 0.03, p.y + p.len);
        ctx.stroke();
      } else if (kind === 'snow') {
        p.y += p.vy * dt * boost;
        p.x += Math.sin(BALL.t * 0.001 + p.phase) * 12 * dt + wind * dt * 0.5;
        if (p.y > h) { p.y = -4; p.x = Math.random() * w; }
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fill();
      } else if (kind === 'cloud' || kind === 'fog' || kind === 'sun') {
        p.x += p.vx * dt * boost;
        if (p.x - p.rx > w) p.x = -p.rx;
        ctx.fillStyle = `rgba(255, 255, 255, ${p.a})`;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, 6.2832);
        ctx.fill();
      } else if (kind === 'night') {
        const tw = 0.45 + 0.55 * Math.abs(Math.sin(BALL.t * 0.0012 + p.tw));
        ctx.fillStyle = `rgba(255, 255, 255, ${tw.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x + BALL.tilt * 4, p.y, p.r, 0, 6.2832);
        ctx.fill();
      }
    });

    ctx.restore();

    // 玻璃质感：内圈阴影 + 高光 + 边缘
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 6.2832);
    const rim = ctx.createRadialGradient(cx, cy, r * 0.72, cx, cy, r);
    rim.addColorStop(0, 'rgba(255, 255, 255, 0)');
    rim.addColorStop(1, 'rgba(255, 255, 255, 0.22)');
    ctx.fillStyle = rim;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.5, 0, 6.2832);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // 会跟着拖动跑的高光
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, 6.2832);
    ctx.clip();
    const hx = cx - r * 0.34 + BALL.tilt * r * 0.3;
    const hy = cy - r * 0.42;
    const spec = ctx.createRadialGradient(hx, hy, 1, hx, hy, r * 0.62);
    spec.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
    spec.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = spec;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }

  function ballLoop(ts) {
    if (!BALL.last) BALL.last = ts;
    const dt = Math.min(0.05, (ts - BALL.last) / 1000);
    BALL.last = ts;
    drawBall(dt);
    BALL.raf = requestAnimationFrame(ballLoop);
  }

  function setBallKind(theme) {
    const map = {
      sunny: 'sun', cloudy: 'cloud', rainy: 'rain',
      snowy: 'snow', hazy: 'fog', night: 'night',
    };
    const kind = map[theme] || 'cloud';
    BALL.sky = BALL_SKY[kind] || BALL_SKY.cloud;
    if (kind !== BALL.kind) {
      BALL.kind = kind;
      buildBallParts();
    }
    if (reduce) drawBall(0);
  }

  /** 拖动 / 点一下晃一晃 */
  function initBallTouch() {
    const wrap = $('ballWrap');
    if (!wrap) return;

    let dragging = false;
    let startX = 0;
    let moved = 0;

    wrap.addEventListener('pointerdown', (e) => {
      dragging = true;
      startX = e.clientX;
      moved = 0;
      wrap.setPointerCapture?.(e.pointerId);
      wrap.classList.add('is-held');
    });

    wrap.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      BALL.tiltTarget = clamp(dx / 70, -1, 1);
    });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      BALL.tiltTarget = 0;
      wrap.classList.remove('is-held');
      if (moved < 6) BALL.shake = 1; // 没怎么动 = 点了一下
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
    wrap.addEventListener('pointerleave', end);
  }

  function initBall() {
    if (!BALL.canvas) return;
    resizeBall();

    if (window.ResizeObserver) {
      new ResizeObserver(() => resizeBall()).observe($('ballWrap'));
    } else {
      window.addEventListener('resize', resizeBall);
    }

    initBallTouch();

    if (reduce) {
      drawBall(0);
    } else {
      BALL.raf = requestAnimationFrame(ballLoop);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          if (BALL.raf) cancelAnimationFrame(BALL.raf);
          BALL.raf = null;
        } else if (!BALL.raf) {
          BALL.last = 0;
          BALL.raf = requestAnimationFrame(ballLoop);
        }
      });
    }
  }

  /* ---------------------------------------------------------
     2. 今日温度河
     --------------------------------------------------------- */
  const RIVER = {
    canvas: $('riverCanvas'),
    ctx: null,
    w: 0,
    h: 0,
    dpr: 1,
    temps: [],
    labels: [],
    hover: null,
  };

  /** 温度 → 颜色：冷蓝到暖橙 */
  function tempColor(t) {
    const p = clamp((t + 5) / 40, 0, 1); // -5° 最冷，35° 最热
    const c1 = [90, 170, 255];
    const c2 = [255, 150, 90];
    const c = c1.map((v, i) => Math.round(v + (c2[i] - v) * p));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  function setRiverData(hourly) {
    RIVER.temps = hourly.map((h) => Number(h.temp));
    RIVER.labels = hourly.map((h) => {
      const m = String(h.fxTime || '').match(/T(\d{2})/);
      return m ? `${m[1]}时` : '';
    });
    RIVER.hover = null;
    drawRiver();
  }

  function resizeRiver() {
    if (!RIVER.canvas) return;
    const rect = RIVER.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    RIVER.dpr = Math.min(2, window.devicePixelRatio || 1);
    RIVER.w = rect.width;
    RIVER.h = rect.height;
    RIVER.canvas.width = Math.round(rect.width * RIVER.dpr);
    RIVER.canvas.height = Math.round(rect.height * RIVER.dpr);
    RIVER.ctx = RIVER.canvas.getContext('2d');
    RIVER.ctx.setTransform(RIVER.dpr, 0, 0, RIVER.dpr, 0, 0);
    drawRiver();
  }

  function drawRiver() {
    const { ctx, w, h, temps } = RIVER;
    if (!ctx || !w || temps.length < 2) return;

    const padX = 10;
    const padTop = 16;
    const padBottom = 20;
    const n = temps.length;
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const span = Math.max(1, max - min);
    const yOf = (t) => padTop + (1 - (t - min) / span) * (h - padTop - padBottom);
    const xOf = (i) => padX + (i / (n - 1)) * (w - padX * 2);

    ctx.clearRect(0, 0, w, h);

    // 平滑曲线：相邻两点的中点做二次贝塞尔控制点
    const path = new Path2D();
    path.moveTo(xOf(0), yOf(temps[0]));
    for (let i = 1; i < n; i += 1) {
      const px = xOf(i - 1);
      const py = yOf(temps[i - 1]);
      const cx2 = xOf(i);
      const cy2 = yOf(temps[i]);
      path.quadraticCurveTo((px + cx2) / 2, py, (px + cx2) / 2, (py + cy2) / 2);
      path.quadraticCurveTo((px + cx2) / 2, cy2, cx2, cy2);
    }

    // 曲线下方的水波填充
    const fill = new Path2D(path);
    fill.lineTo(xOf(n - 1), h);
    fill.lineTo(xOf(0), h);
    fill.closePath();
    const fg = ctx.createLinearGradient(0, padTop, 0, h);
    fg.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
    fg.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
    ctx.fillStyle = fg;
    ctx.fill(fill);

    // 曲线本体：颜色跟着温度走
    const lg = ctx.createLinearGradient(padX, 0, w - padX, 0);
    for (let s = 0; s <= 6; s += 1) {
      const i = Math.round((s / 6) * (n - 1));
      lg.addColorStop(s / 6, tempColor(temps[i]));
    }
    ctx.strokeStyle = lg;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    ctx.stroke(path);

    // 小时刻度
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    [0, 6, 12, 18, n - 1].forEach((i) => {
      if (i >= n || !RIVER.labels[i]) return;
      ctx.fillText(RIVER.labels[i], xOf(i), h - 6);
    });

    // 光标：优先显示手指指到的那小时，否则显示"现在"
    const idx = RIVER.hover === null ? 0 : RIVER.hover;
    const px = xOf(idx);
    const py = yOf(temps[idx]);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(px, padTop - 6);
    ctx.lineTo(px, h - padBottom + 6);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = tempColor(temps[idx]);
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, 6.2832);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = px > w - 34 ? 'right' : 'left';
    ctx.fillText(`${temps[idx]}°`, px + (px > w - 34 ? -8 : 8), py - 8);
  }

  function initRiver() {
    if (!RIVER.canvas) return;
    resizeRiver();

    if (window.ResizeObserver) {
      new ResizeObserver(() => resizeRiver()).observe(RIVER.canvas);
    } else {
      window.addEventListener('resize', resizeRiver);
    }

    const tip = $('riverTip');
    const move = (e) => {
      const rect = RIVER.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const padX = 10;
      const n = RIVER.temps.length;
      if (n < 2) return;
      const ratio = clamp((x - padX) / (rect.width - padX * 2), 0, 1);
      const idx = Math.round(ratio * (n - 1));
      if (idx === RIVER.hover) return;
      RIVER.hover = idx;
      if (tip) tip.textContent = `${RIVER.labels[idx] || ''} ${RIVER.temps[idx]}°`;
      drawRiver();
    };

    RIVER.canvas.addEventListener('pointermove', move);
    RIVER.canvas.addEventListener('pointerdown', move);
    RIVER.canvas.addEventListener('pointerleave', () => {
      RIVER.hover = null;
      if (tip && RIVER.temps.length) tip.textContent = `现在 ${RIVER.temps[0]}°`;
      drawRiver();
    });
  }

  /* ---------------------------------------------------------
     3. 穿衣小人
     --------------------------------------------------------- */
  function setDoll(feels) {
    const box = $('dollBox');
    const tip = $('dollTip');
    if (!box || !tip) return;

    let level = 2;
    let text = '';
    if (feels >= 27) {
      level = 1;
      text = '一件短袖就够，别贪凉对着空调吹。';
    } else if (feels >= 22) {
      level = 1;
      text = '单衣正好，早晚加件薄外套更稳。';
    } else if (feels >= 17) {
      level = 2;
      text = '长袖加薄外套，起风也不怕。';
    } else if (feels >= 11) {
      level = 3;
      text = '外套配围巾，脖子暖了全身都暖。';
    } else if (feels >= 4) {
      level = 4;
      text = '厚外套加帽子，别让耳朵受冻。';
    } else {
      level = 5;
      text = '羽绒服手套都上，今天主打一个「包起来」。';
    }

    box.dataset.level = String(level);
    tip.textContent = `体感 ${feels}° · ${text}`;
  }

  /* ---------------------------------------------------------
     4. 今日一句
     --------------------------------------------------------- */
  function hashOf(str) {
    let h = 0;
    for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) % 100000;
    return h;
  }

  function moodOf(now, today, city) {
    const text = now.text || '';
    const t = Number(now.temp);
    const hum = Number(now.humidity);
    const hour = Number(String(now.obsTime || '').match(/T(\d{2})/)?.[1] ?? new Date().getHours());

    const pool = [];
    if (text.includes('雨')) pool.push('雨把城市按了静音，伞下是自成一格的小世界。');
    else if (text.includes('雪')) pool.push('雪落得很轻，像有人在替这座城盖被子。');
    else if (text.includes('云') || text.includes('阴')) pool.push('云把阳光调成了柔光，今天适合慢慢走。');
    else if (hour < 6) pool.push('天还没醒，风先替这座城翻了个身。');
    else if (hour < 11) pool.push('早上的空气是新的，深吸一口再开始。');
    else if (hour < 17) pool.push('日头正盛，连影子都被晒得短短的。');
    else pool.push('这时候的光是橘色的，路也走得比平时慢一点。');

    if (t >= 30) pool.push('热到连风都是温的，记得多喝点水。');
    if (t <= 3) pool.push('哈气成雾的日子，把手揣兜里吧。');
    if (hum >= 80 && !text.includes('雨')) pool.push('空气能拧出水来，衣服大概不太想干。');
    if (Number(now.windScale) >= 5) pool.push('风有点野，帽子要压紧一点。');

    const seed = hashOf(`${city?.name || ''}${today?.fxDate || ''}`);
    return pool[seed % pool.length];
  }

  /* ---------------------------------------------------------
     5. 环境音：现场合成雨声 / 风声
     --------------------------------------------------------- */
  const SOUND = {
    ctx: null,
    buffer: null,
    src: null,
    gain: null,
    lfo: null,
    on: false,
    kind: 'rain',
  };

  function noiseBuffer(ctx) {
    if (SOUND.buffer) return SOUND.buffer;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    SOUND.buffer = buf;
    return buf;
  }

  function stopSound() {
    if (SOUND.gain && SOUND.ctx) {
      const g = SOUND.gain;
      const t = SOUND.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.4);
    }
    const src = SOUND.src;
    const lfo = SOUND.lfo;
    setTimeout(() => {
      try { src && src.stop(); } catch { /* 已经停了 */ }
      try { lfo && lfo.stop(); } catch { /* 已经停了 */ }
    }, 500);
    SOUND.src = null;
    SOUND.gain = null;
    SOUND.lfo = null;
    SOUND.on = false;
  }

  function startSound(kind) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!SOUND.ctx) SOUND.ctx = new AC();
    const ctx = SOUND.ctx;
    if (ctx.state === 'suspended') ctx.resume();

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    gain.gain.value = 0;

    if (kind === 'rain') {
      filter.type = 'bandpass';
      filter.frequency.value = 1500;
      filter.Q.value = 0.6;
    } else {
      filter.type = 'lowpass';
      filter.frequency.value = 520;
      filter.Q.value = 0.9;
    }

    // 让它有起伏，不然像电视机雪花
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = kind === 'rain' ? 300 : 200;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();

    gain.gain.linearRampToValueAtTime(kind === 'rain' ? 0.16 : 0.24, ctx.currentTime + 1.2);

    SOUND.src = src;
    SOUND.gain = gain;
    SOUND.lfo = lfo;
    SOUND.on = true;
    SOUND.kind = kind;
    return true;
  }

  function paintSoundBtn() {
    const btn = $('soundBtn');
    if (!btn) return;
    const kindText = SOUND.kind === 'rain' ? '雨声' : '风声';
    btn.querySelector('.sound__icon').textContent = SOUND.on ? '⏹' : '🎧';
    btn.querySelector('.sound__text').textContent = SOUND.on ? '关闭' : kindText;
    btn.setAttribute('aria-pressed', SOUND.on ? 'true' : 'false');
    btn.classList.toggle('is-on', SOUND.on);
  }

  function initSound() {
    const btn = $('soundBtn');
    if (!btn) return;
    if (!(window.AudioContext || window.webkitAudioContext)) {
      btn.hidden = true;
      return;
    }
    btn.addEventListener('click', () => {
      if (SOUND.on) stopSound();
      else startSound(SOUND.kind);
      paintSoundBtn();
    });
    paintSoundBtn();
  }

  /* ---------------------------------------------------------
     6. 滚动渐入 + 主画面视差
     --------------------------------------------------------- */
  function initReveal() {
    const cards = document.querySelectorAll('.card, .alert');
    if (!('IntersectionObserver' in window) || reduce) {
      cards.forEach((c) => c.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('is-in');
            io.unobserve(en.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    cards.forEach((c) => io.observe(c));

    // 兜底：万一 observer 没触发（某些内嵌 WebView 就是这样），
    // 2.5 秒后一律放出来，宁可少点动画也不能让内容看不见。
    setTimeout(() => {
      cards.forEach((c) => c.classList.add('is-in'));
    }, 2500);
  }

  function initParallax() {
    const hero = $('hero');
    if (!hero || reduce) return;
    const scroller = document.querySelector('.phone');
    let raf = null;

    const apply = () => {
      raf = null;
      const y = window.scrollY || (scroller ? scroller.scrollTop : 0);
      hero.style.transform = `translate3d(0, ${(-y * 0.12).toFixed(1)}px, 0)`;
      hero.style.opacity = String(Math.max(0.35, 1 - y / 420));
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------------------------------------------------------
     启动
     --------------------------------------------------------- */
  initBall();
  initRiver();
  initSound();
  initReveal();
  initParallax();

  document.addEventListener('weather:update', (e) => {
    const d = e.detail || {};
    const now = d.now || {};
    const hourly = d.hourly || [];
    const today = d.today || (d.daily && d.daily[0]) || {};

    setBallKind(d.theme || 'sunny');
    setRiverData(hourly);

    const tip = $('riverTip');
    if (tip && hourly.length) tip.textContent = `现在 ${hourly[0].temp}°`;

    setDoll(Math.round(Number(now.feelsLike) || Number(now.temp) || 0));

    const mood = $('moodLine');
    if (mood) mood.textContent = moodOf(now, today, d.city);

    SOUND.kind = d.theme === 'rainy' ? 'rain' : 'wind';
    paintSoundBtn();
  });
})();
