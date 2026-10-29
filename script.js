/* =========================================================
   轻声天气 · 逻辑
   数据来源：和风天气 新版 API（v1）
   认证方式：请求头 X-QW-Api-Key（学生作业，直接前端调用，无后端代理）
   ========================================================= */

/* ---------------------------------------------------------
   1. 配置
   --------------------------------------------------------- */
const CONFIG = {
  // 你的专属 API Host（不要带结尾斜杠）
  host: 'https://kg5hv8dd44.re.qweatherapi.com',
  // 你的 API KEY，会放在请求头里
  key: 'e0b1e7e3db3a4e6d869361c686b915ed',
  // 第一次打开时显示的默认城市（北京）
  defaultCity: {
    id: '101010100',
    name: '北京',
    adm1: '北京市',
    adm2: '北京',
    lat: '39.90499',
    lon: '116.40529',
  },
  // 把上次看的城市记在浏览器里
  storageKey: 'qweather:last-city',

  // 实时影像默认用 canvas 现场绘制。
  // 想换成真正的视频，填一个 mp4/webm 直链进来，例如：
  //   liveVideoUrl: 'https://example.com/weather-loop.mp4',
  liveVideoUrl: '',
};

/* 小工具：按 id 取元素 */
const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------
   2. 请求封装
   --------------------------------------------------------- */
/**
 * 和风天气错误码 → 人话
 * 常见：401 Key 不对 / 403 没订阅该接口 / 404 城市不存在 / 429 太频繁
 */
function codeText(code) {
  const map = {
    204: '查询成功，但没有数据（试试别的城市）',
    400: '请求参数有误',
    401: '认证失败，请检查 API KEY',
    402: '账号余额不足或超出调用限额',
    403: '没有权限访问该接口（请检查订阅）',
    404: '查询的城市或数据不存在',
    429: '请求太频繁了，歇一会儿再试',
    500: '和风天气服务器开小差了',
  };
  return map[code] || `接口返回错误码 ${code}`;
}

/**
 * 统一的请求函数
 * @param {string} path  例如 '/v7/weather/now'
 * @param {object} params 查询参数对象
 */
