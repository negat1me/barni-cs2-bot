import {renderStatsImage} from './stats-image.js';
import {renderCommandImage, leaderboardPages} from './command-images.js';
import {loadSamples} from './insights.js';
import { Community } from './community.js';
import { recentCard, lifetimeCard, lastMatchCard } from './cards.js';
import { dayKey, previousDay, normalizeMatch, matchesForDay, observe, tag, summary, nicknameFrom, escapeHtml as h } from './domain.js';

export const HELP = `🎮 Barni · FACEIT CS2
/link nickname — прив’язати профіль (або URL)
/unlink — відв’язати профіль і прибрати тег
/stats — сьогодні / останні 20 / за весь час
/last — останній матч
/party текст — зібрати п’ятірку (наприклад, на 19:00)
/compare nickname — порівняти (або відповідь гравцю)
/tag 5 текст — тег на 5 хв (відповідь гравцю або собі)
/top — рейтинг чату за Elo
/top day або /top week — інформація про доступність приросту Elo
/summary — підсумок сьогодні
/summary yesterday — підсумок учора
/records — поточний рівень і серія перемог
/form — останні 10 проти попередніх 10
/taglist — активні тимчасові теги
/tags on або /tags off — теги (для адмінів)
/status — свіжість даних і стан тегів

Матчі рахуємо за завершенням. Ігровий день — від 07:00 до 07:00 за часом чату.
Тег: тільки поточне Elo. Історія матчів локально не зберігається.
Прив’язка за ніком не підтверджує володіння FACEIT-акаунтом.`;

