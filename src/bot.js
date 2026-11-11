import { dayKey, previousDay, normalizeMatch, matchesForDay, observe, delta, deltaLabel, tag, summary, nicknameFrom, escapeHtml as h } from './domain.js';

export const HELP = `🎮 Barni · FACEIT CS2
/link nickname — прив’язати профіль (або URL)
/unlink — відв’язати профіль і прибрати тег
/stats — сьогодні / останні 20 / за весь час
/last — останній матч
/top — рейтинг чату за Elo
/top day або /top week — зміна рейтингу
/summary — підсумок сьогодні
/summary yesterday — підсумок учора
/records — рекорд Elo й серія перемог
/tags on або /tags off — теги (для адмінів)
/status — свіжість даних і стан тегів

Матчі рахуємо за завершенням, день — за часом чату.
? у тегу: немає повного дня спостережень; ~: приблизна добова зміна Elo.
Прив’язка за ніком не підтверджує володіння FACEIT-акаунтом.`;

export class Bot {
  constructor(api, store, config) {
    this.api = api; this.store = store; this.s = store.state; this.config = config;
    this.zone = config.zone; this.inflight = new Map();
  }
  send(chat, text, extra = {}) {
    return this.api.tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
  }
  allowed(chat) { return chat.type === 'private' || !this.config.chatId || String(chat.id) === this.config.chatId; }
  group(chat) {
    if (chat.type === 'private') throw new Error('Ця команда працює в групі.');
    return this.s.chats[chat.id] ??= { members: [], tags: true, tagState: {} };
  }
  attach(chat, uid) {
    if (chat.type === 'private') return;
    const group = this.group(chat);
    if (!group.members.includes(String(uid))) group.members.push(String(uid));
  }
  player(uid) {
    const id = this.s.users[uid]?.playerId;
    if (!id || !this.s.players[id]) throw new Error('Спочатку прив’яжи FACEIT: /link nickname');
    return this.s.players[id];
  }
  async refresh(id, force = false) {
    if (this.inflight.has(id)) return this.inflight.get(id);
    const p = this.s.players[id];
    if (!force && p.observedAt && Date.now() - p.observedAt < 55000) return p;
    const run = (async () => {
      const now = Date.now();
      const profile = await this.api.faceit(`/players/${id}`);
      // Seven days plus boundary padding; all pages, filtered by actual finish time later.
      const history = await this.api.history(id, Math.floor(now / 1000) - 9 * 86400, Math.floor(now / 1000));
      observe(p, profile, history.map(m => normalizeMatch(m, id)), now, this.zone);
      this.store.save(); return p;
    })();
    this.inflight.set(id, run);
    try { return await run; } finally { this.inflight.delete(id); }
  }
  async details(p, matches) {
    for (const m of matches) {
      if (m.stats) continue;
      const data = await this.api.faceit(`/matches/${encodeURIComponent(m.id)}/stats`);
      const round = data.rounds?.[0];
      const player = round?.teams?.flatMap(t => t.players ?? []).find(v => v.player_id === p.id);
      if (player?.player_stats) {
        m.stats = player.player_stats; m.map = round.round_stats?.Map;
        if (p.matches[m.id]) Object.assign(p.matches[m.id], m);
      }
    }
    this.store.save();
  }
  async recent(p) {
    const page = await this.api.faceit(`/players/${p.id}/history`, { game: 'cs2', from: 0, limit: 20 });
    return (page.items ?? []).filter(m => m.finished_at && m.status === 'FINISHED').map(m => ({ ...p.matches[m.match_id], ...normalizeMatch(m, p.id) })).sort((a,b) => b.finished - a.finished);
  }
  async card(uid, period = 'today') {
    const p = await this.refresh(this.player(uid).id);
    const title = `<b>${h(p.nickname)} · Level ${p.level} · ${p.elo} Elo</b>`;
    if (period === 'all') {
      const data = await this.api.faceit(`/players/${p.id}/stats/cs2`);
      const s = data.lifetime ?? {};
      return `${title}\nЗа весь час\nМатчів: ${h(s.Matches ?? '—')} · Перемог: ${h(s.Wins ?? '—')}\nWin rate: ${h(s['Win Rate %'] ?? '—')}%\nK/D: ${h(s['Average K/D Ratio'] ?? s['K/D Ratio'] ?? '—')}\nHS: ${h(s['Average Headshots %'] ?? '—')}%`;
    }
    const today = dayKey(Date.now(), this.zone);
    const matches = period === 'recent' ? await this.recent(p) : matchesForDay(p, today, this.zone);
    await this.details(p, matches);
    const s = summary(matches);
    return `${title}\n${period === 'recent' ? 'Останні 20 матчів' : `Сьогодні · ${today}`}\n${matches.length} матчів · ${s.wins}W / ${s.losses}L\n${period === 'today' ? `Зміна Elo: ${h(deltaLabel(p, today))}\n` : ''}K/D: ${s.kd} · Середні вбивства: ${s.avg}\n${s.form || 'Сьогодні ще без матчів'}\nДетальна статистика: ${s.detailed}/${matches.length} матчів\nОновлено: ${h(this.time(p.observedAt))}`;
  }
  time(timestamp) { return new Date(timestamp).toLocaleString('uk-UA', { timeZone: this.zone }); }
  keyboard(uid) {
    return { inline_keyboard: [[['Сьогодні', 'today'], ['Останні 20', 'recent'], ['За весь час', 'all']].map(([text, period]) => ({ text, callback_data: `stats:${uid}:${period}` }))] };
  }
  async members(chat) {
    const group = this.group(chat), result = [];
    for (const uid of [...group.members]) {
      if (!this.s.users[uid]) continue;
      const membership = await this.api.tg('getChatMember', { chat_id: chat.id, user_id: Number(uid) });
      if (['left', 'kicked'].includes(membership.status)) {
        group.members = group.members.filter(id => id !== uid); delete group.tagState[uid]; continue;
      }
      result.push({ uid, p: this.player(uid) });
    }
    this.store.save(); return result;
  }
  async leaderboard(chat, mode = 'elo', day = dayKey(Date.now(), this.zone), dailySummary = false) {
    const members = await this.members(chat);
    for (const { p } of members) await this.refresh(p.id);
    const keys = [day];
    if (mode === 'week') for (let i = 1; i < 7; i++) keys.push(previousDay(keys.at(-1)));
    const rows = members.map(({ p }) => {
      const complete = keys.every(k => p.days?.[k] && !p.days[k].partial);
      const change = complete ? keys.reduce((sum, k) => sum + delta(p, k), 0) : null;
      const matches = matchesForDay(p, day, this.zone);
      return { p, change, matches, score: mode === 'elo' ? p.elo : change ?? -Infinity };
    }).filter(r => !dailySummary || r.matches.length).sort((a, b) => b.score - a.score);
    const heading = dailySummary ? `📋 Підсумок · ${day}` : `🏆 Топ чату · ${mode === 'elo' ? 'Elo' : mode === 'week' ? 'останні 7 календарних днів' : 'сьогодні'}`;
    const lines = rows.map(({ p, change, matches }, i) => {
      const s = summary(matches);
      return `${i + 1}. <b>${h(p.nickname)}</b> · ${p.elo} Elo${dailySummary ? ` · ${matches.length}g ${s.wins}W/${s.losses}L · ${h(deltaLabel(p, day))}` : mode === 'elo' ? '' : ` · ${change == null ? 'неповні дані' : `≈ ${change > 0 ? '+' : ''}${change}`}`}`;
    });
    // Bound Telegram message size; avoid splitting HTML tags.
    let chunk = `<b>${heading}</b>\n`;
    for (const line of lines) { if (chunk.length + line.length > 3500) { await this.send(chat.id, chunk); chunk = ''; } chunk += `${line}\n`; }
    await this.send(chat.id, chunk + (rows.length ? '' : 'Поки немає результатів.'));
  }
  async admin(chat, uid) {
    this.group(chat);
    const member = await this.api.tg('getChatMember', { chat_id: chat.id, user_id: uid });
    if (!['creator', 'administrator'].includes(member.status)) throw new Error('Ця настройка доступна адміністраторам групи.');
  }
  async setTag(chatId, uid, text) {
    const member = await this.api.tg('getChatMember', { chat_id: chatId, user_id: Number(uid) });
    if (['left', 'kicked'].includes(member.status)) return 'left';
    if (member.status === 'creator') throw new Error('Telegram не дозволяє боту змінювати титул власника групи.');
    if (member.status === 'administrator') {
      if (!member.can_be_edited) throw new Error('Бот не може редагувати титул цього адміністратора.');
      await this.api.tg('setChatAdministratorCustomTitle', { chat_id: chatId, user_id: Number(uid), custom_title: text });
    } else await this.api.tg('setChatMemberTag', { chat_id: chatId, user_id: Number(uid), tag: text });
    return 'ok';
  }
  async updateTags(chatId, group) {
    for (const uid of [...group.members]) {
      if (!this.s.users[uid]) continue;
      const p = this.player(uid);
      if (!p.observedAt || Date.now() - p.observedAt > 180000) continue;
      const text = tag(p, dayKey(Date.now(), this.zone), this.zone);
      const saved = group.tagState[uid] ??= {};
      if (saved.value === text || (saved.retryAt ?? 0) > Date.now()) continue;
      try {
        const result = await this.setTag(chatId, uid, text);
        if (result === 'left') { group.members = group.members.filter(id => id !== uid); delete group.tagState[uid]; }
        else Object.assign(saved, { value: text, error: null, retryAt: 0 });
      } catch (error) { saved.error = error.message; saved.retryAt = Date.now() + 300000; }
      this.store.save();
    }
  }
  async tick() {
    for (const id of new Set(Object.values(this.s.users).map(u => u.playerId))) {
      try { await this.refresh(id, true); }
      catch (error) { console.error(`Refresh failed (${error.status ?? 'unavailable'})`); }
    }
    for (const [id, group] of Object.entries(this.s.chats)) {
      if (this.config.chatId && id !== this.config.chatId) continue;
      if (group.tags) await this.updateTags(id, group);
    }
  }
  async handle(update) {
    const callback = update.callback_query;
    const message = callback?.message ?? update.message;
    if (!message || !this.allowed(message.chat)) return;
    const chat = message.chat, user = callback?.from ?? message.from;
    if (!user || user.is_bot || message.sender_chat) return;
    try {
      if (callback) {
        await this.api.tg('answerCallbackQuery', { callback_query_id: callback.id });
        const [, uid, period] = /^stats:(\d+):(today|recent|all)$/.exec(callback.data ?? '') ?? [];
        if (!uid) return;
        if (uid !== String(user.id)) return this.send(chat.id, 'Для своєї картки скористайся /stats.');
        const text = await this.card(uid, period);
        try { await this.api.tg('editMessageText', { chat_id: chat.id, message_id: message.message_id, text, parse_mode: 'HTML', reply_markup: this.keyboard(uid) }); }
        catch (error) { if (!error.message.includes('message is not modified')) throw error; }
        return;
      }
      const match = /^\/(\w+)(?:@(\w+))?(?:\s+(.+))?\s*$/.exec(message.text ?? '');
      if (!match || (match[2] && match[2].toLowerCase() !== this.username?.toLowerCase())) return;
      const command = match[1].toLowerCase(), arg = match[3]?.trim();
      if (['start', 'help'].includes(command)) return this.send(chat.id, HELP);
      if (command === 'link') {
        const nickname = nicknameFrom(arg);
        const profile = await this.api.faceit('/players', { nickname, game: 'cs2' });
        if (!profile.games?.cs2) throw new Error('Цей профіль не має CS2.');
        const old = this.s.users[user.id]?.playerId;
        if (old && old !== profile.player_id) throw new Error('Спочатку /unlink, потім прив’яжи новий профіль.');
        if (Object.entries(this.s.users).some(([uid, u]) => uid !== String(user.id) && u.playerId === profile.player_id)) throw new Error('Цей FACEIT-профіль уже прив’язаний до іншого учасника.');
        this.s.players[profile.player_id] ??= { id: profile.player_id };
        await this.refresh(profile.player_id, true);
        this.s.users[user.id] = { playerId: profile.player_id };
        this.attach(chat, user.id); this.store.save();
        await this.send(chat.id, `✅ Прив’язано <b>${h(profile.nickname)}</b>. /stats — твоя статистика.\n${chat.type === 'private' ? 'Виклич /stats у групі, щоб додати себе до її рейтингу й тегів.' : 'Тег з’явиться протягом наступного циклу, якщо бот має право керувати тегами.'}`);
        return;
      }
      if (command === 'unlink') {
        const id = this.player(user.id).id;
        // Clean tags before forgetting association, so failed removals can be retried.
        for (const [chatId, group] of Object.entries(this.s.chats)) {
          if (group.tagState[user.id]?.value) await this.setTag(chatId, user.id, '');
          group.members = group.members.filter(uid => uid !== String(user.id)); delete group.tagState[user.id];
        }
        delete this.s.users[user.id];
        // A pending refresh may still hold a reference, but cannot reinsert the deleted player.
        delete this.s.players[id]; this.store.save();
        return this.send(chat.id, 'Профіль відв’язано, збережені дані й теги прибрано.');
      }
      if (command === 'tags') {
        await this.admin(chat, user.id);
        if (!['on', 'off'].includes(arg)) throw new Error('Використай /tags on або /tags off.');
        const group = this.group(chat);
        if (arg === 'off') {
          group.tags = false; this.store.save();
          for (const [uid, state] of Object.entries(group.tagState)) if (state.value) { await this.setTag(chat.id, uid, ''); delete group.tagState[uid]; this.store.save(); }
        } else { group.tags = true; for (const state of Object.values(group.tagState)) state.retryAt = 0; }
        this.store.save();
        return this.send(chat.id, arg === 'on' ? 'Теги ввімкнено. Боту потрібне право керування тегами.' : 'Теги вимкнено й прибрано.');
      }
      if (command === 'top') return await this.leaderboard(chat, ['day', 'week'].includes(arg) ? arg : 'elo');
      if (command === 'summary') return await this.leaderboard(chat, 'day', arg === 'yesterday' ? previousDay(dayKey(Date.now(), this.zone)) : dayKey(Date.now(), this.zone), true);
      if (!['stats', 'last', 'records', 'status'].includes(command)) return this.send(chat.id, HELP);
      const p = this.player(user.id); this.attach(chat, user.id); this.store.save();
      if (command === 'status') {
        const state = this.s.chats[chat.id]?.tagState[user.id];
        return this.send(chat.id, `Останнє оновлення: ${p.observedAt ? h(this.time(p.observedAt)) : 'ще не було'}\nЧасовий пояс: ${h(this.zone)}\nТег: ${h(state?.error ?? state?.value ?? 'ще не встановлено')}\nІнтервал перевірки: ${this.config.interval / 1000} с`);
      }
      if (command === 'stats') return this.send(chat.id, await this.card(user.id), { reply_markup: this.keyboard(user.id) });
      await this.refresh(p.id);
      if (command === 'last') {
        const m = (await this.recent(p))[0];
        if (!m) return this.send(chat.id, 'Завершених матчів не знайдено.');
        await this.details(p, [m]);
        return this.send(chat.id, `<b>${h(p.nickname)} · останній матч</b>\n${m.win === true ? '🟩 Перемога' : m.win === false ? '🟥 Поразка' : 'Результат недоступний'} · ${h(m.score)}\nКарта: ${h(m.map ?? '—')}\nK / D / A: ${h(m.stats?.Kills ?? '—')} / ${h(m.stats?.Deaths ?? '—')} / ${h(m.stats?.Assists ?? '—')}\n${h(this.time(m.finished))}\n<a href="${h(m.url)}">Відкрити матч</a>`);
      }
      const recent = await this.recent(p), s = summary(recent);
      return this.send(chat.id, `🏅 <b>${h(p.nickname)}</b>\nМаксимум Elo від початку спостережень: ${p.peak}\nПоточний рівень: ${p.level}\nСерія перемог: ${s.streak}${s.streak === 20 ? '+' : ''}\nФорма: ${s.form || '—'}`);
    } catch (error) {
      const text = error.service === 'FACEIT' ? `FACEIT тимчасово недоступний або профіль не знайдено (${error.status}). Спробуй пізніше.` : error.message;
      await this.send(chat.id, `⚠️ ${h(text)}`);
    }
  }
}