async function request(path, params = {}) {
  const url = new URL(CONFIG.host + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });

  // 12 秒超时，避免一直转圈
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-QW-Api-Key': CONFIG.key }, // 新版 API 的鉴权头
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`网络请求失败（HTTP ${res.status}）`);

    const data = await res.json();
    // 和风天气用 code 表示业务状态，'200' 才是成功（注意是字符串）
    if (data.code && data.code !== '200') throw new Error(codeText(data.code));
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('请求超时，请检查网络');
    // fetch 直接抛 TypeError 通常是断网 / 跨域被拦 / 代理不可用
    if (err instanceof TypeError) {
      throw new Error('连不上和风天气（断网、跨域被拦或系统代理不可用）');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* 具体的接口列表，写在一起方便以后查 */
const api = {
  /** 城市搜索：返回匹配的城市列表（含 id、经纬度） */
  searchCity: (keyword) =>
    request('/geo/v2/city/lookup', { location: keyword, number: 8, lang: 'zh' }),

  /** 实时天气 */
  now: (location) => request('/v7/weather/now', { location, lang: 'zh' }),

  /** 7 天逐日预报（里面也带每天的日出日落） */
  daily7: (location) => request('/v7/weather/7d', { location, lang: 'zh' }),

  /** 日出日落（date 格式 yyyyMMdd，只能查前后 60 天） */
  sun: (location, date) => request('/v7/astronomy/sun', { location, date }),

  /** 分钟级降水（要用 "经度,纬度" 作为 location）→ 下雨提醒的数据来源 */
  minutely: (lonLat) => request('/v7/minutely/5m', { location: lonLat }),

  /** 灾害预警 */
  warnings: (location) => request('/v7/warning/now', { location, lang: 'zh' }),

  /** 24 小时逐时预报（每小时的 pop 就是降水概率） */
  hourly24: (location) => request('/v7/weather/24h', { location, lang: 'zh' }),

  /**
   * 空气质量：走新版 airquality/v1
   * 注意它的 location 是写在路径里的「纬度/经度」，不是查询参数
   */
  airNow: (lat, lon) => {
    const la = (Number(lat) || 0).toFixed(2);
    const lo = (Number(lon) || 0).toFixed(2);
    return request(`/airquality/v1/current/${la}/${lo}`);
  },

  /** 生活指数：type=0 一次拿全部（穿衣、紫外线、洗车……），前端再挑要显示的 */
  indices: (location) => request('/v7/indices/1d', { location, type: 0, lang: 'zh' }),
};

/* ---------------------------------------------------------
   3. 天气代码 → emoji / 主题
   和风天气图标代码规律：
   100~199 晴/多云，300~399 雨，400~499 雪，500~515 雾霾沙尘，900+ 特殊
   --------------------------------------------------------- */
function emojiOf(code) {
  const c = Number(code);
  if (c === 100 || c === 150) return '☀️';
  if (c === 101 || c === 102 || c === 103 || c === 151 || c === 152 || c === 153) return '⛅';
  if (c === 104) return '☁️';
  if (c >= 200 && c <= 213) return '🌬️';
  if (c >= 300 && c <= 399) {
    if (c >= 302 && c <= 304) return '⛈️';
    if (c >= 305 && c <= 312) return '🌧️';
    if (c === 313 || c >= 350) return '🌨️';
    return '🌦️';
  }
  if (c >= 400 && c <= 499) return '❄️';
  if (c >= 500 && c <= 515) return '🌫️';
  if (c === 900) return '🔥';
  if (c === 901) return '🧊';
  return '🌤️';
}

/** 根据天气代码决定页面主题（对应 CSS 里的 body[data-theme]） */
function themeOf(code) {
  const c = Number(code);
  if (c >= 300 && c <= 399) return 'rainy';
  if (c >= 400 && c <= 499) return 'snowy';
  if (c >= 500 && c <= 515) return 'hazy';
  if (c === 104 || (c >= 101 && c <= 103) || (c >= 151 && c <= 153)) return 'cloudy';
  return 'sunny'; // 晴
}

/* ---------------------------------------------------------
   4. 时间小工具
   --------------------------------------------------------- */
/**
 * 把时间统一成 "06:38"
 * 因为不同接口给的格式不一样：
 *   7 天预报： "06:38"
 *   日出日落接口： "2026-10-28T06:38+08:00"
 */
function clockOf(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

/** '06:23' 或 ISO 时间 → 当天第几分钟（用于算太阳位置） */
function toMinutes(value) {
  const clock = clockOf(value);
  if (!clock) return null;
  const [h, m] = clock.split(':').map(Number);
  return h * 60 + m;
}

/* ---------- 北京时间 ----------
   页面所有时间都按 UTC+8 显示，跟电脑/手机所在时区无关。
   用 Intl 指定 timeZone，比手动加减小时数可靠（不受夏令时影响）。 */
const TZ = 'Asia/Shanghai';

const bjTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const bjPartsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 北京时间的 "16:05:23" */
function bjClock(d = new Date()) {
  return bjTimeFmt.format(d);
}

/** 北京时间的 "16:05" */
function bjClockShort(d = new Date()) {
  return bjClock(d).slice(0, 5);
}

/** 北京时间当天第几分钟（0~1439），用来算太阳位置 */
function bjMinutes(d = new Date()) {
  const parts = bjPartsFmt.formatToParts(d);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return get('hour') * 60 + get('minute');
}

/** 北京时间的小时数（0~23），给逐小时预报用 */
function bjHour(d) {
  return Number(bjClock(d).slice(0, 2));
}

/** 北京时间的日期 → yyyyMMdd（给日出日落接口用） */
function compactDate(d = new Date()) {
  const parts = bjPartsFmt.formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}${get('month')}${get('day')}`;
}

/** 星期几的中文 */
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 第 index 天的标签：今天 / 明天 / 周X */
function dayLabel(dateStr, index) {
  if (index === 0) return '今天';
  if (index === 1) return '明天';
  // 用 UTC 解析纯日期，避免本地时区把日期前后挪一天
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? dateStr : WEEK[d.getUTCDay()];
}

/* ---------------------------------------------------------
   5. 页面渲染
   --------------------------------------------------------- */

/** 切换主题 + 生成雨丝 */
function applyTheme(theme) {
  if (document.body.dataset.theme === theme) return;
  document.body.dataset.theme = theme;

  const layer = $('rainLayer');
  layer.innerHTML = '';
  // 只有雨天才有雨丝，其它主题清空即可
  if (theme !== 'rainy') return;

  const frag = document.createDocumentFragment();
  for (let i = 0; i < 60; i += 1) {
    const drop = document.createElement('span');
    drop.style.left = `${Math.random() * 110}%`;
    drop.style.animationDuration = `${0.7 + Math.random() * 0.9}s`;
    drop.style.animationDelay = `${-Math.random() * 2}s`;
    drop.style.opacity = String(0.25 + Math.random() * 0.55);
    frag.appendChild(drop);
  }
  layer.appendChild(frag);
}

/**
 * 城市副标题：避开"北京市 · 北京"这种重复
 * 浙江省 / 杭州市 → 浙江省 · 杭州市；北京市 / 北京 → 北京市
 */
function citySubtitle(city) {
  const a = city.adm1 || '';
  const b = city.adm2 || '';
  if (!a) return b;
  if (!b) return a;
  if (a.includes(b) || b.includes(a)) return a.length >= b.length ? a : b;
  return `${a} · ${b}`;
}

/** 渲染当前天气 */
function renderCurrent(now, city) {
  const cur = now.now;
  $('cityName').textContent = city.name;
  $('citySub').textContent = citySubtitle(city);
  $('nowIcon').textContent = emojiOf(cur.icon);
  // 温度用滚动动画，而不是直接"跳"到新数字
  animateNumber($('temp'), Math.round(Number(cur.temp)));
  $('desc').textContent = cur.text;
  $('feels').textContent = `体感 ${cur.feelsLike}° · ${cur.windDir} ${cur.windScale} 级`;

  $('humidity').textContent = `${cur.humidity}%`;
  $('wind').textContent = `${cur.windDir} ${cur.windScale}级`;
  $('pressure').textContent = `${cur.pressure} hPa`;
  $('vis').textContent = `${cur.vis} km`;

  // 观测时间：把 ISO 时间统一转成北京时间显示
  const t = new Date(cur.obsTime);
  $('obsTime').textContent = Number.isNaN(t.getTime())
    ? '刚刚更新'
    : `更新于 ${bjClockShort(t)} · 北京时间`;
}

/**
 * 渲染日出日落 + 太阳位置
 * @param {object} sunData  { sunrise, sunset }
 */
function renderSun(sunData) {
  // 顺手把两种格式统一成 HH:mm，显示和计算共用
  const sunrise = clockOf(sunData.sunrise) || '--:--';
  const sunset = clockOf(sunData.sunset) || '--:--';
  $('sunrise').textContent = sunrise;
  $('sunset').textContent = sunset;

  const rise = toMinutes(sunrise);
  const set = toMinutes(sunset);
  const dot = $('sunDot');

  if (rise === null || set === null || set <= rise) {
    $('dayLength').textContent = '暂无日出日落数据';
    dot.setAttribute('cx', 100);
    dot.setAttribute('cy', 20);
    return;
  }

  // 北京时间在半圆弧上的进度（0 = 日出，1 = 日落）
  const progress = Math.min(1, Math.max(0, (bjMinutes() - rise) / (set - rise)));
  // 半圆参数方程：t=0 在左边 (10,90)，t=0.5 在顶点 (100,0)，t=1 在右边 (190,90)
  const cx = 100 - 90 * Math.cos(Math.PI * progress);
  const cy = 90 - 90 * Math.sin(Math.PI * progress);
  dot.setAttribute('cx', cx.toFixed(2));
  dot.setAttribute('cy', cy.toFixed(2));

  // 昼长
  const total = set - rise;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const isNight = bjMinutes() < rise || bjMinutes() > set;
  $('dayLength').textContent = isNight
    ? `昼长 ${h} 小时 ${m} 分 · 现在是夜间 🌙`
    : `昼长 ${h} 小时 ${m} 分 · 距离日落还有 ${Math.round(set - bjMinutes())} 分钟`;
}

/** 渲染 7 天预报 */
function renderForecast(daily) {
  const list = daily.daily || [];
  const days = $('days');
  days.innerHTML = '';

  if (!list.length) return;

  // 找出这一周的最低 / 最高温，用来给温度区间条定位
  const highs = list.map((d) => Number(d.tempMax));
  const lows = list.map((d) => Number(d.tempMin));
  const weekMax = Math.max(...highs);
  const weekMin = Math.min(...lows);
  const span = Math.max(1, weekMax - weekMin);

  const frag = document.createDocumentFragment();

  list.forEach((d, i) => {
    const li = document.createElement('li');
    li.className = 'day' + (i === 0 ? ' day--today' : '');

    const left = ((Number(d.tempMin) - weekMin) / span) * 100;
    const right = ((weekMax - Number(d.tempMax)) / span) * 100;

    li.innerHTML = `
      <span class="day__date">${dayLabel(d.fxDate, i)}</span>
      <span class="day__icon" aria-hidden="true">${emojiOf(d.iconDay)}</span>
      <span class="day__text" title="${d.textDay}">${d.textDay}</span>
      <span class="day__temp"><b>${d.tempMax}°</b><i>${d.tempMin}°</i></span>
      <span class="day__bar"><i style="left:${left}%;right:${right}%"></i></span>
    `;
    frag.appendChild(li);
  });

  days.appendChild(frag);
}

/** 渲染 24 小时逐时预报 */
function renderHourly(res) {
  const card = $('hourlyCard');
  const list = (res && res.hourly) || [];

  // 接口没权限 / 没数据时整张卡片收起来，不留空壳
  if (!list.length) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const box = $('hours');
  const frag = document.createDocumentFragment();

  list.forEach((h, i) => {
    const d = new Date(h.fxTime);
    const time = i === 0 ? '现在' : `${String(bjHour(d)).padStart(2, '0')}时`;
    const pop = Number(h.pop) || 0; // 降水概率 %

    const li = document.createElement('li');
    li.className = 'hour' + (i === 0 ? ' hour--now' : '');
    li.innerHTML = `
      <span class="hour__time">${time}</span>
      <span class="hour__icon" aria-hidden="true">${emojiOf(h.icon)}</span>
      <span class="hour__temp">${h.temp}°</span>
      <span class="hour__pop">${pop > 0 ? `💧${pop}%` : ''}</span>
    `;
    frag.appendChild(li);
  });

  box.innerHTML = '';
  box.appendChild(frag);
}

/** AQI 等级配色（接口没给 color 时用） */
const AQI_COLORS = {
  1: '#4fbe78', // 优
  2: '#d8bf3a', // 良
  3: '#f0913f', // 轻度污染
  4: '#e2574c', // 中度污染
  5: '#a259c4', // 重度污染
  6: '#8a4a3a', // 严重污染
};

/** 渲染空气质量卡片 */
function renderAir(res) {
  const card = $('airCard');
  const idx = res && res.indexes && res.indexes[0];

  if (!idx) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const aqiEl = $('aqiValue');
  aqiEl.textContent = idx.aqiDisplay || idx.aqi || '--';

  // 接口会返回 color，缺了就用等级兜底
  const c = idx.color;
  aqiEl.style.color =
    c && typeof c.red === 'number'
      ? `rgb(${c.red}, ${c.green}, ${c.blue})`
      : AQI_COLORS[idx.level] || '';

  $('aqiCategory').textContent = idx.category || '—';

  const primary = idx.primaryPollutant;
  $('aqiPrimary').textContent =
    primary && primary.name ? `首要污染物 ${primary.name}` : '空气干净，没有首要污染物';

  // 六项污染物
  const LABELS = { pm2p5: 'PM2.5', pm10: 'PM10', o3: 'O₃', no2: 'NO₂', so2: 'SO₂', co: 'CO' };
  const box = $('pollutants');
  box.innerHTML = '';

  const frag = document.createDocumentFragment();
  (res.pollutants || []).forEach((p) => {
    const c = p.concentration || {};
    const li = document.createElement('li');
    li.title = `${LABELS[p.code] || p.name} ${c.value || '--'} ${c.unit || ''}`.trim();
    li.innerHTML = `
      <b>${c.value ?? '--'}</b>
      <em>${LABELS[p.code] || p.name || p.code}</em>
    `;
    frag.appendChild(li);
  });
  box.appendChild(frag);
}

/**
 * 生活指数想展示的 6 项。
 * 这里按「名称」匹配，不用 type 编号 —— 因为和风天气的指数编号
 * 新旧版不一样（旧版 2=洗车、3=穿衣、4=钓鱼…），写死编号会错位。
 */
const INDEX_WANTED = [
  { key: '穿衣', icon: '👕' },
  { key: '紫外线', icon: '🕶️' },
  { key: '洗车', icon: '🚗' },
  { key: '运动', icon: '🏃' },
  { key: '晾晒', icon: '🧺' },
  { key: '感冒', icon: '🤧' },
];

/** 渲染生活指数 */
function renderIndices(res) {
  const card = $('indicesCard');
  const list = (res && res.daily) || [];

  if (!list.length) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const box = $('indicesList');
  box.innerHTML = '';
  const frag = document.createDocumentFragment();

  INDEX_WANTED.forEach((wanted) => {
    const item = list.find((d) => String(d.name || '').includes(wanted.key));
    if (!item) return;

    const li = document.createElement('li');
    li.className = 'idx';
    li.title = item.text || ''; // 鼠标悬停看完整建议
    li.innerHTML = `
      <span class="idx__icon" aria-hidden="true">${wanted.icon}</span>
      <span class="idx__body">
        <span class="idx__name">${wanted.key}</span>
        <span class="idx__cat">${item.category || '—'}</span>
      </span>
    `;
    frag.appendChild(li);
  });

  box.appendChild(frag);
}

/** 今日温度区间：当前温度落在最低~最高之间的位置 */
function renderRange(now, today) {
  if (!today || today.tempMin === undefined || today.tempMax === undefined) return;

  const min = Number(today.tempMin);
  const max = Number(today.tempMax);
  const cur = Number(now.temp);
  const span = Math.max(1, max - min);
  const pct = Math.min(100, Math.max(0, ((cur - min) / span) * 100));

  $('rangeFill').style.width = `${pct}%`;
  $('rangeDot').style.left = `${pct}%`;
  $('rangeMin').textContent = `最低 ${min}°`;
  $('rangeNow').textContent = `现在 ${cur}°`;
  $('rangeMax').textContent = `最高 ${max}°`;
}

/** 月相：把图标代码翻成 emoji，配上文字 */
const MOON_ICONS = {
  800: '🌑',
  801: '🌒',
  802: '🌓',
  803: '🌔',
  804: '🌕',
  805: '🌖',
  806: '🌗',
  807: '🌘',
};

function renderMoon(today) {
  if (!today) return;
  const text = today.moonPhase || '—';
  const moon = MOON_ICONS[Number(today.moonPhaseIcon)] || '🌙';
  $('moonPhase').textContent = `${moon} ${text}`;
}

/* ---------- 经纬度与方位 ---------- */

/** 8 个方位的中文名，按 0°(北) 顺时针排列 */
const COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

let myPos = null; // 浏览器定位拿到的"我"的坐标

/** 把城市的经纬度显示到卡片上 */
function renderGeo(city) {
  const lat = Number(city && city.lat);
  const lon = Number(city && city.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    $('geoCoord').textContent = '暂无坐标';
    $('geoBearing').textContent = '—';
    $('geoNeedle').classList.remove('is-on');
    return;
  }

  const latText = `${lat >= 0 ? '北纬' : '南纬'} ${Math.abs(lat).toFixed(2)}°`;
  const lonText = `${lon >= 0 ? '东经' : '西经'} ${Math.abs(lon).toFixed(2)}°`;
  $('geoCoord').textContent = `${latText} · ${lonText}`;

  updateGeoBearing(city);
}

/** 方位角：从"我"指向城市，0° = 正北，顺时针增大 */
function bearingBetween(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** 球面距离（公里），Haversine 公式 */
function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 刷新罗盘指针和方位文字 */
function updateGeoBearing(city = currentCity) {
  const needle = $('geoNeedle');
  const text = $('geoBearing');
  if (!needle || !text) return;

  if (!myPos) {
    text.textContent = '开启定位可显示相对方位';
    needle.classList.remove('is-on');
    return;
  }
  if (!city) return;

  const lat2 = Number(city.lat);
  const lon2 = Number(city.lon);
  if (!Number.isFinite(lat2) || !Number.isFinite(lon2)) return;

  const bearing = (bearingBetween(myPos.lat, myPos.lon, lat2, lon2) + 360) % 360;
  const dist = distanceKm(myPos.lat, myPos.lon, lat2, lon2);
  const dir = COMPASS[Math.round(bearing / 45) % 8];

  needle.style.transform = `rotate(${bearing.toFixed(1)}deg)`;
  needle.classList.add('is-on');

  const distText =
    dist < 1 ? `${Math.round(dist * 1000)} 米` : `${dist.toFixed(dist < 100 ? 1 : 0)} 公里`;
  text.textContent = `城市在你的${dir}方 · 直线 ${distText}`;
}

/** 请求浏览器定位；失败也不影响看天气，只是没有相对方位 */
function initGeolocation() {
  if (!navigator.geolocation) {
    $('geoBearing').textContent = '此浏览器不支持定位';
    return;
  }

  // 先快速试一次（省电、快），失败再用高精度、更长时间重试一次。
  // Chrome/Edge 的网络定位要走 Google 定位服务，被代理或网络限制时经常超时，
  // 所以给第二次机会，成功率会高不少。
  const onOk = (pos) => {
    myPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    updateGeoBearing();
  };

  const onFail = (err) => {
    const code = err && err.code;
    const msg =
      code === 1
        ? '定位权限被拒绝，可在地址栏左侧的网站设置里开启'
        : code === 2
          ? '定位不可用（请检查系统定位服务是否开启）'
          : '定位超时，多半是网络/代理限制，不影响看天气';
    $('geoBearing').textContent = msg;
  };

  navigator.geolocation.getCurrentPosition(
    onOk,
    () => {
      navigator.geolocation.getCurrentPosition(onOk, onFail, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 }
  );
}

/** 显示 / 隐藏顶部提醒条 */
function showAlert({ tone = 'rain', icon = '🌧️', title = '', text = '' } = {}) {
  const box = $('alert');
  if (!tone) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.dataset.tone = tone;
  $('alertIcon').textContent = icon;
  $('alertTitle').textContent = title;
  $('alertText').textContent = text;
}

/** 去掉预警文本里的 HTML 标签 */
function plainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 组装"下雨提醒"
 * 优先级：灾害预警 > 分钟级降水 > 正在下雨 > 今日有雨
 */
function buildRainAlert({ now, today, minutely, warnings }) {
  // 1) 官方灾害预警（台风、暴雨、大风……）
  if (warnings && warnings.length) {
    const w = warnings[0];
    return {
      tone: 'warn',
      icon: '⚠️',
      title: w.title || '天气预警',
      text: plainText(w.text).slice(0, 90),
    };
  }

  // 2) 分钟级降水：summary 形如 "未来两小时不会下雨" / "10分钟后开始下小雨"
  //    注意 "不会下雨" 里也有"雨"字，所以要先排除否定说法，再看看逐 5 分钟有没有降水量
  if (minutely) {
    const summary = minutely.summary || '';
    const negated = /不会|没有|无降水|暂未/.test(summary);
    const upcoming = (minutely.minutely || []).some((m) => Number(m.precip) > 0);
    if (upcoming || (!negated && /雨|雪|冰雹|雷/.test(summary))) {
      return {
        tone: 'rain',
        icon: '🌧️',
        title: '降水提醒',
        text: summary || '预计未来两小时内有降水，出门带把伞。',
      };
    }
  }

  // 3) 此刻就在下雨
  const precipNow = Number(now.precip);
  if (precipNow > 0) {
    return {
      tone: 'rain',
      icon: '☔',
      title: '正在下雨',
      text: `当前降水量 ${precipNow} 毫米，出门记得带伞，路上慢一点。`,
    };
  }

  // 4) 今天可能有雨（7 天预报里的降水量只是参考值）
  const precipToday = Number(today && today.precip);
  if (precipToday > 0) {
    return {
      tone: 'rain',
      icon: '🌂',
      title: '今天可能有雨',
      text: `预计降水量约 ${precipToday} 毫米，包里放把伞更安心。`,
    };
  }

  return null;
}

/* ---------------------------------------------------------
   6. 主流程：加载某个城市的天气
   --------------------------------------------------------- */
let currentCity = null;

/** 最近一次完整加载的上下文，供每分钟的局部刷新复用 */
let lastState = { today: null, warnings: [], theme: 'sunny' };

/** 统一处理提醒条：有降水提示就显示，没有就给一句天气小结 */
function applyAlert(alert, theme, now) {
  if (alert) {
    showAlert(alert);
    return;
  }
  if (theme !== 'rainy') {
    showAlert({
      tone: 'calm',
      icon: emojiOf(now.icon),
      title: '今天没有降水提醒',
      text: `${now.text}，${now.temp}°C，体感 ${now.feelsLike}°C。${windTip(now)}`,
    });
  } else {
    showAlert({ tone: null });
  }
}

async function loadCity(city, { silent = false } = {}) {
  const app = document.body;
  if (!silent) {
    app.classList.add('is-loading');
    $('obsTime').textContent = '正在获取天气…';
  }

  try {
    const location = city.id;

    // 这些请求互不依赖，全部并发发出。
    // 除了 now / 7 天预报，其它都允许失败（没订阅或没数据时对应卡片会自动隐藏）。
    const [nowRes, dailyRes, warnRes, sunRes, minRes, hourRes, airRes, idxRes] =
      await Promise.all([
        api.now(location),
        api.daily7(location),
        api.warnings(location).catch(() => []),
        api.sun(location, compactDate()).catch(() => null),
        api.minutely(`${city.lon},${city.lat}`).catch(() => null),
        api.hourly24(location).catch(() => null),
        api.airNow(city.lat, city.lon).catch(() => null),
        api.indices(location).catch(() => null),
      ]);

    const daily = dailyRes.daily || [];
    const today = daily[0] || {};

    // 用实时天气里的 icon 判断主题；夜里晴天就用 "night" 主题
    let theme = themeOf(nowRes.now.icon);
    const riseM = toMinutes(today.sunrise);
    const setM = toMinutes(today.sunset);
    const nightNow = riseM !== null && setM !== null
      && (bjMinutes() < riseM || bjMinutes() > setM);
    if (nightNow && (theme === 'sunny' || theme === 'cloudy')) theme = 'night';
    applyTheme(theme);

    renderCurrent(nowRes, city);
    renderGeo(city);
    renderForecast(dailyRes);
    renderHourly(hourRes);
    renderAir(airRes);
    renderIndices(idxRes);
    renderRange(nowRes.now, today);
    renderMoon(today);
    updateLiveScene(nowRes.now, city, theme);

    // 日出日落优先用专用接口，拿不到就退回 7 天预报里的字段
    renderSun({
      sunrise: (sunRes && sunRes.sunrise) || today.sunrise,
      sunset: (sunRes && sunRes.sunset) || today.sunset,
    });

    // 预警接口返回的数组可能不存在
    const warnings = (warnRes && warnRes.warning) || [];

    // 缓存下来，每分钟的局部刷新要用到
    lastState = { today, warnings, theme };

    const alert = buildRainAlert({
      now: nowRes.now,
      today,
      minutely: minRes,
      warnings,
    });
    applyAlert(alert, theme, nowRes.now);

    // 生成播报稿，写进画面底部的滚动字幕
    setBroadcastText(buildBroadcast(nowRes.now, city, daily, alert));

    // 把这一轮数据广播出去，页面的扩展模块（水晶球 / 温度河等）据此刷新
    document.dispatchEvent(new CustomEvent('weather:update', {
      detail: {
        city,
        now: nowRes.now,
        today,
        daily,
        hourly: (hourRes && hourRes.hourly) || [],
        theme,
      },
    }));

    // 记住这个城市，下次打开还是它
    currentCity = city;
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(city));
  } catch (err) {
    console.error('[天气]', err);
    showAlert({
      tone: 'error',
      icon: '😵',
      title: '获取天气失败',
      text: err.message || '请稍后重试',
    });
    if (!currentCity) $('obsTime').textContent = '没能拿到数据';
  } finally {
    app.classList.remove('is-loading');
  }
}

/** 根据风力和温度给一句小提示 */
function windTip(now) {
  const scale = Number(now.windScale);
  if (scale >= 5) return '风有点大，注意防风。';
  if (Number(now.temp) >= 30) return '有点热，多喝水。';
  if (Number(now.temp) <= 5) return '挺冷的，记得多穿一件。';
  return '出门玩得开心。';
}

/**
 * 每 60 秒的轻量刷新：只拉「实时天气 + 分钟级降水」。
 * 这两项变化最快（温度、天气现象、降水提醒）。
 * 7 天预报 / 24 小时 / 空气质量 / 生活指数变化慢，交给 10 分钟一次的全量刷新，
 * 这样每分钟刷新也不会把接口额度刷爆。
 */
async function refreshNow() {
  if (!currentCity || document.visibilityState !== 'visible') return;

  try {
    const [nowRes, minRes] = await Promise.all([
      api.now(currentCity.id),
      api.minutely(`${currentCity.lon},${currentCity.lat}`).catch(() => null),
    ]);

    // 当前温度、体感、湿度等
    renderCurrent(nowRes, currentCity);

    // 实时影像右下角的文字也跟着更新
    updateLiveScene(nowRes.now, currentCity, lastState.theme);

    // 重新判断要不要提示下雨
    const alert = buildRainAlert({
      now: nowRes.now,
      today: lastState.today,
      minutely: minRes,
      warnings: lastState.warnings,
    });
    applyAlert(alert, lastState.theme, nowRes.now);
  } catch (err) {
    // 自动刷新失败就静默跳过，不打扰用户
    console.warn('[自动刷新]', err);
  }
}

/* ---------------------------------------------------------
   7. 城市搜索
   --------------------------------------------------------- */
const searchForm = $('searchForm');
const searchInput = $('searchInput');
const suggestBox = $('suggest');

let searchTimer = null;
let suggestProvince = '';   // 当前下拉框限定的省份
let lastSuggestList = [];   // 上一次的搜索结果，切换省份时直接复用

function hideSuggest() {
  suggestBox.hidden = true;
  suggestBox.innerHTML = '';
}

/* ---------- 本地行政区划搜索（regions.js） ---------- */

/**
 * 在本地城市名录里模糊搜索。
 * 优先级：完全同名 → 名字开头 → 名字包含 → 所属市包含 → 所属省包含。
 * 「所属市包含」这条是关键：搜"怀化"时，怀化市下辖的区县 adm2 都是"怀化市"，
 * 于是会被一起搜出来，实现"搜一个市，看到它下面的各个区县"。
 */
function searchRegions(keyword) {
  const all = window.CN_REGIONS;
  if (!all || !all.length) return [];

  const kw = keyword.trim();
  if (!kw) return [];

  // 名录里存的是简称（"鹤城"而不是"鹤城区"），
  // 所以用户带后缀搜索时，去掉后缀再匹配一次
  const variants = [kw];
  const stripped = kw.replace(/(特别行政区|自治区|自治州|自治县|地区|省|市|区|县|旗|盟)$/, '');
  if (stripped && stripped !== kw) variants.push(stripped);

  const exact = [];
  const starts = [];
  const nameHas = [];
  const cityHas = [];
  const provHas = [];

  for (let i = 0; i < all.length; i += 1) {
    const r = all[i]; // [区县名, ID, 省, 市, 纬度, 经度]
    const name = r[0];
    const prov = r[2] || '';
    const city = r[3] || '';

    // 命中哪个变体就归到哪一档，命中一次即止
    for (let v = 0; v < variants.length; v += 1) {
      const k = variants[v];
      if (name === k) {
        exact.push(r);
        break;
      }
      if (name.startsWith(k)) {
        starts.push(r);
        break;
      }
      if (name.includes(k)) {
        nameHas.push(r);
        break;
      }
      if (city.includes(k)) {
        cityHas.push(r);
        break;
      }
      if (prov.includes(k)) {
        provHas.push(r);
        break;
      }
    }
  }

  // 省名匹配的结果太多，只取前 30 条兜底
  const merged = exact.concat(starts, nameHas, cityHas, provHas.slice(0, 30));

  return merged.slice(0, 40).map((r) => ({
    name: r[0],
    id: r[1],
    adm1: r[2],
    adm2: r[3],
    lat: r[4],
    lon: r[5],
  }));
}

/** 本地搜不到时走在线接口（国外城市、拼音等） */
async function searchOnline(keyword) {
  const res = await api.searchCity(keyword);
  return (res.location || []).map((c) => ({
    name: c.name,
    id: c.id,
    adm1: c.adm1,
    adm2: c.adm2,
    lat: c.lat,
    lon: c.lon,
  }));
}

/** 选中一个地区并加载天气 */
function openCity(city) {
  searchInput.value = city.name;
  hideSuggest();
  loadCity(city);
}

/**
 * 渲染联想列表。
 * 1. 先按省份收窄：默认只显示最相关结果所在的那个省，
 *    这样搜「怀化」就只会有湖南的区县，不会混进别的省份的同名地区。
 * 2. 如果关键词确实跨省（比如「朝阳」有北京和辽宁），
 *    顶部会给一排省份按钮，点一下就能切过去。
 * 3. 组内再按所属市分组显示。
 */
function renderSuggest(list) {
  lastSuggestList = list;
  suggestBox.innerHTML = '';

  if (!list.length) {
    const li = document.createElement('li');
    li.textContent = '没有找到这个地区，换个写法试试';
    li.style.cursor = 'default';
    suggestBox.hidden = false;
    suggestBox.appendChild(li);
    return;
  }

  // 按出现顺序收集省份，第一个就是最相关的（列表已按匹配优先级排过序）
  const provinces = [];
  list.forEach((item) => {
    const p = item.adm1;
    if (p && provinces.indexOf(p) === -1) provinces.push(p);
  });

  // 当前省份失效（换了关键词）就回到最相关的那个
  if (!suggestProvince || provinces.indexOf(suggestProvince) === -1) {
    suggestProvince = provinces[0] || '';
  }

  // 只保留当前省份的结果；没有省份信息（国外城市）则原样显示
  const shown = suggestProvince
    ? list.filter((item) => !item.adm1 || item.adm1 === suggestProvince)
    : list;

  const frag = document.createDocumentFragment();

  // 跨省时给一排省份切换按钮
  if (provinces.length > 1) {
    const bar = document.createElement('li');
    bar.className = 'suggest__provinces';

    provinces.forEach((p) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'prov-chip' + (p === suggestProvince ? ' is-active' : '');
      chip.textContent = p;
      chip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        suggestProvince = p;
        renderSuggest(lastSuggestList);
      });
      bar.appendChild(chip);
    });

    frag.appendChild(bar);
  }

  // 按 adm2（所属市）分组
  const groups = new Map();
  shown.forEach((item) => {
    const key = item.adm2 || item.adm1 || '中国';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  groups.forEach((items, cityName) => {
    // 一条组里不止一个结果（通常是搜到了地级市），才加分组标题
    if (items.length > 1) {
      const head = document.createElement('li');
      head.className = 'suggest__group';
      const prov = items[0].adm1 && items[0].adm1 !== cityName ? ` · ${items[0].adm1}` : '';
      head.textContent = `${cityName}${prov}`;
      frag.appendChild(head);
    }

    items.forEach((c) => {
      const li = document.createElement('li');
      if (items.length > 1) li.className = 'suggest__item--sub';
      li.setAttribute('role', 'option');

      // 去掉和城市名重复的上级名称
      const sub = [c.adm1, c.adm2]
        .filter((x) => x && x !== c.name)
        .filter((x, i, arr) => arr.indexOf(x) === i)
        .join(' · ');

      li.innerHTML = `<span>${c.name}</span><small>${sub}</small>`;

      // 用 pointerdown 而不是 click，避免先触发 blur 把列表关掉
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        openCity(c);
      });

      frag.appendChild(li);
    });
  });

  suggestBox.appendChild(frag);
  suggestBox.hidden = false;
}

/** 输入：本地名录优先（即时出结果），本地没有再走网络 */
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  suggestProvince = ''; // 换关键词就重新决定省份
  const keyword = searchInput.value.trim();

  if (!keyword) {
    hideSuggest();
    return;
  }

  const local = searchRegions(keyword);
  if (local.length) {
    renderSuggest(local);
    return;
  }

  searchTimer = setTimeout(async () => {
    try {
      renderSuggest(await searchOnline(keyword));
    } catch (err) {
      console.warn('[搜索]', err);
      hideSuggest();
    }
  }, 320);
});

// 回车 / 点"搜索"：本地优先，取第一个结果打开
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const keyword = searchInput.value.trim();
  if (!keyword) return;

  const local = searchRegions(keyword);
  if (local.length) {
    openCity(local[0]);
    return;
  }

  try {
    const list = await searchOnline(keyword);
    if (!list.length) {
      showAlert({
        tone: 'error',
        icon: '🔍',
        title: '没有找到这个地区',
        text: '试试用城市名或区县名，比如「怀化」「鹤城区」。',
      });
      return;
    }
    openCity(list[0]);
  } catch (err) {
    showAlert({ tone: 'error', icon: '😵', title: '搜索失败', text: err.message });
  }
});

// 点空白处 / 按 Esc 关闭联想框
document.addEventListener('click', (e) => {
  if (!searchForm.contains(e.target)) hideSuggest();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideSuggest();
});

/* ---------------------------------------------------------
   8. 触碰的流动感（指针柔光 / 卡片倾斜 / 涟漪 / 数字滚动）
   如果系统开了"减少动态效果"，这些全部关掉。
   --------------------------------------------------------- */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 数字从旧值滚到新值（easeOutCubic） */
function animateNumber(el, to) {
  const from = Number(el.dataset.value ?? 0) || 0;
  el.dataset.value = String(to);

  if (reduceMotion || from === to) {
    el.textContent = String(to);
    return;
  }

  const duration = 620;
  const start = performance.now();
  if (el._raf) cancelAnimationFrame(el._raf);

  const step = (t) => {
    const p = Math.min(1, (t - start) / duration);
    const eased = 1 - (1 - p) ** 3;
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

/**
 * 跟着指针走的两样东西：
 *   1. 一团柔光（用 lerp 缓动追赶指针，所以是"流"过去的，不是生硬粘贴）
 *   2. 背后整片天空的轻微视差
 */
function initPointerFlow() {
  if (reduceMotion) return;

  const glow = $('cursorGlow');
  const sky = document.querySelector('.sky');
  if (!glow) return;

  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight * 0.3;
  let x = targetX;
  let y = targetY;
  let raf = null;

  const render = () => {
    // 缓动系数 0.13：数字越大跟得越紧，越小越"飘"
    x += (targetX - x) * 0.13;
    y += (targetY - y) * 0.13;

    glow.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;

    if (sky) {
      // 指针在屏幕中的相对位置 → 天空最多漂 18px
      const px = (x / window.innerWidth - 0.5) * 36;
      const py = (y / window.innerHeight - 0.5) * 36;
      sky.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
    }

    // 还没追上指针就继续跑，追上了就休息，省电
    if (Math.abs(targetX - x) > 0.4 || Math.abs(targetY - y) > 0.4) {
      raf = requestAnimationFrame(render);
    } else {
      raf = null;
    }
  };

  const kick = () => {
    if (!raf) raf = requestAnimationFrame(render);
  };

  const track = (e) => {
    targetX = e.clientX;
    targetY = e.clientY;
    document.body.classList.add('is-pointing');
    kick();
  };

  window.addEventListener('pointermove', track, { passive: true });
  window.addEventListener('pointerdown', track, { passive: true });

  // 指针移出窗口时把光晕收起来
  document.addEventListener('mouseleave', () => {
    document.body.classList.remove('is-pointing');
  });
}

/** 鼠标在卡片上移动时做 3D 倾斜 + 表面高光跟随 */
function initCardTilt() {
  if (reduceMotion) return;
  // 没有 hover 能力的设备（手机）不做倾斜，改用涟漪反馈
  if (!window.matchMedia('(hover: hover)').matches) return;

  document.querySelectorAll('.card').forEach((card) => {
    let rect = null;

    card.addEventListener('pointerenter', () => {
      rect = card.getBoundingClientRect();
      card.classList.add('is-tilting'); // 缩短过渡，跟手
    });

    card.addEventListener('pointermove', (e) => {
      if (!rect) rect = card.getBoundingClientRect();
      // 指针在卡片内的相对位置 0~1
      const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));

      card.style.setProperty('--rx', `${((0.5 - py) * 7).toFixed(2)}deg`);
      card.style.setProperty('--ry', `${((px - 0.5) * 9).toFixed(2)}deg`);
      card.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
      card.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
    });

    const reset = () => {
      rect = null;
      card.classList.remove('is-tilting');
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    };

    card.addEventListener('pointerleave', reset);
    card.addEventListener('pointercancel', reset);

    // 页面滚动后缓存的卡片坐标会失效，清掉重新量
    window.addEventListener('scroll', () => { rect = null; }, { passive: true });
  });
}

/** 指尖涟漪：按哪儿就从哪儿荡开一圈 */
function initRipple() {
  if (reduceMotion) return;

  document.addEventListener('pointerdown', (e) => {
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.left = `${e.clientX}px`;
    dot.style.top = `${e.clientY}px`;
    document.body.appendChild(dot);
    dot.addEventListener('animationend', () => dot.remove(), { once: true });
  }, { passive: true });
}

/* ---------------------------------------------------------
   9. 实时影像：用 canvas 按「当前真实天气」实时绘制画面
   （雨丝 / 雪花 / 云 / 太阳 / 星空 / 雾）
   如果 CONFIG.liveVideoUrl 填了 mp4 地址，就直接播那个视频。
   --------------------------------------------------------- */
const LIVE = {
  canvas: null,
  ctx: null,
  w: 0,
  h: 0,
  dpr: 1,
  kind: '', // rain / snow / cloud / fog / night / sun
  parts: [],
  colors: { a: '#e8f5ff', b: '#92c2e8' },
  t: 0,
  last: 0,
  raf: null,
};

/** 页面主题 → 影像类型 */
const LIVE_KIND = {
  sunny: 'sun',
  cloudy: 'cloud',
  rainy: 'rain',
  snowy: 'snow',
  hazy: 'fog',
  night: 'night',
};

/**
 * 影像画面的天空色单独定一套。
 * 不能直接用页面的 --sky-*，那是浅色背景，
 * 画到 canvas 上会灰蒙蒙一片，白色的云和字都压不住。
 */
const LIVE_SKY = {
  sunny: ['#a8d8f8', '#4f8dc4'],
  cloudy: ['#b4cddf', '#6285a2'],
  rainy: ['#416788', '#112a42'],
  snowy: ['#e2eef9', '#9db8ce'],
  hazy: ['#c8d3dc', '#8496a4'],
  night: ['#16294a', '#050b16'],
};

function initLiveScene() {
  // 配了视频地址就播视频，不再画 canvas
  if (CONFIG.liveVideoUrl) {
    setupLiveVideo();
    return;
  }

  LIVE.canvas = $('liveCanvas');
  if (!LIVE.canvas) return;
  LIVE.ctx = LIVE.canvas.getContext('2d');

  resizeLive();

  // 容器尺寸变了就重算画布（响应窗口缩放 / 手机横竖屏）
  if (window.ResizeObserver) {
    new ResizeObserver(() => resizeLive()).observe($('liveFrame'));
  } else {
    window.addEventListener('resize', resizeLive);
  }

  // 画面右上角的"直播时间"，每秒走一次，固定北京时间
  const tick = () => {
    const el = $('liveTime');
    if (el) el.textContent = `北京时间 ${bjClock()}`;
  };
  tick();
  setInterval(tick, 1000);

  if (reduceMotion) {
    drawLive(0); // 系统要求减少动效时，只画一帧静态画面
  } else {
    LIVE.raf = requestAnimationFrame(liveLoop);

    // 切到别的标签页就停，回来再继续，别白烧 CPU
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (LIVE.raf) cancelAnimationFrame(LIVE.raf);
        LIVE.raf = null;
      } else if (!LIVE.raf && LIVE.canvas) {
        LIVE.last = 0;
        LIVE.raf = requestAnimationFrame(liveLoop);
      }
    });
  }
}

/** 可选：用真实视频替换 canvas（需要 mp4/webm 直链） */
function setupLiveVideo() {
  const frame = $('liveFrame');
  const video = document.createElement('video');
  video.src = CONFIG.liveVideoUrl;
  video.autoplay = true;
  video.muted = true; // 浏览器只允许静音自动播放
  video.loop = true;
  video.playsInline = true;
  frame.insertBefore(video, frame.firstChild);

  const canvas = $('liveCanvas');
  if (canvas) canvas.remove();
}

/** 按容器实际尺寸设置画布大小（考虑高分屏） */
function resizeLive() {
  if (!LIVE.canvas) return;
  const rect = LIVE.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  LIVE.dpr = Math.min(2, window.devicePixelRatio || 1);
  LIVE.w = rect.width;
  LIVE.h = rect.height;
  LIVE.canvas.width = Math.round(rect.width * LIVE.dpr);
  LIVE.canvas.height = Math.round(rect.height * LIVE.dpr);
  LIVE.ctx.setTransform(LIVE.dpr, 0, 0, LIVE.dpr, 0, 0);

  buildLiveParts();
  if (reduceMotion) drawLive(0);
}

/** 根据天气类型生成粒子 / 云团 / 星星 */
function buildLiveParts() {
  const { w, h, kind } = LIVE;
  if (!w || !h) return;

  const area = (w * h) / 1000; // 面积系数，决定粒子数量
  const parts = [];

  if (kind === 'rain') {
    const n = Math.min(240, Math.round(area * 0.12));
    for (let i = 0; i < n; i += 1) {
      parts.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vy: 320 + Math.random() * 280, // 下落速度 px/秒
        vx: -40 - Math.random() * 50,  // 风把雨吹斜
        len: 10 + Math.random() * 14,
      });
    }
  } else if (kind === 'snow') {
    const n = Math.min(180, Math.round(area * 0.08));
    for (let i = 0; i < n; i += 1) {
      parts.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 1 + Math.random() * 2.4,
        vy: 18 + Math.random() * 34,
        phase: Math.random() * 1000,
      });
    }
  } else if (kind === 'cloud' || kind === 'fog') {
    const n = kind === 'fog' ? 5 : 6;
    for (let i = 0; i < n; i += 1) {
      parts.push({
        // 横向均匀铺开，不要全靠随机，否则静态帧里可能一堆挤在边上
        x: ((i + 0.5) / n) * w + (Math.random() - 0.5) * w * 0.16,
        y: kind === 'fog'
          ? h * (0.35 + Math.random() * 0.5)
          : h * (0.15 + Math.random() * 0.4),
        // 半径别太大，否则几朵云叠在一起会糊成一片均匀的雾
        r: (kind === 'fog' ? 0.34 : 0.12) * w * (0.7 + Math.random() * 0.6),
        vx: (kind === 'fog' ? 8 : 12) * (0.4 + Math.random()),
        a: kind === 'fog' ? 0.26 : 0.5 + Math.random() * 0.25,
      });
    }
  } else if (kind === 'night') {
    const n = Math.min(90, Math.round(area * 0.05));
    for (let i = 0; i < n; i += 1) {
      parts.push({
        x: Math.random() * w,
        y: Math.random() * h * 0.8,
        r: Math.random() * 1.4 + 0.4,
        phase: Math.random() * 6.283,
        speed: 0.6 + Math.random() * 1.4,
      });
    }
  } else {
    // sun：几团慢慢漂的柔光
    for (let i = 0; i < 4; i += 1) {
      parts.push({
        x: w * (0.15 + Math.random() * 0.7),
        y: h * (0.2 + Math.random() * 0.5),
        r: w * (0.08 + Math.random() * 0.1),
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 5,
        a: 0.18 + Math.random() * 0.14,
      });
    }
  }

  LIVE.parts = parts;
}

/** 每帧绘制 */
function drawLive(dt) {
  const { ctx, w, h, kind } = LIVE;
  if (!ctx || !w || !h) return;

  // 背景用当前主题的天空色
  const g = ctx.createLinearGradient(0, 0, w * 0.55, h);
  g.addColorStop(0, LIVE.colors.a);
  g.addColorStop(1, LIVE.colors.b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  if (kind === 'rain') drawRain(dt);
  else if (kind === 'snow') drawSnow(dt);
  else if (kind === 'cloud') drawClouds(dt);
  else if (kind === 'fog') drawFog(dt);
  else if (kind === 'night') drawNight(dt);
  else drawSun(dt);

  drawVignette();
}

function drawRain(dt) {
  const { ctx, w, h, parts } = LIVE;
  ctx.strokeStyle = 'rgba(235, 248, 255, 0.72)';
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  parts.forEach((p) => {
    p.y += p.vy * dt;
    p.x += p.vx * dt;
    if (p.y > h + 20) {
      p.y = -20;
      p.x = Math.random() * (w + 80);
    }
    if (p.x < -40) p.x = w + 20;

    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + p.vx * 0.02, p.y + p.len);
  });
  ctx.stroke();
}

function drawSnow(dt) {
  const { ctx, w, h, parts } = LIVE;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  parts.forEach((p) => {
    p.y += p.vy * dt;
    p.x += Math.sin((LIVE.t + p.phase) / 900) * 16 * dt; // 左右飘
    if (p.y > h + 8) {
      p.y = -8;
      p.x = Math.random() * w;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 6.2832);
    ctx.fill();
  });
}

function drawClouds(dt) {
  const { ctx, w, parts } = LIVE;
  parts.forEach((p) => {
    p.x += p.vx * dt;
    if (p.x - p.r > w) p.x = -p.r;

    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    g.addColorStop(0, `rgba(255, 255, 255, ${p.a})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 6.2832);
    ctx.fill();
  });
}

