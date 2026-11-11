import {loadSamples, formCard, stackMaps, partyClock, nextPartyTime, partyAction} from './insights.js';
import { randomBytes } from 'node:crypto';
import { dayKey, tag, nicknameFrom, escapeHtml as h } from './domain.js';
import { compareCard } from './cards.js';

const mention = user => `<a href="tg://user?id=${user.id}">${h(user.first_name || user.name || 'Гравець')}</a>`;
const present = member => !['left', 'kicked'].includes(member.status) && !(member.status === 'restricted' && member.is_member === false);
export class Community {
  constructor(bot) { this.bot = bot; this.sampleCache = new Map(); }
  async profile(uid) {
    const p = this.bot.player(uid);
    return this.faceitProfile(await this.bot.api.faceit(`/players/${p.id}`));
  }
  faceitProfile(profile) {
    const game = profile.games?.cs2;
    if (!game || !Number.isFinite(game.faceit_elo)) throw new Error('Профіль не має CS2.');
    return {id: profile.player_id, nickname: profile.nickname, elo: game.faceit_elo, level: game.skill_level};
  }
  async compare(message, user, arg) {
    const a = await this.profile(user.id);
    let b;
    if (arg) b = this.faceitProfile(await this.bot.api.faceit('/players', {nickname: nicknameFrom(arg), game: 'cs2'}));
    else {
      const target = message.reply_to_message?.from;
      if (!target || target.is_bot || message.reply_to_message.sender_chat) throw new Error('Відповідай на повідомлення гравця: /compare. Або /compare FACEIT_нік');
      b = await this.profile(target.id);
    }
    if (a.id === b.id) throw new Error('Обери іншого гравця для порівняння.');
    const samples = [];
    for (const p of [a, b]) {
      const matches = await this.bot.recent(p);
      await this.bot.details(p, matches);
      samples.push(matches);
    }
    return this.bot.send(message.chat.id, compareCard(a, b, samples[0], samples[1]));
  }
  async samples(id) {
    const entry=this.sampleCache.get(id);
    if(entry?.until>Date.now())return entry.promise;
    const promise=loadSamples(this.bot.api,id);
    this.sampleCache.set(id,{promise,until:Date.now()+120000});
    while(this.sampleCache.size>100)this.sampleCache.delete(this.sampleCache.keys().next().value);
    try{return await promise;}catch(e){this.sampleCache.delete(id);throw e;}
  }
  async form(message,user) {
    const target=message.reply_to_message?.from ?? user;
    const p=await this.profile(target.id);
    return this.bot.send(message.chat.id, formCard(p,await this.samples(p.id)));
  }
  async taglist(chat,now=Date.now()) {
    const group=this.bot.group(chat), entries=Object.entries(group.customTags ?? {});
    let text='<b>🏷 Активні теги</b>\n';
    if(!entries.length)return this.bot.send(chat.id,text+'Тимчасових тегів немає.');
    const names=new Map();
    const name=async id=>{
      if(!names.has(id)) {
        let label='Гравець';
        try{label=(await this.bot.api.tg('getChatMember',{chat_id:chat.id,user_id:Number(id)})).user?.first_name ?? label;}catch{}
        names.set(id,{id,name:label});
      }
      return mention(names.get(id));
    };
    for(const [uid,t] of entries) {
      const line=`\n${await name(uid)} · <b>${h(t.text)}</b>\n${await name(t.by)} → ${t.expiresAt>now?Math.ceil((t.expiresAt-now)/60000)+' хв':'⌛ відновлюється'}\n`;
      if(text.length+line.length>3500){await this.bot.send(chat.id,text);text='';}
      text+=line;
    }
    return this.bot.send(chat.id,text);
  }
  async partyCard(party) {
    const lines = [`<b>👥 PARTY · ${party.participants.length}/5</b>`, ...(party.text ? [h(party.text)] : []), ''];
    const ratings = [], samples = [];
    for (const [index, member] of party.participants.entries()) {
      let p;
      if (this.bot.s.users[member.id]) {
        try { p = await this.profile(member.id); ratings.push(p.elo); } catch { /* Party remains usable during FACEIT outages. */ }
      }
      lines.push(`${index + 1}. ${mention(member)}${p ? ` · <b>${p.elo} ELO</b>` : ' · ELO —'}`);
    }
    for(const member of party.participants) {
      const id=this.bot.s.users[member.id]?.playerId;
      if(id)try{samples.push(await this.samples(id));}catch{}
    }
    for (let i = party.participants.length; i < 5; i++) lines.push(`${i + 1}. <i>Вільне місце</i>`);
    if (ratings.length) lines.push('', `AVG ELO <b>${Math.round(ratings.reduce((a,b) => a+b, 0) / ratings.length)}</b>${ratings.length < party.participants.length ? ` · дані ${ratings.length}/${party.participants.length}` : ''}`);
    if(party.reserves?.length)lines.push('', '<b>Запасні</b>', party.reserves.map(mention).join(', '));
    lines.push('',stackMaps(samples,party.participants.length));
    if(party.startsAt)lines.push('', `⏰ ${h(this.bot.time(party.startsAt))} · ${h(this.bot.zone)}`, party.reminderMissed ? '<i>Час нагадування минув</i>' : party.remindedAt ? '<i>Нагадування надіслано</i>' : '<i>Нагадування: за 10 хв або в час старту</i>');
    lines.push('', party.participants.length === 5 ? '✅ П’ятірка зібрана!' : 'Натисни «Я граю», щоб приєднатися.');
    return lines.join('\n');
  }
  partyKeyboard(party) {
    const button = (text, action) => ({text, callback_data: `party:${party.id}:${action}`});
    return {inline_keyboard: [[button('🎮 Я граю', 'join'), button('Вийти', 'leave')], [button('Запасний', 'reserve'), button('Закрити', 'close')]]};
  }
  async renderParty(chat, party) {
    const text = await this.partyCard(party), reply_markup = this.partyKeyboard(party);
    if (party.messageId) {
      try {
        await this.bot.api.tg('editMessageText', {chat_id: chat.id, message_id: party.messageId, text, parse_mode: 'HTML', reply_markup});
        return;
      } catch (error) {
        if (error.message.includes('message is not modified')) return;
        if (!/message to edit not found|message can't be edited/i.test(error.message)) throw error;
      }
    }
    const result = await this.bot.send(chat.id, text, {reply_markup});
    party.messageId = result.message_id;
    this.bot.store.save();
  }
  async party(chat, user, text) {
    const group = this.bot.group(chat);
    if (text) {
      if (text.length > 200) throw new Error('Текст party — до 200 символів.');
      if (group.party && group.party.owner !== String(user.id)) await this.bot.admin(chat, user.id);
    }
    group.party ??= {id: randomBytes(8).toString('hex'), owner: String(user.id), participants: [{id: String(user.id), name: (user.first_name || 'Гравець').slice(0, 64)}]};
    if(text) {
      const party=group.party;
      if(!party.startsAt || partyClock(text)!==partyClock(party.text)) {
        party.startsAt=nextPartyTime(text,this.bot.zone);
        party.remindAt=party.startsAt ? (party.startsAt-Date.now()>600000 ? party.startsAt-600000 : party.startsAt) : null;
        delete party.remindedAt; delete party.reminderRetryAt; delete party.reminderMissed;
      }
      party.text=text;
    }
    this.bot.store.save();
    await this.renderParty(chat, group.party);
  }
  async partyCallback(callback, chat, user) {
    const [, id, action] = /^party:([a-f0-9]+):(join|leave|reserve|close)$/.exec(callback.data ?? '') ?? [];
    const party = this.bot.group(chat).party;
    const answer = (text, alert = false) => this.bot.api.tg('answerCallbackQuery', {callback_query_id: callback.id, text, show_alert: alert});
    if (!id || !party || party.id !== id || party.messageId !== callback.message.message_id) return answer('Цей збір уже неактивний. Напиши /party.', true);
    const membership = await this.bot.api.tg('getChatMember', {chat_id: chat.id, user_id: user.id});
    if (!present(membership)) return answer('Треба бути учасником групи.', true);
    if (action === 'close') {
      if (party.owner !== String(user.id) && !['administrator','creator'].includes(membership.status)) return answer('Закрити може автор збору або адміністратор.', true);
      delete this.bot.group(chat).party;
      this.bot.store.save();
      await answer('Збір закрито');
      await this.bot.api.tg('editMessageText', {chat_id: chat.id, message_id: party.messageId, text: '👥 Збір закрито. Новий — /party', reply_markup: {inline_keyboard: []}});
      return;
    }
    const problem=partyAction(party,user,action);
    if(problem)return answer(problem,true);
    this.bot.store.save();
    await answer(action === 'join' ? 'Ти в грі!' : action === 'reserve' ? 'Ти запасний' : 'Ти вийшов зі збору');
    await this.renderParty(chat, party);
  }
  async remindParties(now=Date.now()) {
    for(const [id,group] of Object.entries(this.bot.s.chats)) {
      if(this.bot.config.chatId && id!==this.bot.config.chatId)continue;
      const p=group.party;
      if(!p?.startsAt || !p.remindAt || p.remindedAt || now<p.remindAt || now<(p.reminderRetryAt??0))continue;
      if(now>p.startsAt+300000){p.remindedAt=now;p.reminderMissed=true;this.bot.store.save();continue;}
      const players=[...p.participants,...(p.reserves??[])];
      const left=Math.max(0,Math.ceil((p.startsAt-now)/60000));
      try {
        await this.bot.send(id,`⏰ <b>PARTY ${left?'через '+left+' хв':'починається'}</b>\n${h(p.text??'')}\n\n${players.map(mention).join(' ')}`);
        p.remindedAt=now; delete p.reminderRetryAt; delete p.reminderMissed;
      }catch{p.reminderRetryAt=now+60000;}
      this.bot.store.save();
    }
  }
  async changeTag(message, user, arg) {
    const chat = message.chat, group = this.bot.group(chat);
    if (!group.tags) throw new Error('Теги вимкнено адміністратором: /tags on');
    const [, rawMinutes, rawText] = /^(\d+)\s+(.+)$/u.exec(arg ?? '') ?? [];
    const minutes = Number(rawMinutes), text = rawText?.trim();
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new Error('Відповідай гравцю: /tag 5 новий тег. Тривалість: 1–60 хв.');
    if (!text || text.length > 16 || /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Cc}\p{Cf}\u20e3]/u.test(text)) throw new Error('Тег: 1–16 символів, без emoji та прихованих символів.');
    const reply = message.reply_to_message;
    const target = reply ? reply.from : user;
    if (!target || target.is_bot || reply?.sender_chat) throw new Error('Обери повідомлення гравця, а не бота чи каналу.');
    const member = await this.bot.api.tg('getChatMember', {chat_id: chat.id, user_id: target.id});
    if (!present(member)) throw new Error('Гравець уже не в цьому чаті.');
    group.customTags ??= {};
    const previous = group.customTags[target.id];
    const override = {text, by: String(user.id), expiresAt: Date.now() + minutes * 60000,
      restoreText: previous?.restoreText ?? member.tag ?? member.custom_title ?? ''};
    // Persist the expiry before writing to Telegram so a restart cannot leave a permanent tag.
    group.customTags[target.id] = override;
    this.bot.store.save();
    try {
      if (await this.bot.setTag(chat.id, target.id, text) === 'left') throw new Error('Гравець уже не в цьому чаті.');
    } catch (error) {
      if (previous) group.customTags[target.id] = previous; else delete group.customTags[target.id];
      this.bot.store.save(); throw error;
    }
    group.tagState[target.id] = {value: text, retryAt: 0, error: null};
    this.bot.store.save();
    return this.bot.send(chat.id, `🏷 ${mention(user)} → ${mention(target)}\n<b>${h(text)}</b> · ${minutes} хв`);
  }
  async expireTags(now = Date.now()) {
    for (const [chatId, group] of Object.entries(this.bot.s.chats)) {
      if (this.bot.config.chatId && chatId !== this.bot.config.chatId) continue;
      for (const [uid, override] of Object.entries(group.customTags ?? {})) {
        if (override.expiresAt > now || (override.retryAt ?? 0) > now) continue;
        let text = override.restoreText;
        if (group.tags && this.bot.s.users[uid]) {
          try {
            const p = await this.bot.refresh(this.bot.player(uid).id);
            text = tag(p, dayKey(now, this.bot.zone), this.bot.zone);
          } catch { /* Restore previous text during FACEIT outages, then normal tick updates it. */ }
        }
        try {
          const result = await this.bot.setTag(chatId, uid, text);
          delete group.customTags[uid];
          if (result === 'left') delete group.tagState[uid];
          else group.tagState[uid] = {value: text, retryAt: 0, error: null};
        } catch (error) {
          override.retryAt = now + 60000;
          group.tagState[uid] = {...group.tagState[uid], error: error.message};
        }
        this.bot.store.save();
      }
    }
  }
}
