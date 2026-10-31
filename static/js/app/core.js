/* Shared application state and the single mutation path. */
import { api } from './api.js';
import { toast, esc } from './util.js';

const DRAFTS = 'cs-drafts';
function loadDrafts() {
  try { return new Map(JSON.parse(sessionStorage.getItem(DRAFTS) || '[]')); } catch { return new Map(); }
}

export const S = {
  state: null,
  // In-session conversations, keyed by thread. Not persisted unless the student opts into saved history.
  chats: new Map(),
  // Typed-but-unsent text survives navigation and reloads in this tab only (sessionStorage).
  drafts: loadDrafts(),
  passages: new Map(),
  ui: {},
  route: { name: 'home', params: [] },
};

export function saveDrafts() {
  try { sessionStorage.setItem(DRAFTS, JSON.stringify([...S.drafts].filter(([k, v]) => typeof v === 'string' && v).slice(-40))); } catch { /* storage unavailable */ }
}

const listeners = new Set();
export const onChange = fn => listeners.add(fn);
export function setState(next, { silent = false } = {}) {
  S.state = next;
  if (!silent) listeners.forEach(fn => fn(next));
}

let hooks = { keepsakes: () => {}, rerender: () => {} };
export const setHooks = h => { hooks = { ...hooks, ...h }; };
export const rerender = () => hooks.rerender();
/** Navigate to a hash; renders exactly once whether or not the hash changes. */
export function go(hash) { if (location.hash === hash) hooks.rerender(); else location.hash = hash; }

/** Call a backend action, refresh state, celebrate any newly earned keepsake. */
export async function act(action, data = {}, { message = '', render = true, timeout } = {}) {
  const result = await api(action, data, { timeout });
  if (result.state) setState(result.state, { silent: !render });
  if (message) toast(message);
  if (result.new_keepsakes?.length) hooks.keepsakes(result.new_keepsakes);
  return result;
}

/** Run an action from a button with a busy state and a friendly error toast. */
export async function guarded(button, fn) {
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  try { return await fn(); }
  catch (e) { toast(e.message || 'Something went wrong.', { error: true }); return null; }
  finally { if (button && button.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); } }
}

export const assignment = id => S.state.assignments.find(a => String(a.id) === String(id));
export const course = id => S.state.courses.find(c => String(c.id) === String(id));
export const companionName = () => esc(S.state?.profile?.companion_name || 'Nuru');

export function thread(key) {
  if (!S.chats.has(key)) S.chats.set(key, []);
  return S.chats.get(key);
}
