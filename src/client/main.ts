import './styles.css';
import { checkRisk, evaluateStrategy, type Candle, type RiskSnapshot, type StrategyDecision, type StrategyName } from './trading';

type Mode = 'demo' | 'live';
const state = {
  mode: 'demo' as Mode,
  asset: 'Crypto IDX',
  strategy: 'Momentum' as StrategyName,
  bid: 10_000,
  maxDailyLoss: 50_000,
  maxTradesPerDay: 20,
  minConfidence: 0.55,
  signal: '',
  candles: [] as Candle[],
  running: false,
  liveEnabled: false,
  logged: false,
  ticks: 0,
  paperDecisions: 0,
  paperBalance: 140_000,
  paperStartingBalance: 140_000,
  paperWins: 0,
  paperLosses: 0,
  openPaperTrade: null as { direction: 'CALL' | 'PUT'; bid: number; entryPrice: number; openedAt: number } | null,
  activity: [] as string[],
  decision: null as StrategyDecision | null,
  risk: { dailyPnl: 0, tradesToday: 0, emergencyStop: false } as RiskSnapshot,
};
const $ = (selector: string) => document.querySelector(selector) as HTMLElement;
let botTimer: number | undefined;

function addActivity(message: string) {
  state.activity = [`${new Date().toLocaleTimeString('id-ID')} · ${message}`, ...state.activity].slice(0, 8);
}
function settlePaperTrade(exitPrice: number) {
  const trade = state.openPaperTrade;
  if (!trade) return;
  const won = trade.direction === 'CALL' ? exitPrice > trade.entryPrice : exitPrice < trade.entryPrice;
  const pnl = won ? Math.round(trade.bid * 0.8) : -trade.bid;
  state.paperBalance += pnl;
  state.risk.dailyPnl += pnl;
  state.risk.tradesToday++;
  if (won) state.paperWins++; else state.paperLosses++;
  addActivity(`PAPER ${won ? 'WIN' : 'LOSS'} ${trade.direction} · ${pnl >= 0 ? '+' : ''}${money(pnl)} · saldo ${money(state.paperBalance)}`);
  state.openPaperTrade = null;
}
function botTick() {
  const last = state.candles.at(-1) || { time: Date.now(), open: 100, high: 100, low: 100, close: 100 };
  const open = last.close;
  const close = Math.max(0.01, open + (Math.random() - 0.48) * 1.8);
  state.candles = [...state.candles.slice(-71), { time: Date.now(), open, high: Math.max(open, close) + Math.random() * .6, low: Math.min(open, close) - Math.random() * .6, close }];
  state.ticks++;
  settlePaperTrade(close);
  state.decision = evaluateStrategy(state.candles, state.strategy);
  const risk = checkRisk(
    { maxBid: Math.min(100_000, state.maxDailyLoss), maxDailyLoss: state.maxDailyLoss, maxTradesPerDay: state.maxTradesPerDay, cooldownMs: 5_000, minConfidence: state.minConfidence },
    state.risk,
    state.bid,
    state.decision,
  );
  if (risk.allowed) {
    state.paperDecisions++;
    state.risk.lastDecisionAt = Date.now();
    state.openPaperTrade = { direction: state.decision.direction as 'CALL' | 'PUT', bid: state.bid, entryPrice: close, openedAt: Date.now() };
    addActivity(`PAPER OPEN ${state.decision.direction} ${state.asset} · ${money(state.bid)} @ ${close.toFixed(2)} · settlement candle berikutnya`);
  } else {
    addActivity(`RISK BLOCK · ${risk.reasons[0]}`);
  }
  render();
}
function startBot() {
  if (botTimer !== undefined) return;
  state.running = true;
  addActivity('Strategy engine demo dimulai · paper mode saja');
  botTick();
  botTimer = window.setInterval(botTick, 5_000);
}
function stopBot() {
  if (botTimer !== undefined) { window.clearInterval(botTimer); botTimer = undefined; }
  state.running = false;
  addActivity('Strategy engine dihentikan');
}
const api = async (path: string, init?: RequestInit) => {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
};
function money(value: number) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 2 }).format(value); }
function signalRows() {
  return state.signal.split(/\n/).map(x => x.trim()).filter(Boolean).map(x => {
    const match = x.match(/^(\d{1,2})[.:](\d{2})\s*([BbSs]|BUY|SELL)\b/i);
    return match ? { time: `${match[1].padStart(2, '0')}:${match[2]}`, dir: match[3].toUpperCase().startsWith('B') ? 'BUY' : 'SELL', ok: true } : { time: '—', dir: x, ok: false };
  });
}
function chart() {
  const candles = state.candles.length ? state.candles : Array.from({ length: 72 }, (_, i) => ({ time: Date.now() - i * 60_000, open: 100, high: 100.8, low: 99.2, close: 100 })).reverse();
  const width = 760, height = 270, padding = 24;
  const min = Math.min(...candles.map(x => x.low)), max = Math.max(...candles.map(x => x.high));
  const y = (value: number) => height - padding - (value - min) / (max - min || 1) * (height - padding * 2);
  const step = (width - padding * 2) / candles.length;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Candlestick chart"><path d="M0 ${height - 35} H${width} V${height} H0Z" fill="#9fb8a6" opacity=".12"/>${candles.map((x, i) => { const xx = padding + i * step + step / 2, up = x.close >= x.open, color = up ? '#769d86' : '#c97972'; return `<line x1="${xx}" x2="${xx}" y1="${y(x.high)}" y2="${y(x.low)}" stroke="${color}"/><rect x="${xx - step * .3}" y="${Math.min(y(x.open), y(x.close))}" width="${step * .6}" height="${Math.max(2, Math.abs(y(x.open) - y(x.close)))}" rx="1" fill="${color}"/>`; }).join('')}<text x="${padding}" y="18" fill="currentColor" opacity=".55" font-size="11">${state.asset} · 1m candles</text></svg>`;
}
function decisionText() {
  if (!state.decision) return 'Menunggu data candle yang cukup.';
  return `${state.decision.direction} · ${Math.round(state.decision.confidence * 100)}% · ${state.decision.reason}`;
}
function render() {
  const rows = signalRows();
  const decision = state.decision;
  $('#app').innerHTML = `<div class="shell"><aside class="rail"><div class="brand"><span class="brand-mark">N</span><span>NEWTON<br><b>PRIME</b></span></div><div class="rail-section">WORKSPACE</div><button class="nav active">▦ <span>Cockpit</span></button><button class="nav">◷ <span>Riwayat trade</span></button><button class="nav">⌁ <span>Signal</span></button><div class="rail-section">SYSTEM</div><button class="nav" id="themeBtn">◐ <span>Tema</span></button><button class="nav" id="loginBtn">◎ <span>${state.logged ? 'Akun tersambung' : 'Login Stockity'}</span></button><div class="rail-foot"><img src="/koala-mascot.png" alt="Koala"/><small>Newton Prime<br><em>v1.2.26 web</em></small></div></aside><main class="main"><header><div><p class="eyebrow">${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>Trading cockpit</h1></div><div class="header-actions"><span class="connection"><i class="dot"></i>${state.logged ? 'Stockity read-only' : 'Paper engine siap'}</span><button class="icon-btn" id="refreshBtn">↻</button><button class="avatar" id="loginBtn2">${state.logged ? 'S' : 'N'}</button></div></header><section class="hero"><div><div class="status-line"><span class="pulse ${state.running ? 'on' : ''}"></span><b>${state.running ? 'Newton sedang bekerja' : 'Newton sedang istirahat'}</b><span class="tag demo">PAPER/DEMO</span></div><p class="hero-copy">Strategi dan risk guard aktif. Tidak ada order broker yang dikirim.</p></div><div class="hero-actions"><button class="switch" id="modeBtn"><span></span>Live terkunci</button><button class="primary" id="runBtn">${state.running ? 'Hentikan engine' : 'Jalankan engine'} <kbd>⌘ ↵</kbd></button></div></section><section class="metrics"><div><span>Saldo PAPER</span><strong>${money(state.paperBalance)}</strong><small class="${state.risk.dailyPnl >= 0 ? 'up' : ''}">${state.risk.dailyPnl >= 0 ? '+' : ''}${money(state.risk.dailyPnl)} P/L hari ini</small></div><div><span>Siklus engine</span><strong>${state.ticks}</strong><small>${state.running ? 'Candle + strategy evaluation' : 'Engine idle'}</small></div><div><span>Trade paper</span><strong>${state.paperWins + state.paperLosses}</strong><small>${state.paperWins} win · ${state.paperLosses} loss · ${state.openPaperTrade ? '1 open' : 'flat'}</small></div><div><span>Win rate</span><strong>${state.paperWins + state.paperLosses ? Math.round(state.paperWins / (state.paperWins + state.paperLosses) * 100) : '—'}${state.paperWins + state.paperLosses ? '%' : ''}</strong><small>Settlement candle berikutnya</small></div></section><section class="grid"><div class="panel chart-panel"><div class="panel-head"><div><span class="eyebrow">MARKET READ</span><h2>Harga & momentum</h2></div><button class="select" id="assetBtn">${state.asset}⌄</button></div><div class="price-row"><strong>${state.candles.at(-1)?.close.toFixed(2) || '100.00'}</strong><span class="up">paper feed</span><small>updated just now</small></div><div class="chart">${chart()}</div><div class="chart-foot"><span><i class="legend up-bg"></i> naik</span><span><i class="legend down-bg"></i> turun</span><span class="muted">Sumber: ${state.logged ? 'Stockity read-only / demo feed' : 'Demo data'}</span></div></div><div class="panel strategy-panel"><div class="panel-head"><div><span class="eyebrow">BOT CONTROL</span><h2>Strategi</h2></div><span class="mini-status">${state.running ? 'RUNNING' : 'IDLE'}</span></div><label>Metode<select id="strategy">${(['Momentum', 'Fast', 'Bounce', 'Flash5st'] as StrategyName[]).map(x => `<option ${x === state.strategy ? 'selected' : ''}>${x}</option>`).join('')}</select></label><div class="two"><label>Bid paper<div class="input-prefix"><span>Rp</span><input id="bid" type="number" min="1" max="100000" value="${state.bid}"/></div></label><label>Max loss harian<div class="input-prefix"><span>Rp</span><input id="maxLoss" type="number" min="1" max="10000000" value="${state.maxDailyLoss}"/></div></label></div><div class="risk"><div><span>Risk guard</span><b>${state.risk.emergencyStop ? 'STOP' : 'Aktif'}</b></div><small>${decisionText()}</small><small>Paper decision: ${decision && decision.direction !== 'HOLD' ? 'candidate, tidak dikirim' : 'hold'}</small></div><button class="outline full" id="saveBtn">Simpan konfigurasi paper</button></div></section><section class="lower-grid"><div class="panel signal-panel"><div class="panel-head"><div><span class="eyebrow">SIGNAL QUEUE</span><h2>Sinyal berikutnya</h2></div><span class="count">${rows.length} baris</span></div><textarea id="signal" placeholder="Tempel signal di sini... contoh: 14:25 BUY">${state.signal}</textarea><div class="signal-list">${rows.length ? rows.map(x => `<div class="signal-row ${x.ok ? '' : 'invalid'}"><span>${x.time}</span><b>${x.dir}</b><small>${x.ok ? 'Siap diproses paper' : 'Format tidak dikenali'}</small></div>`).join('') : '<div class="empty">Belum ada signal. Engine menggunakan candle demo.</div>'}</div></div><div class="panel activity-panel"><div class="panel-head"><div><span class="eyebrow">ACTIVITY</span><h2>Audit keputusan</h2></div><button class="link" id="clearActivity">Kosongkan</button></div>${state.activity.length ? state.activity.map(x => `<div class="signal-row"><span>•</span><b>ENGINE</b><small>${x}</small></div>`).join('') : '<div class="empty big"><span class="empty-icon">◌</span><b>Belum ada keputusan</b><small>Jalankan engine paper untuk mulai mengevaluasi candle.</small></div>'}</div></section></main></div><div class="toast" id="toast"></div>`;
  bind();
}
function toast(message: string) { const element = $('#toast'); element.textContent = message; element.classList.add('show'); setTimeout(() => element.classList.remove('show'), 3200); }
function bind() {
  const set = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener('click', fn);
  set('runBtn', () => { if (state.running) { stopBot(); render(); toast('Engine dihentikan.'); } else { startBot(); toast('Strategy engine paper dimulai.'); } });
  set('refreshBtn', async () => { try { const data = await api('/api/data/candles'); state.candles = data.candles; state.decision = evaluateStrategy(state.candles, state.strategy); render(); toast('Candle diperbarui.'); } catch (error) { toast((error as Error).message); } });
  set('modeBtn', () => toast('Live trading dikunci: adapter order broker belum tersedia.'));
  set('assetBtn', () => { const name = prompt('Pilih asset paper (contoh Crypto IDX, BTCUSD-OTC):', state.asset); if (name) { state.asset = name; render(); } });
  set('themeBtn', () => { document.body.classList.toggle('dark'); toast('Tema diperbarui.'); });
  set('loginBtn', login); set('loginBtn2', login); set('clearActivity', () => { state.activity = []; render(); });
  document.getElementById('strategy')?.addEventListener('change', event => { state.strategy = (event.target as HTMLSelectElement).value as StrategyName; state.decision = evaluateStrategy(state.candles, state.strategy); render(); });
  document.getElementById('bid')?.addEventListener('change', event => { state.bid = Math.max(1, Number((event.target as HTMLInputElement).value) || 1); });
  document.getElementById('maxLoss')?.addEventListener('change', event => { state.maxDailyLoss = Math.max(1, Number((event.target as HTMLInputElement).value) || 1); });
  document.getElementById('signal')?.addEventListener('input', event => { state.signal = (event.target as HTMLTextAreaElement).value; });
  set('saveBtn', () => toast(`Konfigurasi ${state.strategy} disimpan lokal sebagai paper mode.`));
}
async function login() {
  if (state.logged) { toast('Sesi Stockity aktif untuk pembacaan read-only.'); return; }
  if (document.getElementById('loginModal')) return;
  const modal = document.createElement('div'); modal.id = 'loginModal';
  modal.innerHTML = `<div class="login-backdrop"><form class="login-card" id="loginForm"><button type="button" class="login-close" id="loginClose" aria-label="Tutup">×</button><span class="eyebrow">SECURE CONNECTION</span><h2>Login Stockity</h2><p>Password hanya dikirim melalui HTTPS ke Worker dan tidak disimpan di browser. Sesi ini tidak mengaktifkan order.</p><label>Email<input id="loginEmail" type="email" autocomplete="username" required placeholder="nama@email.com"></label><label>Password<input id="loginPassword" type="password" autocomplete="current-password" required placeholder="Password Stockity"></label><label id="loginOtpWrap" hidden>Kode OTP<input id="loginOtp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="12" placeholder="Kode verifikasi Stockity"></label><div class="login-error" id="loginError" role="alert"></div><button class="primary full" id="loginSubmit" type="submit">Masuk</button></form></div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove(); document.getElementById('loginClose')?.addEventListener('click', close); document.querySelector('.login-backdrop')?.addEventListener('click', event => { if (event.target === event.currentTarget) close(); });
  document.getElementById('loginEmail')?.focus();
  document.getElementById('loginForm')?.addEventListener('submit', async event => {
    event.preventDefault(); const email = (document.getElementById('loginEmail') as HTMLInputElement).value.trim(); const password = (document.getElementById('loginPassword') as HTMLInputElement).value; const submit = document.getElementById('loginSubmit') as HTMLButtonElement; const error = document.getElementById('loginError') as HTMLElement; submit.disabled = true; submit.textContent = 'Memeriksa...'; error.textContent = '';
    try { const otpStep = submit.dataset.otp === 'true'; const otp = (document.getElementById('loginOtp') as HTMLInputElement).value.trim(); const result = await api(otpStep ? '/api/auth/2fa' : '/api/auth/login', { method: 'POST', body: JSON.stringify(otpStep ? { password, otp } : { email, password }) }); if (result.twoFactorRequired) { submit.dataset.otp = 'true'; (document.getElementById('loginOtpWrap') as HTMLElement).hidden = false; submit.disabled = false; submit.textContent = 'Verifikasi OTP'; error.textContent = 'Masukkan kode OTP yang diminta Stockity.'; (document.getElementById('loginOtp') as HTMLInputElement).focus(); return; } state.logged = true; close(); toast('Login read-only berhasil. Live tetap terkunci.'); render(); } catch (caught) { error.textContent = (caught as Error).message; submit.disabled = false; submit.textContent = submit.dataset.otp === 'true' ? 'Verifikasi OTP' : 'Masuk'; }
  });
}
render();
