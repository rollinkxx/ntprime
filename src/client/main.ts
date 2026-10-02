import './styles.css';
import { checkRisk, evaluateStrategy, martingaleBid, martingaleTable, nextMartingaleStep, type Candle, type RiskSnapshot, type StrategyDecision, type StrategyName } from './trading';

type FeedSource = 'stockity' | 'demo' | 'demo-fallback';
const state = {
  asset: 'Crypto IDX', strategy: 'Momentum' as StrategyName, bid: 10_000, maxDailyLoss: 50_000, maxDailyProfit: 0,
  maxTradesPerDay: 20, minConfidence: .55, martingale: true, multiplier: 2, maxMartingale: 5,
  signal: '', candles: [] as Candle[], feed: 'demo' as FeedSource, running: false, logged: false, ticks: 0,
  paperBalance: 140_000, paperWins: 0, paperLosses: 0, openPaperTrade: null as { direction: 'CALL'|'PUT'; bid: number; entryPrice: number; entryCandleTime: number } | null,
  activity: [] as string[], decision: null as StrategyDecision | null,
  risk: { dailyPnl: 0, tradesToday: 0, emergencyStop: false, martingaleStep: 0 } as RiskSnapshot,
};
let botTimer: number | undefined; let feedTimer: number | undefined;
const $ = (selector: string) => document.querySelector(selector) as HTMLElement;
const money = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
function addActivity(message: string) { state.activity = [`${new Date().toLocaleTimeString('id-ID')} · ${message}`, ...state.activity].slice(0, 10); }
async function api(path: string, init?: RequestInit) { const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data; }
async function refreshFeed(silent = false) {
  try {
    const data = await api(`/api/data/candles?asset=${encodeURIComponent(state.asset)}`);
    state.candles = data.candles || []; state.feed = data.source || 'demo'; state.decision = evaluateStrategy(state.candles, state.strategy);
    if (!silent) addActivity(`Feed ${state.feed === 'stockity' ? 'Stockity live' : 'demo fallback'} diperbarui · ${state.candles.length} candle`);
    render();
  } catch (error) { if (!silent) toast((error as Error).message); }
}
async function restoreSession() {
  try {
    const session = await api('/api/session');
    if (session.authenticated) {
      state.logged = true;
      await refreshFeed(true);
      render();
    }
  } catch {
    // The cockpit remains usable in explicit demo fallback mode when no session exists.
  }
}
function settlePaperTrade(exitPrice: number) {
  const trade = state.openPaperTrade; if (!trade) return;
  const won = trade.direction === 'CALL' ? exitPrice > trade.entryPrice : exitPrice < trade.entryPrice;
  const pnl = won ? Math.round(trade.bid * .8) : -trade.bid;
  state.paperBalance += pnl; state.risk.dailyPnl += pnl; state.risk.tradesToday++;
  if (won) state.paperWins++; else state.paperLosses++;
  state.risk.martingaleStep = nextMartingaleStep(state.risk.martingaleStep, won, state.martingale, state.maxMartingale);
  addActivity(`PAPER ${won ? 'WIN' : 'LOSS'} ${trade.direction} · ${pnl >= 0 ? '+' : ''}${money(pnl)} · ${won ? 'reset K0' : `lanjut K${state.risk.martingaleStep}`}`);
  state.openPaperTrade = null;
}
function botTick() {
  const last = state.candles.at(-1); if (!last) return;
  const close = last.close;
  // A paper position expires on the next completed candle. Never settle against
  // the same candle used for entry: with a 5s engine and 1m candles that would
  // compare price === entryPrice and mark every CALL/PUT as a loss.
  if (state.openPaperTrade && last.time > state.openPaperTrade.entryCandleTime) settlePaperTrade(close);
  state.ticks++; state.decision = evaluateStrategy(state.candles, state.strategy);
  const risk = checkRisk({ maxBid: 100_000, maxDailyLoss: state.maxDailyLoss, maxDailyProfit: state.maxDailyProfit, maxTradesPerDay: state.maxTradesPerDay, cooldownMs: 5_000, minConfidence: state.minConfidence, martingaleEnabled: state.martingale, martingaleMultiplier: state.multiplier, maxMartingaleStep: state.maxMartingale }, state.risk, state.bid, state.decision);
  if (risk.allowed && !state.openPaperTrade) {
    state.risk.lastDecisionAt = Date.now(); state.openPaperTrade = { direction: state.decision.direction as 'CALL'|'PUT', bid: risk.bid, entryPrice: close, entryCandleTime: last.time };
    addActivity(`PAPER OPEN ${state.decision.direction} · ${money(risk.bid)} · K${state.risk.martingaleStep} @ ${close.toFixed(4)}`);
  } else if (!state.openPaperTrade) addActivity(`RISK BLOCK · ${risk.reasons[0] || 'menunggu settlement'}`);
  render();
}
function startBot() { if (botTimer !== undefined) return; state.running = true; addActivity('Engine paper dimulai · order broker tidak dikirim'); botTick(); botTimer = window.setInterval(botTick, 5_000); feedTimer = window.setInterval(() => refreshFeed(true), 15_000); render(); }
function stopBot() { if (botTimer !== undefined) window.clearInterval(botTimer); if (feedTimer !== undefined) window.clearInterval(feedTimer); botTimer = undefined; feedTimer = undefined; state.running = false; state.openPaperTrade = null; addActivity('Engine dihentikan'); render(); }
function chart() { const candles = state.candles.length ? state.candles : Array.from({ length: 72 }, (_, i) => ({ time: Date.now() - i * 60_000, open: 100, high: 100.8, low: 99.2, close: 100 })).reverse(); const width = 760, height = 270, padding = 24; const min = Math.min(...candles.map(x => x.low)), max = Math.max(...candles.map(x => x.high)); const y = (v: number) => height - padding - (v - min) / (max - min || 1) * (height - padding * 2); const step = (width - padding * 2) / candles.length; return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Candlestick chart"><path d="M0 ${height - 35} H${width} V${height} H0Z" fill="#9fb8a6" opacity=".12"/>${candles.map((x, i) => { const xx = padding + i * step + step / 2, up = x.close >= x.open, color = up ? '#769d86' : '#c97972'; return `<line x1="${xx}" x2="${xx}" y1="${y(x.high)}" y2="${y(x.low)}" stroke="${color}"/><rect x="${xx - step * .3}" y="${Math.min(y(x.open), y(x.close))}" width="${step * .6}" height="${Math.max(2, Math.abs(y(x.open) - y(x.close)))}" rx="1" fill="${color}"/>`; }).join('')}<text x="${padding}" y="18" fill="currentColor" opacity=".55" font-size="11">${state.asset} · Stockity 1m</text></svg>`; }
function decisionText() { return state.decision ? `${state.decision.direction} · ${Math.round(state.decision.confidence * 100)}% · ${state.decision.reason}` : 'Menunggu candle yang cukup.'; }
function render() {
  const table = martingaleTable(state.bid, state.multiplier, state.maxMartingale, 100_000);
  $('#app').innerHTML = `<div class="shell"><aside class="rail"><div class="brand"><span class="brand-mark">N</span><span>NEWTON<br><b>PRIME</b></span></div><div class="rail-section">WORKSPACE</div><button class="nav active">▦ <span>Cockpit</span></button><button class="nav">◷ <span>Riwayat trade</span></button><button class="nav">⌁ <span>Signal</span></button><div class="rail-section">SYSTEM</div><button class="nav" id="themeBtn">◐ <span>Tema</span></button><button class="nav" id="loginBtn">◎ <span>${state.logged ? 'Akun tersambung' : 'Login Stockity'}</span></button><div class="rail-foot"><img src="/koala-mascot.png" alt="Koala"/><small>Newton Prime<br><em>v1.2.26 web</em></small></div></aside><main class="main"><header><div><p class="eyebrow">${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>Trading cockpit</h1></div><div class="header-actions"><span class="connection"><i class="dot"></i>${state.logged ? 'Stockity read-only' : 'Login untuk live chart'}</span><button class="icon-btn" id="refreshBtn">↻</button><button class="avatar" id="loginBtn2">${state.logged ? 'S' : 'N'}</button></div></header><section class="hero"><div><div class="status-line"><span class="pulse ${state.running ? 'on' : ''}"></span><b>${state.running ? 'Newton sedang bekerja' : 'Newton sedang istirahat'}</b><span class="tag demo">PAPER ONLY</span></div><p class="hero-copy">Chart ${state.feed === 'stockity' ? 'live Stockity' : 'demo fallback'} · semua order virtual dan tidak dikirim ke broker.</p></div><div class="hero-actions"><button class="switch" id="modeBtn"><span></span>Order live terkunci</button><button class="primary" id="runBtn">${state.running ? 'Hentikan engine' : 'Jalankan engine'} <kbd>⌘ ↵</kbd></button></div></section><section class="metrics"><div><span>Saldo PAPER</span><strong>${money(state.paperBalance)}</strong><small class="${state.risk.dailyPnl >= 0 ? 'up' : ''}">${state.risk.dailyPnl >= 0 ? '+' : ''}${money(state.risk.dailyPnl)} P/L hari ini</small></div><div><span>Sumber candle</span><strong class="system-ok">${state.feed === 'stockity' ? 'LIVE' : 'DEMO'}</strong><small>${state.candles.length} candle · 1 menit</small></div><div><span>Trade paper</span><strong>${state.paperWins + state.paperLosses}</strong><small>${state.paperWins} win · ${state.paperLosses} loss · K${state.risk.martingaleStep}</small></div><div><span>Win rate</span><strong>${state.paperWins + state.paperLosses ? Math.round(state.paperWins / (state.paperWins + state.paperLosses) * 100) : '—'}${state.paperWins + state.paperLosses ? '%' : ''}</strong><small>settlement candle berikutnya</small></div></section><section class="grid"><div class="panel chart-panel"><div class="panel-head"><div><span class="eyebrow">MARKET READ</span><h2>Harga Stockity</h2></div><button class="select" id="assetBtn">${state.asset}⌄</button></div><div class="price-row"><strong>${state.candles.at(-1)?.close.toFixed(4) || '—'}</strong><span class="${state.feed === 'stockity' ? 'up' : ''}">${state.feed === 'stockity' ? 'live feed' : 'demo feed'}</span><small>${state.logged ? 'read-only' : 'login diperlukan'}</small></div><div class="chart">${chart()}</div><div class="chart-foot"><span><i class="legend up-bg"></i> naik</span><span><i class="legend down-bg"></i> turun</span><span class="muted">Sumber: ${state.feed === 'stockity' ? 'Stockity API' : 'Demo fallback'}</span></div></div><div class="panel strategy-panel"><div class="panel-head"><div><span class="eyebrow">BOT CONTROL</span><h2>Strategi & Martingale</h2></div><span class="mini-status">${state.running ? 'RUNNING' : 'IDLE'}</span></div><label>Metode signal<select id="strategy">${(['Momentum', 'Fast', 'Bounce', 'Flash5st'] as StrategyName[]).map(x => `<option ${x === state.strategy ? 'selected' : ''}>${x}</option>`).join('')}</select></label><div class="two"><label>Bid dasar paper<div class="input-prefix"><span>Rp</span><input id="bid" type="number" min="1" max="100000" value="${state.bid}"/></div></label><label>Pengali Martingale<div class="input-prefix"><span>×</span><input id="multiplier" type="number" min="1" max="5" step="0.1" value="${state.multiplier}"/></div></label></div><div class="two"><label>Max loss harian<div class="input-prefix"><span>Rp</span><input id="maxLoss" type="number" min="1" value="${state.maxDailyLoss}"/></div></label><label>Max step (K)<input id="maxMartingale" type="number" min="0" max="10" value="${state.maxMartingale}"/></label></div><label class="check"><input id="martingale" type="checkbox" ${state.martingale ? 'checked' : ''}/> Aktifkan Martingale setelah loss</label><div class="risk"><div><span>Risk guard · ${state.martingale ? `K${state.risk.martingaleStep} · bid ${money(martingaleBid(state.bid, state.risk.martingaleStep, state.multiplier, 100000))}` : 'fixed bid'}</span><b>${state.risk.emergencyStop ? 'STOP' : 'Aktif'}</b></div><small>${decisionText()}</small><small>Reset ke K0 saat WIN · stop saat batas rugi tercapai</small></div><details class="mart-table"><summary>Preview kompensasi</summary>${table.map(row => `<div><span>K${row.step}</span><b>${money(row.bid)}</b></div>`).join('')}</details><button class="outline full" id="saveBtn">Simpan konfigurasi paper</button></div></section><section class="lower-grid"><div class="panel signal-panel"><div class="panel-head"><div><span class="eyebrow">SIGNAL QUEUE</span><h2>Sinyal berikutnya</h2></div></div><textarea id="signal" placeholder="Tempel signal di sini... contoh: 14:25 BUY">${state.signal}</textarea></div><div class="panel activity-panel"><div class="panel-head"><div><span class="eyebrow">ACTIVITY</span><h2>Audit keputusan</h2></div><button class="link" id="clearActivity">Kosongkan</button></div>${state.activity.length ? state.activity.map(x => `<div class="signal-row"><span>•</span><b>ENGINE</b><small>${x}</small></div>`).join('') : '<div class="empty big"><span class="empty-icon">◌</span><b>Belum ada keputusan</b><small>Jalankan engine paper setelah login untuk memakai chart live.</small></div>'}</div></section></main></div><div class="toast" id="toast"></div>`;
  bind();
}
function toast(message: string) { const element = $('#toast'); element.textContent = message; element.classList.add('show'); setTimeout(() => element.classList.remove('show'), 3200); }
function bind() {
  document.getElementById('runBtn')?.addEventListener('click', () => state.running ? stopBot() : startBot());
  document.getElementById('refreshBtn')?.addEventListener('click', () => refreshFeed());
  document.getElementById('modeBtn')?.addEventListener('click', () => toast('Order live tetap terkunci. Engine hanya membuat order virtual.'));
  document.getElementById('assetBtn')?.addEventListener('click', () => { const name = prompt('Masukkan nama/ric asset Stockity:', state.asset); if (name) { state.asset = name; refreshFeed(); } });
  document.getElementById('themeBtn')?.addEventListener('click', () => { document.body.classList.toggle('dark'); render(); });
  document.getElementById('loginBtn')?.addEventListener('click', login); document.getElementById('loginBtn2')?.addEventListener('click', login);
  document.getElementById('clearActivity')?.addEventListener('click', () => { state.activity = []; render(); });
  document.getElementById('strategy')?.addEventListener('change', e => { state.strategy = (e.target as HTMLSelectElement).value as StrategyName; render(); });
  document.getElementById('bid')?.addEventListener('change', e => { state.bid = Math.max(1, Number((e.target as HTMLInputElement).value) || 1); render(); });
  document.getElementById('multiplier')?.addEventListener('change', e => { state.multiplier = Math.min(5, Math.max(1, Number((e.target as HTMLInputElement).value) || 2)); render(); });
  document.getElementById('maxLoss')?.addEventListener('change', e => { state.maxDailyLoss = Math.max(1, Number((e.target as HTMLInputElement).value) || 1); render(); });
  document.getElementById('maxMartingale')?.addEventListener('change', e => { state.maxMartingale = Math.min(10, Math.max(0, Number((e.target as HTMLInputElement).value) || 0)); render(); });
  document.getElementById('martingale')?.addEventListener('change', e => { state.martingale = (e.target as HTMLInputElement).checked; render(); });
  document.getElementById('signal')?.addEventListener('input', e => { state.signal = (e.target as HTMLTextAreaElement).value; });
  document.getElementById('saveBtn')?.addEventListener('click', () => toast(`Konfigurasi ${state.strategy} + Martingale disimpan lokal sebagai paper mode.`));
}
async function login() {
  if (state.logged) { toast('Sesi Stockity aktif untuk chart live read-only.'); return; }
  if (document.getElementById('loginModal')) return;
  const modal = document.createElement('div'); modal.id = 'loginModal';
  modal.innerHTML = `<div class="login-backdrop"><form class="login-card" id="loginForm"><button type="button" class="login-close" id="loginClose">×</button><span class="eyebrow">SECURE CONNECTION</span><h2>Login Stockity</h2><p>Password dikirim hanya melalui HTTPS ke Worker. Sesi ini mengaktifkan chart live read-only; order tetap virtual.</p><label>Email<input id="loginEmail" type="email" autocomplete="username" required></label><label>Password<input id="loginPassword" type="password" autocomplete="current-password" required></label><label id="loginOtpWrap" hidden>Kode OTP<input id="loginOtp" type="text" inputmode="numeric" maxlength="12"></label><div class="login-error" id="loginError"></div><button class="primary full" id="loginSubmit" type="submit">Masuk</button></form></div>`;
  document.body.appendChild(modal); const close = () => modal.remove(); document.getElementById('loginClose')?.addEventListener('click', close);
  document.getElementById('loginForm')?.addEventListener('submit', async event => { event.preventDefault(); const submit = document.getElementById('loginSubmit') as HTMLButtonElement; const error = $('#loginError'); const password = (document.getElementById('loginPassword') as HTMLInputElement).value; submit.disabled = true; try { const otpStep = submit.dataset.otp === 'true'; const result = await api(otpStep ? '/api/auth/2fa' : '/api/auth/login', { method: 'POST', body: JSON.stringify(otpStep ? { password, otp: (document.getElementById('loginOtp') as HTMLInputElement).value } : { email: (document.getElementById('loginEmail') as HTMLInputElement).value.trim(), password }) }); if (result.twoFactorRequired) { submit.dataset.otp = 'true'; (document.getElementById('loginOtpWrap') as HTMLElement).hidden = false; submit.disabled = false; submit.textContent = 'Verifikasi OTP'; return; } state.logged = true; close(); await refreshFeed(true); toast('Login read-only berhasil. Chart Stockity live aktif; order tetap virtual.'); render(); } catch (caught) { error.textContent = (caught as Error).message; submit.disabled = false; } });
}
render();
void restoreSession();