function drawFog(dt) {
  const { ctx, w, parts } = LIVE;
  parts.forEach((p) => {
    p.x += p.vx * dt;
    if (p.x - p.r > w) p.x = -p.r;

    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    g.addColorStop(0, `rgba(255, 255, 255, ${p.a})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    // 雾用扁椭圆，像一层贴地的雾气
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.r, p.r * 0.3, 0, 0, 6.2832);
    ctx.fill();
  });
}

function drawNight(dt) {
  const { ctx, w, h, parts } = LIVE;

  // 月亮 + 光晕
  const mx = w * 0.78;
  const my = h * 0.28;
  const mr = Math.min(w, h) * 0.09;

  const halo = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 4);
  halo.addColorStop(0, 'rgba(255, 243, 210, 0.8)');
  halo.addColorStop(1, 'rgba(255, 243, 210, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(mx, my, mr * 4, 0, 6.2832);
  ctx.fill();

  ctx.fillStyle = '#fff7e0';
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, 6.2832);
  ctx.fill();

  // 星星一闪一闪
  parts.forEach((p) => {
    const a = 0.3 + 0.55 * Math.abs(Math.sin((LIVE.t / 1000) * p.speed + p.phase));
    ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 6.2832);
    ctx.fill();
  });
}

function drawSun(dt) {
  const { ctx, w, h, parts } = LIVE;

  // 右上角的太阳光晕
  const sx = w * 0.74;
  const sy = h * 0.3;
  const r = Math.min(w, h) * 0.22;

  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.6);
  glow.addColorStop(0, 'rgba(255, 240, 200, 0.9)');
  glow.addColorStop(0.45, 'rgba(255, 214, 140, 0.34)');
  glow.addColorStop(1, 'rgba(255, 196, 110, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sx, sy, r * 2.6, 0, 6.2832);
  ctx.fill();

  // 漂浮的柔光
  parts.forEach((p) => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.x < w * 0.05 || p.x > w * 0.95) p.vx *= -1;
    if (p.y < h * 0.1 || p.y > h * 0.85) p.vy *= -1;

    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    g.addColorStop(0, `rgba(255, 255, 255, ${p.a})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 6.2832);
    ctx.fill();
  });
}

