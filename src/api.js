const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
import {ApiError} from './api-error.js';
export {ApiError} from './api-error.js';
export class Api {
  constructor({ token, faceitKey, fetcher = fetch }) { this.token = token; this.faceitKey = faceitKey; this.fetcher = fetcher; this.cooldown = {}; }
  async request(service, url, options = {}) {
    if ((this.cooldown[service] ?? 0) > Date.now()) throw new ApiError(service, 429, 'Сервіс просить зачекати.');
    for (let attempt = 0; attempt < 3; attempt++) {
      let response, body;
      try {
        response = await this.fetcher(url, { ...options, signal: AbortSignal.timeout(40000) });
        body = await response.json();
      } catch {
        if (attempt < 2) { await sleep(500 * 2 ** attempt); continue; }
        throw new ApiError(service, 0, 'Не вдалося з’єднатися із сервісом.');
      }
      if (response.ok && (service !== 'Telegram' || body.ok)) return service === 'Telegram' ? body.result : body;
      const status = body.error_code ?? response.status;
      if (status === 429) {
        const retry = Number(body.parameters?.retry_after ?? response.headers.get('retry-after') ?? 60);
        this.cooldown[service] = Date.now() + Math.max(1, retry) * 1000;
        throw new ApiError(service, status, 'Ліміт запитів; повторимо пізніше.', retry);
      }
      if (status >= 500 && attempt < 2) { await sleep(500 * 2 ** attempt); continue; }
      throw new ApiError(service, status, service === 'Telegram' ? body.description ?? 'Помилка API' : `HTTP ${status}`);
    }
  }
  tg(method, body = {}) {
    return this.request('Telegram', `https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  }
  tgUpload(method, body, files) {
    const form = new FormData();
    for (const [key, value] of Object.entries(body)) if (value != null) form.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    for (const [key, bytes] of Object.entries(files)) form.set(key, new Blob([bytes], {type:'image/png'}), 'faceit-stats.png');
    return this.request('Telegram', `https://api.telegram.org/bot${this.token}/${method}`, {method:'POST', body:form});
  }
  faceit(path, params = {}) {
    return this.request('FACEIT', `https://open.faceit.com/data/v4${path}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${this.faceitKey}` }
    });
  }
  async history(id, from, to) {
    const result = new Map();
    for (let offset = 0; offset <= 1000; offset += 100) {
      const page = await this.faceit(`/players/${id}/history`, { game: 'cs2', from, to, offset, limit: 100 });
      for (const m of page.items ?? []) if (m.finished_at && String(m.status).toLowerCase() === 'finished') result.set(m.match_id, m);
      if ((page.items?.length ?? 0) < 100) return [...result.values()];
    }
    throw new Error('Забагато матчів для одного запиту; дані не оновлено, щоб не показати неповний результат.');
  }
}
