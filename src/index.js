import { Api } from './api.js';
import { Store } from './store.js';
import { Bot } from './bot.js';
const token = process.env.TELEGRAM_BOT_TOKEN, faceitKey = process.env.FACEIT_API_KEY;
if (!token || !faceitKey) {
  console.error('Заповни TELEGRAM_BOT_TOKEN і FACEIT_API_KEY у локальному .env (див. .env.example).');
  process.exit(1);
}
const interval = Number(process.env.POLL_INTERVAL_SECONDS ?? 60) * 1000;
if (!Number.isFinite(interval) || interval < 60000) throw new Error('POLL_INTERVAL_SECONDS має бути не менше 60.');
const zone = process.env.TIMEZONE || 'Europe/Kyiv';
new Intl.DateTimeFormat('uk-UA', { timeZone: zone });
const store = new Store(process.env.DATA_FILE || './data/state.json');
const api = new Api({ token, faceitKey, analyserKey:process.env.FACEIT_ANALYSER_API_KEY });
const bot = new Bot(api, store, { zone, interval, chatId: process.env.TELEGRAM_CHAT_ID || '' });
let running = true;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { running = false; });
try {
  const me = await api.tg('getMe'); bot.username = me.username;
  const webhook = await api.tg('getWebhookInfo');
  if (webhook.url) throw new Error('Бот уже має webhook. Прибери його перед запуском long polling.');
  await api.tg('setMyCommands', { commands: [
    ['link', 'Прив’язати FACEIT'], ['stats', 'Моя статистика'], ['last', 'Останній матч'],
    ['top', 'Топ чату'], ['summary', 'Підсумок дня'], ['records', 'Рекорди'],
    ['party', 'Зібрати п’ятірку'], ['teams','Поділити 10 гравців на команди'], ['compare', 'Порівняти гравців'], ['tag', 'Тимчасовий тег'],
    ['form', 'Форма за останні 20 матчів'], ['maps','Статистика карт'], ['bestmatch','Найкращі матчі'], ['taglist', 'Активні теги'],
    ['status', 'Стан оновлення'], ['tags', 'Керування тегами'], ['unlink', 'Відв’язати профіль'], ['help', 'Допомога']
  ].map(([command, description]) => ({ command, description })) });
  console.log(`@${me.username} запущено; перевірка кожні ${interval / 1000} с; ${zone}.`);
  // One event loop processes updates and refreshes sequentially: no racing unlink/refresh writes.
  let nextTick = 0;
  while (running) {
    try {
      await bot.community.remindParties();
      await bot.community.expireTags();
      if (Date.now() >= nextTick) { const started = Date.now(); await bot.tick(); nextTick = Math.max(Date.now() + 1000, started + interval); }
      const updates = await api.tg('getUpdates', { offset: store.state.offset, timeout: Math.max(1, Math.min(20, Math.ceil((nextTick - Date.now()) / 1000))), allowed_updates: ['message', 'callback_query'] });
      for (const update of updates) {
        try { await bot.handle(update); }
        catch (error) { console.error(`Update delivery failed (${error.status ?? 'unavailable'})`); }
        store.state.offset = update.update_id + 1; store.save();
      }
    } catch (error) {
      if (error.status === 401 || error.status === 409) throw error;
      console.error(`Polling failed (${error.status ?? 'unavailable'}); retrying.`);
      await new Promise(resolve => setTimeout(resolve, Math.min(60000, Math.max(3000, (error.retryAfter ?? 0) * 1000))));
    }
  }
  store.save();
} catch (error) { console.error(error.message); process.exitCode = 1; }
