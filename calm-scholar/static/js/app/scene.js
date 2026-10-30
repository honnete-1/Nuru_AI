/* The Study Together scene: avatar + Nuru at a shared desk, study-space settings, Nuru's voice, ambient sound.
   The scene is illustration only; every action lives in labelled HTML controls. */
import { S } from './core.js';
import { $, $$, esc } from './util.js';

let sceneCount = 0;

export function effectiveTheme(theme) {
  if (theme === 'day' || theme === 'evening') return theme;
  const h = new Date().getHours();
  return h >= 18 || h < 6 ? 'evening' : 'day';
}

/** Clone the scene template with unique gradient ids. `activity`: idle | writing | reading. */
export function sceneSVG({ cls = '', label = '', nuru = '' } = {}) {
  const tpl = document.getElementById('tpl-scene');
  if (!tpl) return '';
  const id = `S${++sceneCount}`;
  let html = tpl.innerHTML.replace(/SceneTpl/g, id).replace('class="scene-svg"', `class="scene-svg ${esc(cls)}"`);
  if (label) html = html.replace(/aria-label="[^"]*"/, `aria-label="${esc(label)}"`);
  if (nuru) html = html.replace(/(class="nuru"[^>]*data-state=")welcoming"/, `$1${esc(nuru)}"`);
  return html;
}

/** Apply the student's study space (light, view, lamp, avatar, keepsakes) to every scene on the page. */
export function applyScene() {
  const st = S.state;
  if (!st) return;
  const r = st.room, p = st.profile, theme = effectiveTheme(r.theme);
  document.body.dataset.theme = theme;
  document.documentElement.dataset.motion = p.motion;
  $$('.scene-svg').forEach(el => {
    el.dataset.theme = theme; el.dataset.scenery = r.scenery; el.dataset.lamp = r.lamp;
    el.dataset.skin = p.avatar.skin; el.dataset.hair = p.avatar.hair; el.dataset.outfit = p.avatar.outfit;
    [...el.classList].filter(c => c.startsWith('has-')).forEach(c => el.classList.remove(c));
    r.placed.forEach(k => el.classList.add('has-' + k));
    fitScene(el);
  });
  $$('.nuru').forEach(n => { n.dataset.hue = p.companion_hue; });
  const nm = p.companion_name;
  ['#nav-companion', '#more-companion'].forEach(s => { const n = $(s); if (n) n.textContent = `Talk to ${nm}`; });
  const navBtn = $('#mainnav [data-nav="companion"]'); if (navBtn) navBtn.title = `Talk to ${nm}`;
}
export const applyRoom = applyScene;

/** Small frames zoom in on the two seats rather than shrinking the whole room. */
function fitScene(el) {
  const narrow = window.innerWidth <= 900;
  const band = !!el.closest('.study-scene, .desk-preview, .space-preview');
  const close = el.classList.contains('compact') || (narrow && band);
  // Wide bands keep both faces and the desk in view; compact frames zoom in on the two seats.
  const box = close ? (narrow ? '360 120 500 240' : '280 50 680 330') : band ? '0 105 1200 285' : '0 0 1200 460';
  el.setAttribute('viewBox', box);
  el.setAttribute('preserveAspectRatio', close || band ? 'xMidYMid slice' : 'xMidYMax slice');
}
window.addEventListener('resize', () => $$('.scene-svg').forEach(fitScene));

export function setActivity(activity) { $$('.scene-svg').forEach(el => { el.dataset.activity = activity; }); }

/* ---- Nuru ---- */
let bubbleTimer;
export function setNuru(state) { $$('.nuru[data-live], .scene-svg .nuru, .companion-nuru .nuru').forEach(n => { n.dataset.state = state; }); }

export function nuruSay(text, state = 'welcoming', { action = null, ms = 9000 } = {}) {
  setNuru(state);
  // In Study Together, Nuru speaks from its own panel so nothing floats over the work.
  const say = $('.companion-say');
  if (say && say.parentElement.offsetParent !== null && getComputedStyle(say.parentElement).visibility !== 'hidden' && !document.querySelector('.study.is-collapsed')) {
    say.textContent = text; say.hidden = false;
    clearTimeout(bubbleTimer);
    if (ms) bubbleTimer = setTimeout(() => { say.hidden = true; }, ms);
    return;
  }
  const b = $('#nuru-bubble'); if (!b) return;
  const name = esc(S.state?.profile?.companion_name || 'Nuru');
  b.innerHTML = `<span class="who"><i class="lamp-dot"></i>${name}</span><span>${esc(text)}</span>${action ? `<button class="btn btn-sm btn-soft" data-bubble-act>${esc(action.label)}</button>` : ''}<button class="icon-btn bubble-x" aria-label="Dismiss">×</button>`;
  b.hidden = false;
  if (action) b.querySelector('[data-bubble-act]').addEventListener('click', () => { b.hidden = true; action.run(); });
  b.querySelector('.bubble-x').addEventListener('click', () => { b.hidden = true; });
  clearTimeout(bubbleTimer);
  if (ms) bubbleTimer = setTimeout(() => { b.hidden = true; }, ms);
}

/* ---- Ambient sound: generated in the browser, never autoplays ---- */
export const sound = { ctx: null, nodes: [], playing: false, kind: 'off' };

function noiseBuffer(ctx, type) {
  const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; } else d[i] = w;
  }
  return buf;
}

export function stopSound() {
  sound.nodes.forEach(n => { try { n.stop ? n.stop() : n.disconnect(); } catch { /* already stopped */ } });
  sound.nodes = []; sound.playing = false;
  clearInterval(sound.crackle);
}

export function playSound(kind, volume = 0.5) {
  stopSound();
  if (kind === 'off') return;
  const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
  sound.ctx = sound.ctx || new Ctx();
  const ctx = sound.ctx; ctx.resume();
  const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(ctx.destination);
  gain.gain.linearRampToValueAtTime(volume * (kind === 'rain' ? 0.35 : 0.5), ctx.currentTime + 2.5);
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, kind === 'rain' ? 'white' : 'brown'); src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = kind === 'rain' ? 'bandpass' : 'lowpass'; filter.frequency.value = kind === 'rain' ? 1400 : 420; filter.Q.value = kind === 'rain' ? 0.6 : 0.4;
  src.connect(filter).connect(gain); src.start();
  sound.nodes = [src, gain];
  if (kind === 'hearth') {
    sound.crackle = setInterval(() => {
      if (Math.random() > 0.55) return;
      const c = ctx.createBufferSource(); c.buffer = noiseBuffer(ctx, 'white');
      const g = ctx.createGain(); const t = ctx.currentTime;
      g.gain.setValueAtTime(volume * 0.25 * Math.random(), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.06);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      c.connect(hp).connect(g).connect(ctx.destination); c.start(t); c.stop(t + 0.15);
    }, 180);
  }
  sound.playing = true; sound.kind = kind;
}