/** 四周压暗，像镜头拍的画面 */
function drawVignette() {
  const { ctx, w, h } = LIVE;
  const g = ctx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.25,
    w / 2, h / 2, Math.max(w, h) * 0.72
  );
  g.addColorStop(0, 'rgba(8, 24, 42, 0)');
  g.addColorStop(1, 'rgba(8, 24, 42, 0.3)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** 动画主循环 */
function liveLoop(ts) {
  if (!LIVE.last) LIVE.last = ts;
  const dt = Math.min(0.05, (ts - LIVE.last) / 1000);
  LIVE.last = ts;
  LIVE.t += dt * 1000;

  drawLive(dt);
  LIVE.raf = requestAnimationFrame(liveLoop);
}

/** 天气变了就换场景 + 同步左下角的文字 */
function updateLiveScene(now, city, theme) {
  $('liveCity').textContent = city.name;
  $('liveMeta').textContent = `${now.text} · ${now.temp}°C · ${now.windDir} ${now.windScale} 级`;

  if (!LIVE.canvas) return;

  // 换一套和天气匹配的天空色
  const sky = LIVE_SKY[theme] || LIVE_SKY.cloudy;
  LIVE.colors.a = sky[0];
  LIVE.colors.b = sky[1];

  const kind = LIVE_KIND[theme] || 'cloud';
  if (kind !== LIVE.kind) {
    LIVE.kind = kind;
    buildLiveParts();
  }
  if (reduceMotion) drawLive(0);
}

/* ---------- 天气播报（画面里的主播） ---------- */

let broadcastText = ''; // 当前城市的播报稿

/** "06:38" → "6点38分"，让语音读起来自然 */
function clockCN(value) {
  const c = clockOf(value);
  if (!c) return '';
  const [h, m] = c.split(':');
  return `${Number(h)}点${m}分`;
}

/** 把天气数据写成一段电视台风格的播报稿 */
function buildBroadcast(now, city, daily, alert) {
  const [hh, mm] = bjClock().split(':');
  const today = daily[0] || {};
  const tomorrow = daily[1] || {};
  const s = [];

  s.push(`各位好，现在是北京时间${Number(hh)}点${mm}分，为您播报${city.name}天气。`);
  s.push(
    `目前${city.name}${now.text}，气温${now.temp}摄氏度，体感${now.feelsLike}度，` +
      `${now.windDir}${now.windScale}级，湿度百分之${now.humidity}。`
  );

  if (today.tempMax && today.tempMin) {
    s.push(`今天最高${today.tempMax}度，最低${today.tempMin}度。`);
  }
  if (today.sunrise && today.sunset) {
    s.push(`日出${clockCN(today.sunrise)}，日落${clockCN(today.sunset)}。`);
  }
  if (tomorrow.textDay) {
    s.push(`明天${tomorrow.textDay}，气温${tomorrow.tempMin}到${tomorrow.tempMax}度。`);
  }
  if (alert && alert.title) {
    const brief = String(alert.text || '').slice(0, 40);
    s.push(`提醒您：${alert.title}${brief ? `，${brief}` : ''}。`);
  }
  s.push('以上就是今天的天气，感谢收看。');

  return s.join('');
}

/** 把稿子写进底部字幕（两段相同文本，用于无缝滚动） */
function setBroadcastText(text) {
  broadcastText = text;

  // 换城市时如果正在念，先停掉
  if ('speechSynthesis' in window && speechSynthesis.speaking) {
    speechSynthesis.cancel();
    setAnchorTalking(false);
  }

  const box = $('liveTicker');
  if (!box) return;
  Array.from(box.children).forEach((span) => {
    span.textContent = text;
  });
}

/** 控制主播嘴部开合（顺便复位按钮） */
function setAnchorTalking(on) {
  const anchor = $('liveAnchor');
  if (anchor) anchor.classList.toggle('is-talking', on);

  if (!on) {
    const btn = $('liveVoice');
    if (btn) {
      btn.dataset.state = '';
      btn.textContent = '🔊 听播报';
    }
  }
}

/** 用浏览器自带的语音合成朗读 */
function speakBroadcast() {
  if (!('speechSynthesis' in window)) return false;

  const utter = new SpeechSynthesisUtterance(broadcastText);
  utter.lang = 'zh-CN';
  utter.rate = 1;
  utter.pitch = 1;

  // 尽量挑一个中文音色
  const voices = speechSynthesis.getVoices() || [];
  const zh = voices.find((v) => /^zh/i.test(v.lang) || /中文|普通话/.test(v.name));
  if (zh) utter.voice = zh;

  utter.onstart = () => setAnchorTalking(true);
  utter.onend = () => setAnchorTalking(false);
  utter.onerror = () => setAnchorTalking(false);

  speechSynthesis.speak(utter);
  return true;
}

/** 绑定"听播报"按钮 */
function initBroadcast() {
  const btn = $('liveVoice');
  if (!btn) return;

  if (!('speechSynthesis' in window)) {
    btn.hidden = true; // 浏览器不支持就只保留字幕
    return;
  }

  // 语音列表异步加载，先触发一次
  speechSynthesis.getVoices();

  btn.addEventListener('click', () => {
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      setAnchorTalking(false);
      return;
    }
    if (!broadcastText) return;

    if (speakBroadcast()) {
      btn.dataset.state = 'playing';
      btn.textContent = '⏹ 停止';
    }
  });
}

/* ---------------------------------------------------------
   10. 启动
   --------------------------------------------------------- */
(function init() {
  // 恢复上次看过的城市
  let city = CONFIG.defaultCity;
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG.storageKey) || 'null');
    if (saved && saved.id) city = saved;
  } catch {
    /* 本地数据坏了就用默认城市 */
  }

  // 交互先挂上，天气数据慢慢来
  initPointerFlow();
  initCardTilt();
  initRipple();
  initLiveScene();
  initBroadcast();
  initGeolocation();

  currentCity = city;
  searchInput.value = city.name;
  loadCity(city, { silent: true });

  // 每 60 秒刷新一次实时天气（温度、天气现象、下雨提醒）
  setInterval(refreshNow, 60 * 1000);

  // 每 10 分钟把其余数据整体重拉一遍（7 天 / 24 小时 / 空气 / 生活指数）
  setInterval(() => {
    if (document.visibilityState === 'visible' && currentCity) {
      loadCity(currentCity, { silent: true });
    }
  }, 10 * 60 * 1000);
})();