export class Bot {
  constructor(api, store, config) {
    this.api = api; this.store = store; this.s = store.state; this.config = config;
    this.zone = config.zone; this.inflight = new Map();
    this.community = new Community(this);
    this.renderImage = renderCommandImage;
  }
  send(chat, text, extra = {}) {
    return this.api.tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
  }
  async sendImage(chat, kind, data, {caption, fallback, ...extra}) {
    let photo;
    try { photo=await this.renderImage(kind,data,{fetcher:this.api.fetcher,zone:this.zone}); }
    catch { return this.send(chat,fallback,extra); }
    return this.api.tgUpload('sendPhoto',{chat_id:chat,photo:'attach://card',caption,parse_mode:'HTML',...extra},{card:photo});
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
  async refresh(id) {
    if (this.inflight.has(id)) return this.inflight.get(id);
    const p = this.s.players[id];

    const run = (async () => {
      const now = Date.now();
      const profile = await this.api.faceit(`/players/${id}`);
      // Today and yesterday with timezone padding; filter by actual finish time later.
      const history = await this.api.history(id, Math.floor(now / 1000) - 3 * 86400, Math.floor(now / 1000));
      observe(p, profile, history.map(m => normalizeMatch(m, id)), now, this.zone);
      return p;
    })();
    this.inflight.set(id, run);
    try { return await run; } finally { this.inflight.delete(id); }
  }
  async details(p, matches) {
    // One official stats page covers most selections, avoiding 20 per-match requests.
    if (matches.length > 1) {
      try {
        const samples = new Map((await loadSamples(this.api, p.id)).map(m => [m.id, m]));
        for (const m of matches) {
          const sample = samples.get(m.id);
          if (sample) { m.stats = sample.stats; m.map = sample.map; }
        }
      } catch (error) { if ([401,403,429].includes(error.status)) throw error; }
    }
    for (const m of matches) {
      if (m.stats) continue;
      const data = await this.api.faceit(`/matches/${encodeURIComponent(m.id)}/stats`);
      const round = data.rounds?.[0];
      const player = round?.teams?.flatMap(t => t.players ?? []).find(v => v.player_id === p.id);
      if (player?.player_stats) {
        m.stats = player.player_stats; m.map = round.round_stats?.Map;

      }
    }
  }
  async recent(p) {
    const page = await this.api.faceit(`/players/${p.id}/history`, { game: 'cs2', from: 0, limit: 20 });
    return (page.items ?? []).filter(m => m.finished_at && String(m.status).toLowerCase() === 'finished').map(m => normalizeMatch(m, p.id)).sort((a,b) => b.finished - a.finished);
  }
  async card(uid, period = 'today') {
    const p = await this.refresh(this.player(uid).id);
    const label = period === 'all' ? 'За весь час' : period === 'recent' ? 'Останні 20 матчів' : `Сьогодні · ${dayKey(Date.now(), this.zone).split('-').reverse().join('.')}`;
    let data, fallback;
    if (period === 'all') {
      const stats = await this.api.faceit(`/players/${p.id}/stats/cs2`);
      data = {player:p, period, lifetime:stats.lifetime ?? {}, label};
      fallback = lifetimeCard(p, data.lifetime, this.zone);
    } else {
      const matches = period === 'recent' ? await this.recent(p) : matchesForDay(p, dayKey(Date.now(),this.zone), this.zone);
      await this.details(p, matches);
      data = {player:p, period, matches, label};
      fallback = recentCard(p, matches, label, this.zone);
    }
    // Rank failures, including rate limits, must not prevent rendering the stats already loaded.
    data.ranks = await this.rankings(p);
    const caption = `<b>${h(p.nickname)}</b> · ${h(label)} · <a href="https://www.faceit.com/en/players/${encodeURIComponent(p.nickname)}">FACEIT ↗</a>`;
    try { return {photo:await renderStatsImage(data, {zone:this.zone, fetcher:this.api.fetcher}), caption, text:fallback}; }
    catch { return {text:fallback}; }
  }
  async rankings(p) {
    if (!p.region) return {};
    const path = `/rankings/games/cs2/regions/${encodeURIComponent(p.region)}/players/${encodeURIComponent(p.id)}`;
    const tasks = [this.api.faceit(path, {limit:1}), /^[a-z]{2}$/i.test(p.country ?? '') ? this.api.faceit(path, {country:p.country.toLowerCase(),limit:1}) : Promise.resolve(null)];
    const results = await Promise.allSettled(tasks);
    const position = r => r.status === 'fulfilled' && Number(r.value?.position)>0 ? Number(r.value.position) : null;
    return {region:position(results[0]), country:position(results[1])};
  }
  async showStats(chat, uid, period='today', messageId=null) {
    const card=await this.card(uid,period), reply_markup=this.keyboard(uid);
    if (!card.photo) {
      return this.send(chat,card.text,{reply_markup});
    }
    if (messageId) return this.api.tgUpload('editMessageMedia',{chat_id:chat,message_id:messageId,media:{type:'photo',media:'attach://card',caption:card.caption,parse_mode:'HTML'},reply_markup},{card:card.photo});
    return this.api.tgUpload('sendPhoto',{chat_id:chat,photo:'attach://card',caption:card.caption,parse_mode:'HTML',reply_markup},{card:card.photo});
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
    if (!dailySummary && mode !== 'elo') {
      return this.send(chat.id, 'FACEIT Data API не надає гарантованого приросту Elo за матч. Без локальної історії рейтингу топ приросту недоступний. /top — поточний рейтинг.');
    }
    const members = await this.members(chat);
    for (const { p } of members) await this.refresh(p.id);
    const rows = members.map(({ p }) => ({ p, matches: matchesForDay(p, day, this.zone) }))
      .filter(r => !dailySummary || r.matches.length).sort((a, b) => b.p.elo - a.p.elo);
    const heading = dailySummary ? `📋 Підсумок · ${day}` : `🏆 Топ чату · ${mode === 'elo' ? 'Elo' : mode === 'week' ? 'останні 7 календарних днів' : 'сьогодні'}`;
    const pages=leaderboardPages(rows);
    for (const [index,page] of pages.entries()) {
      const lines=page.rows.map(({p,matches},i)=>{
        const s=summary(matches), known=s.wins+s.losses;
        return `${page.offset+i+1}. <b>${h(p.nickname)}</b> · ${p.elo} Elo${dailySummary?` · ${matches.length}g ${s.wins}W/${s.losses}L · WR ${known?Math.round(100*s.wins/known)+'%':'—'}`:''}`;
      });
      const caption=`<b>${h(heading)}</b>${pages.length>1?` · ${index+1}/${pages.length}`:''}`;
      await this.sendImage(chat.id,dailySummary?'summary':'top',{...page,day,page:index+1,pages:pages.length},{caption,fallback:caption+'\n'+(lines.join('\n')||'Поки немає результатів.')});
    }
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
      if (group.customTags?.[uid] || !this.s.users[uid]) continue;
      const p = this.player(uid);
      if (!p.matches || !p.observedAt || Date.now() - p.observedAt > 180000) continue;
      const text = tag(p);
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
    await this.community.expireTags();
    this.clearMatches();
    for (const id of new Set(Object.values(this.s.users).map(u => u.playerId))) {
      try { await this.refresh(id); }
      catch (error) { console.error(`Refresh failed (${error.status ?? 'unavailable'})`); }
    }
    for (const [id, group] of Object.entries(this.s.chats)) {
      if (this.config.chatId && id !== this.config.chatId) continue;
      if (group.tags) await this.updateTags(id, group);
    }
    this.clearMatches();
  }
  clearMatches() {
    for (const p of Object.values(this.s.players)) { delete p.matches; }
  }
  async handle(update) {
    const callback = update.callback_query;
    const message = callback?.message ?? update.message;
    if (!message || !this.allowed(message.chat)) return;
    const chat = message.chat, user = callback?.from ?? message.from;
    if (!user || user.is_bot || message.sender_chat) return;
    try {
      if (callback) {
        if ((callback.data ?? '').startsWith('party:')) return await this.community.partyCallback(callback, chat, user);
        await this.api.tg('answerCallbackQuery', { callback_query_id: callback.id });
        const [, uid, period] = /^stats:(\d+):(today|recent|all)$/.exec(callback.data ?? '') ?? [];
        if (!uid) return;
        if (uid !== String(user.id)) return this.send(chat.id, `<a href="tg://user?id=${user.id}">${h(user.first_name || user.username || 'Гравець')}</a>, для своєї картки скористайся /stats.`);
        try { await this.showStats(chat.id, uid, period, message.message_id); }
        catch (error) { if (!error.message.includes('message is not modified')) throw error; }
        return;
      }
      const match = /^\/(\w+)(?:@(\w+))?(?:\s+([\s\S]+))?\s*$/.exec(message.text ?? '');
      if (!match || (match[2] && match[2].toLowerCase() !== this.username?.toLowerCase())) return;
      const command = match[1].toLowerCase(), arg = match[3]?.trim();
      if (command === 'form') return await this.community.form(message,user);
      if (command === 'taglist') return await this.community.taglist(chat);
      if (command === 'party') return await this.community.party(chat, user, arg);
      if (command === 'compare') return await this.community.compare(message, user, arg);
      if (command === 'tag') return await this.community.changeTag(message, user, arg);
      if (['start', 'help'].includes(command)) return this.send(chat.id, HELP);
      if (command === 'link') {
        const nickname = nicknameFrom(arg);
        const profile = await this.api.faceit('/players', { nickname, game: 'cs2' });
        if (!profile.games?.cs2) throw new Error('Цей профіль не має CS2.');
        const old = this.s.users[user.id]?.playerId;
        if (old && old !== profile.player_id) throw new Error('Спочатку /unlink, потім прив’яжи новий профіль.');
        if (Object.entries(this.s.users).some(([uid, u]) => uid !== String(user.id) && u.playerId === profile.player_id)) throw new Error('Цей FACEIT-профіль уже прив’язаний до іншого учасника.');
        this.s.players[profile.player_id] ??= { id: profile.player_id };
        await this.refresh(profile.player_id);
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
          if (group.customTags) delete group.customTags[user.id];
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
          group.customTags = {};
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
        return this.send(chat.id, `Останнє оновлення: ${p.observedAt ? h(this.time(p.observedAt)) : 'ще не було'}\nЧасовий пояс: ${h(this.zone)}\nТег: ${h(state?.error ?? state?.value ?? 'ще не встановлено')}${this.s.chats[chat.id]?.customTags?.[user.id] ? `\nДо: ${h(this.time(this.s.chats[chat.id].customTags[user.id].expiresAt))}` : ''}\nІнтервал перевірки: ${this.config.interval / 1000} с`);
      }
      if (command === 'stats') return await this.showStats(chat.id, user.id);
      await this.refresh(p.id);
      if (command === 'last') {
        const m = (await this.recent(p))[0];
        if (!m) return this.send(chat.id, 'Завершених матчів не знайдено.');
        await this.details(p, [m]);
        return await this.sendImage(chat.id, 'last', {player:p,match:m}, {caption:`<b>${h(p.nickname)}</b> · Останній матч · ${h(String(m.map??'—').replace(/^de_/,''))}`, fallback:lastMatchCard(p,m,this.zone), reply_markup: { inline_keyboard: [[{ text: 'Відкрити матч ↗', url: m.url }]] } });
      }
      const recent = await this.recent(p), s = summary(recent);
      return this.send(chat.id, `🏅 <b>${h(p.nickname)}</b>\nПоточний рівень: ${p.level}\nСерія перемог: ${s.streak}${s.streak === 20 ? '+' : ''}\nФорма: ${s.form || '—'}`);
    } catch (error) {
      const text = error.service === 'FACEIT' ? `FACEIT тимчасово недоступний або профіль не знайдено (${error.status}). Спробуй пізніше.` : error.message;
      await this.send(chat.id, `⚠️ ${h(text)}`);
    } finally { this.clearMatches(); }
  }
}
