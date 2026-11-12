import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
export class Store {
  constructor(path) {
    this.path = path;
    try { this.state = JSON.parse(readFileSync(path, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error; // Never overwrite damaged data.
      this.state = { version: 1, offset: 0, users: {}, players: {}, chats: {} };
    }
    if (![1, 2, 3, 4, 5, 6].includes(this.state.version)) throw new Error('Unsupported data version');
    this.state = this.persistentState();
    // Migrate on startup, removing previously persisted FACEIT history immediately.
    this.save();
  }
  persistentState() {
    return {
      version: 6,
      offset: this.state.offset,
      users: Object.fromEntries(Object.entries(this.state.users).map(([id, u]) => [id, { playerId: u.playerId }])),
      players: Object.fromEntries(Object.values(this.state.users).map(u => [u.playerId, { id: u.playerId }])),
      chats: Object.fromEntries(Object.entries(this.state.chats).map(([id, c]) => [id, {
        members: c.members, tags: c.tags,
        party: c.party ? {id: c.party.id, owner: c.party.owner, text: c.party.text, startsAt: c.party.startsAt, remindAt: c.party.remindAt, remindedAt: c.party.remindedAt, reminderRetryAt: c.party.reminderRetryAt, reminderMissed: c.party.reminderMissed,
          reserves: (c.party.reserves??[]).map(p=>({id:p.id,name:p.name})), messageId: c.party.messageId,
          participants: c.party.participants.map(p => ({id: p.id, name: p.name}))} : undefined,
        customTags: Object.fromEntries(Object.entries(c.customTags ?? {}).map(([uid, t]) => [uid, {
          text: t.text, by: t.by, expiresAt: t.expiresAt, restoreText: t.restoreText, retryAt: t.retryAt
        }])),
        tagState: Object.fromEntries(Object.entries(c.tagState ?? {}).map(([uid, t]) => [uid, {
          value: t.value, error: t.error, retryAt: t.retryAt
        }]))
      }]))
    };
  }
  save() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.persistentState()), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }
}
