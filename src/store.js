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
    if (this.state.version !== 1) throw new Error('Unsupported data version');
  }
  save() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.state), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }
}
