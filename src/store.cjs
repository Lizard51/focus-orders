'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const copy = (x) => structuredClone(x);
const invalid = (m) => {
  throw new Error('INVALID: ' + m);
};
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
function fields(x, allowed, label) {
  if (!object(x)) invalid(label);
  for (const k of Object.keys(x)) if (!allowed.includes(k)) invalid(label + '.' + k);
}
function string(x, label, required = false) {
  if (typeof x !== 'string' || (required && !x.trim())) invalid(label);
  return x;
}
function integer(x, label, min = 0) {
  if (!Number.isSafeInteger(x) || x < min) invalid(label);
}
function identity(x, seen, label) {
  string(x, label, true);
  if (seen.has(x)) invalid('duplicate ' + label);
  seen.add(x);
}
function sections(raw, normalize = false) {
  if (!Array.isArray(raw)) invalid('sections');
  const ids = new Set(),
    itemIds = new Set();
  return raw.map((r) => {
    fields(r, ['id', 'title', 'type', 'items'], 'section');
    const s = copy(r);
    if (normalize && s.id === undefined) s.id = randomUUID();
    identity(s.id, ids, 'section.id');
    string(s.title, 'title');
    if (normalize && /^ВОПРОСЫ/i.test(s.title)) s.type = 'q';
    if (!['items', 'q', 'fields'].includes(s.type)) invalid('section.type');
    if (!Array.isArray(s.items)) invalid('items');
    s.items = s.items.map((r) => {
      fields(r, s.type === 'fields' ? ['id', 'k', 'v'] : ['id', 't', 'd'], 'item');
      const i = copy(r);
      if (normalize && i.id === undefined) i.id = randomUUID();
      identity(i.id, itemIds, 'item.id');
      if (s.type === 'fields') {
        string(i.k, 'k');
        string(i.v, 'v');
      } else {
        string(i.t, 't');
        if (i.d !== 0 && i.d !== 1) invalid('d');
      }
      return i;
    });
    return s;
  });
}
function validate(db) {
  if (object(db) && typeof db.schemaVersion === 'number' && db.schemaVersion > 1)
    throw new Error('SCHEMA_VERSION: newer schema');
  fields(db, ['schemaVersion', 'revision', 'orders', 'templates'], 'snapshot');
  if (db.schemaVersion !== 1) invalid('schemaVersion');
  integer(db.revision, 'revision');
  if (!Array.isArray(db.orders) || !Array.isArray(db.templates) || !db.templates.length)
    invalid('orders/templates');
  const tids = new Set(),
    oids = new Set();
  for (const t of db.templates) {
    fields(t, ['id', 'name', 'version', 'sections'], 'template');
    identity(t.id, tids, 'template.id');
    string(t.name, 'template.name', true);
    integer(t.version, 'version', 1);
    sections(t.sections);
  }
  for (const o of db.orders) {
    fields(
      o,
      [
        'id',
        'number',
        'name',
        'notes',
        'status',
        'version',
        'createdAt',
        'updatedAt',
        'templateId',
        'templateName',
        'sections',
      ],
      'order',
    );
    identity(o.id, oids, 'order.id');
    for (const k of ['number', 'name', 'notes', 'templateId', 'templateName']) string(o[k], k);
    for (const k of ['createdAt', 'updatedAt']) {
      string(o[k], k, true);
      if (!Number.isFinite(Date.parse(o[k]))) invalid(k);
    }
    if (!['active', 'archived'].includes(o.status)) invalid('status');
    integer(o.version, 'version', 1);
    sections(o.sections);
  }
  return copy(db);
}
function parseImport(text) {
  string(text, 'import text');
  if (Buffer.byteLength(text, 'utf8') > 10 * 1024 * 1024) invalid('import exceeds 10MiB');
  let db;
  try {
    db = JSON.parse(text);
  } catch {
    invalid('JSON');
  }
  if (object(db) && Object.hasOwn(db, 'schemaVersion')) return validate(db);
  if (
    !object(db) ||
    !object(db.tpl) ||
    !Array.isArray(db.tpl.sections) ||
    !Array.isArray(db.orders)
  )
    invalid('legacy database');
  const now = new Date().toISOString();
  const t = {
    id: randomUUID(),
    name: db.tpl.name === undefined ? 'Начальный шаблон' : db.tpl.name,
    version: 1,
    sections: sections(db.tpl.sections, true),
  };
  const orders = db.orders.map((o) => {
    if (!object(o)) invalid('legacy order');
    return {
      id: o.id === undefined ? randomUUID() : o.id,
      number: o.num === undefined ? (o.number === undefined ? '' : o.number) : o.num,
      name: o.name === undefined ? '' : o.name,
      notes: o.notes === undefined ? '' : o.notes,
      status: o.status === undefined ? 'active' : o.status,
      version: 1,
      createdAt: o.createdAt === undefined ? now : o.createdAt,
      updatedAt: o.updatedAt === undefined ? now : o.updatedAt,
      templateId: t.id,
      templateName: t.name,
      sections: sections(o.sections, true),
    };
  });
  return validate({ schemaVersion: 1, revision: 0, templates: [t], orders });
}
class Store {
  constructor(directory, fsOps) {
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, 'state.json');
    this.backupDirectory = path.join(this.directory, 'backups');
    this.fs = { ...fs, ...fsOps };
    this.warnings = [];
    this.queue = Promise.resolve();
    this.backupClock = 0;
  }
  static async open({ directory, seed, fsOps = {} }) {
    const s = new Store(directory, fsOps);
    await s.fs.mkdir(s.directory, { recursive: true });
    let text;
    try {
      text = await s.fs.readFile(s.file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (text === undefined) {
      const backups = await s.listBackups();
      let entries;
      try {
        entries = await s.fs.readdir(s.backupDirectory);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        entries = [];
      }
      if (backups.length || entries.some((name) => name.endsWith('.json'))) {
        for (const b of backups) {
          let recovered;
          try {
            recovered = await s.readBackup(b.id);
          } catch {
            continue;
          }
          await s.atomic(s.file, recovered);
          s.state = recovered;
          s.warnings.push('RECOVERY: отсутствующая база восстановлена из ' + b.id);
          break;
        }
        if (!s.state)
          throw new Error('RECOVERY: база отсутствует, пригодных копий нет; новая база не создана');
      } else {
        s.state = validate({
          schemaVersion: 1,
          revision: 0,
          orders: [],
          templates: [
            {
              id: randomUUID(),
              name: 'Начальный шаблон',
              version: 1,
              sections: sections(seed, true),
            },
          ],
        });
        await s.atomic(s.file, s.state);
        await s.backupAfterCommit(s.state);
      }
    } else {
      try {
        s.state = validate(JSON.parse(text));
      } catch (e) {
        if (e.message.startsWith('SCHEMA_VERSION')) throw e;
        for (const b of await s.listBackups()) {
          let recovered;
          try {
            recovered = await s.readBackup(b.id);
          } catch {
            continue;
          }
          await s.atomic(s.file, recovered);
          s.state = recovered;
          s.warnings.push('RECOVERY: повреждённая база восстановлена из ' + b.id);
          break;
        }
        if (!s.state)
          throw new Error(
            'CORRUPT: нет пригодной копии; исходный файл сохранён (' + e.message + ')',
          );
      }
    }
    return s;
  }
  snapshot() {
    return copy(this.state);
  }
  export() {
    return JSON.stringify(this.state, null, 2);
  }
  previewImport(text) {
    return parseImport(text);
  }
  async previewBackup(id) {
    return this.readBackup(id);
  }
  async atomic(file, state) {
    const temp = file + '.' + randomUUID() + '.tmp';
    let handle;
    try {
      handle = await this.fs.open(temp, 'wx');
      await handle.writeFile(JSON.stringify(state, null, 2), 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.fs.rename(temp, file);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await this.fs.unlink(temp).catch(() => {});
    }
  }
  async listBackups() {
    let names;
    try {
      names = await this.fs.readdir(this.backupDirectory);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    const out = [];
    for (const id of names
      .filter((n) => /^\d{16}-[a-f0-9-]+\.json$/.test(n))
      .sort()
      .reverse()) {
      try {
        const stat = await this.fs.stat(path.join(this.backupDirectory, id));
        if (stat.isFile())
          out.push({
            id,
            createdAt: new Date(Number(id.slice(0, 16))).toISOString(),
            size: stat.size,
          });
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    return out;
  }
  async readBackup(id) {
    if (typeof id !== 'string' || !/^\d{16}-[a-f0-9-]+\.json$/.test(id)) invalid('backup id');
    const file = path.join(this.backupDirectory, id),
      stat = await this.fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) invalid('backup file');
    return validate(JSON.parse(await this.fs.readFile(file, 'utf8')));
  }
  async backup(state) {
    await this.fs.mkdir(this.backupDirectory, { recursive: true });
    const old = await this.listBackups();
    this.backupClock = Math.max(
      Date.now(),
      this.backupClock + 1,
      old.length ? Number(old[0].id.slice(0, 16)) + 1 : 0,
    );
    const id = String(this.backupClock).padStart(16, '0') + '-' + randomUUID() + '.json';
    await this.atomic(path.join(this.backupDirectory, id), state);
    for (const b of (await this.listBackups()).slice(30))
      await this.fs.unlink(path.join(this.backupDirectory, b.id));
  }
  async backupAfterCommit(state) {
    try {
      await this.backup(state);
    } catch (e) {
      this.warnings.push('BACKUP: база сохранена, но копия не создана: ' + e.message);
    }
  }
  command(name, payload) {
    let p;
    try {
      p = copy(payload);
    } catch (e) {
      return Promise.reject(e);
    }
    const result = this.queue.then(() => this.execute(name, p));
    this.queue = result.catch(() => {});
    return result;
  }
  async execute(name, p) {
    const allowed = {
      createOrder: ['templateId', 'number', 'name'],
      saveOrder: ['id', 'expectedVersion', 'patch'],
      archiveOrder: ['id'],
      restoreOrder: ['id'],
      deleteOrder: ['id', 'expectedVersion'],
      createTemplate: ['name', 'sections'],
      saveTemplate: ['id', 'expectedVersion', 'patch'],
      deleteTemplate: ['id'],
      importData: ['text'],
      restoreBackup: ['id'],
    };
    if (!Object.hasOwn(allowed, name)) invalid('command');
    fields(p, allowed[name], 'payload');
    let next = this.snapshot();
    const now = new Date().toISOString();
    const find = (xs, id) => {
      string(id, 'id', true);
      const r = xs.find((x) => x.id === id);
      if (!r) throw new Error('NOT_FOUND');
      return r;
    };
    const version = (r) => {
      integer(p.expectedVersion, 'expectedVersion', 1);
      if (p.expectedVersion !== r.version) throw new Error('CONFLICT: версия изменена');
    };
    switch (name) {
      case 'createOrder': {
        const t = find(next.templates, p.templateId);
        string(p.number, 'number');
        string(p.name, 'name');
        next.orders.push({
          id: randomUUID(),
          number: p.number,
          name: p.name,
          notes: '',
          status: 'active',
          version: 1,
          createdAt: now,
          updatedAt: now,
          templateId: t.id,
          templateName: t.name,
          sections: copy(t.sections),
        });
        break;
      }
      case 'saveOrder': {
        const o = find(next.orders, p.id);
        if (o.status === 'archived') throw new Error('ARCHIVED: только чтение');
        version(o);
        fields(p.patch, ['number', 'name', 'notes', 'sections'], 'patch');
        for (const k of Object.keys(p.patch))
          o[k] = k === 'sections' ? sections(p.patch[k]) : string(p.patch[k], k);
        o.version++;
        o.updatedAt = now;
        break;
      }
      case 'archiveOrder':
      case 'restoreOrder': {
        const o = find(next.orders, p.id);
        o.status = name === 'archiveOrder' ? 'archived' : 'active';
        o.version++;
        o.updatedAt = now;
        break;
      }
      case 'deleteOrder': {
        const o = find(next.orders, p.id);
        version(o);
        next.orders = next.orders.filter((order) => order.id !== o.id);
        break;
      }
      case 'createTemplate':
        string(p.name, 'name', true);
        next.templates.push({
          id: randomUUID(),
          name: p.name,
          version: 1,
          sections: sections(p.sections),
        });
        break;
      case 'saveTemplate': {
        const t = find(next.templates, p.id);
        version(t);
        fields(p.patch, ['name', 'sections'], 'patch');
        if (Object.hasOwn(p.patch, 'name')) t.name = string(p.patch.name, 'name', true);
        if (Object.hasOwn(p.patch, 'sections')) t.sections = sections(p.patch.sections);
        t.version++;
        break;
      }
      case 'deleteTemplate':
        find(next.templates, p.id);
        if (next.templates.length === 1) throw new Error('LAST_TEMPLATE');
        next.templates = next.templates.filter((t) => t.id !== p.id);
        break;
      case 'importData':
        next = this.previewImport(p.text);
        break;
      case 'restoreBackup':
        next = await this.readBackup(p.id);
        break;
    }
    next.revision = this.state.revision + 1;
    next = validate(next);
    if (name === 'importData' || name === 'restoreBackup' || name === 'deleteOrder')
      await this.backup(this.state);
    await this.atomic(this.file, next);
    this.state = next;
    await this.backupAfterCommit(next);
    return this.snapshot();
  }
}
module.exports = { Store };
