/* Network layer: CSRF, timeouts, and failure states the interface can explain. */
export class ApiError extends Error {
  constructor(message, code = 'error', status = 0) { super(message); this.code = code; this.status = status; }
}

const csrf = () => decodeURIComponent((document.cookie.split('; ').find(s => s.startsWith('csrftoken=')) || '').split('=')[1] || '');

async function request(url, options, timeoutMs) {
  if (!navigator.onLine) throw new ApiError("You seem to be offline. Your message is still here; try again when you're connected.", 'offline');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { credentials: 'same-origin', signal: ctrl.signal, ...options });
  } catch (e) {
    if (e.name === 'AbortError') throw new ApiError('This is taking longer than expected. Nothing was lost; you can try again.', 'timeout');
    throw new ApiError("Couldn't reach Calm Scholar. Check your connection and try again.", 'network');
  } finally { clearTimeout(timer); }
  if (response.redirected && response.url.includes('/accounts/login')) { location.href = '/accounts/login/?next=/app/'; throw new ApiError('Please log in again.', 'auth'); }
  if (response.status === 403) throw new ApiError('Your session or security token expired. Reload the page to continue.', 'csrf', 403);
  if (response.status === 404) throw new ApiError("That item isn't available any more. It may have been deleted.", 'missing', 404);
  let body = null;
  try { body = await response.json(); } catch { /* not JSON */ }
  if (!response.ok) {
    if (response.status === 429) throw new ApiError(body?.error || "You've reached a limit for now. Please try again later.", 'rate_limited', 429);
    if (response.status >= 500) throw new ApiError('Something went wrong on the server. Your work is safe; please try again.', 'server', response.status);
    throw new ApiError(body?.error || 'Please check the values and try again.', 'invalid', response.status);
  }
  if (!body) throw new ApiError('The server sent an unexpected reply.', 'invalid');
  return body;
}

export const api = (action, data = {}, { timeout = 20000 } = {}) => request('/api/action/', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() }, body: JSON.stringify({ action, ...data }),
}, timeout);

export const getState = () => request('/api/state/', { method: 'GET' }, 15000);

export const upload = formData => request('/api/materials/upload/', { method: 'POST', headers: { 'X-CSRFToken': csrf() }, body: formData }, 60000);

export const getPassage = id => request(`/api/passages/${encodeURIComponent(id)}/`, { method: 'GET' }, 10000);

export const getMaterialPassages = id => request(`/api/materials/${encodeURIComponent(id)}/passages/`, { method: 'GET' }, 10000);
