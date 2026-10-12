'use strict';
(() => {
  const api = window.focusAPI,
    app = document.getElementById('app'),
    dialog = document.getElementById('dialog');
  const clone = (x) => JSON.parse(JSON.stringify(x)),
    esc = (x) =>
      String(x ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );
  const uid = () => crypto.randomUUID();
  const icon = (n) =>
    `<svg class="ico" aria-hidden="true"><use href="assets/icons.svg#${n}"></use></svg>`;
  const button = (action, text, ico = '', cls = '', attrs = '') =>
    `<button type="button" data-action="${action}" class="${cls}" ${attrs}>${ico ? icon(ico) : ''}${text}</button>`;
  let snapshot = { orders: [], templates: [] },
    warnings = [],
    dataPath = '',
    tabs = [],
    current = null,
    area = 'active',
    view = 'items',
    selectedTemplate = null,
    backups = [],
    backupLoaded = false,
    message = '',
    error = '',
    timer,
    chain = Promise.resolve(),
    dialogReturn;
  const drafts = new Map();
  const record = (kind, id) =>
    snapshot[kind === 'order' ? 'orders' : 'templates'].find((x) => x.id === id);
  function draft(kind, id) {
    const key = kind + ':' + id;
    if (!drafts.has(key)) {
      const item = record(kind, id);
      if (!item) return null;
      drafts.set(key, { kind, id, value: clone(item), edit: 0, saved: 0, busy: false, error: '' });
    }
    return drafts.get(key);
  }
  const activeDraft = () =>
    current?.kind === 'order'
      ? draft('order', current.id)
      : current?.kind === 'templates' && selectedTemplate
        ? draft('template', selectedTemplate)
        : null;
  function dirty(d) {
    return d.edit > d.saved;
  }
  function touch(d) {
    d.edit++;
    d.error = '';
    error = '';
    message = '';
    updateStatus();
    clearTimeout(timer);
    timer = setTimeout(() => saveAll(), 250);
  }
  function updateStatus() {
    const el = document.getElementById('save-status');
    if (!el) return;
    const failed = [...drafts.values()].find((d) => d.error),
      busy = [...drafts.values()].some((d) => d.busy),
      pending = [...drafts.values()].some((d) => dirty(d));
    const text =
      error ||
      failed?.error ||
      (busy
        ? 'Сохраняем…'
        : pending
          ? 'Есть несохранённые изменения'
          : message || 'Все изменения сохранены');
    el.classList.toggle('error', !!(error || failed));
    el.innerHTML = `${icon(error || failed ? 'alert-triangle' : 'check')}<span role="status" aria-live="polite">${esc(text)}</span>${failed ? button('retry', 'Повторить сохранение') : ''}<span class="path" title="${esc(dataPath)}">${esc(dataPath)}</span>`;
  }
  function accept(next) {
    snapshot = next;
    for (const d of drafts.values()) {
      const fresh = record(d.kind, d.id);
      if (fresh) {
        d.value.version = fresh.version;
        if (!dirty(d) && !d.busy) d.value = clone(fresh);
      } else if (!dirty(d)) drafts.delete(d.kind + ':' + d.id);
    }
  }
  async function saveDraft(d) {
    if (!dirty(d)) return true;
    d.busy = true;
    updateStatus();
    try {
      while (dirty(d)) {
        const edit = d.edit;
        const v = clone(d.value);
        const patch =
          d.kind === 'order'
            ? { number: v.number, name: v.name, notes: v.notes, sections: v.sections }
            : { name: v.name, sections: v.sections };
        const result = await api.command(d.kind === 'order' ? 'saveOrder' : 'saveTemplate', {
          id: d.id,
          expectedVersion: v.version,
          patch,
        });
        if (!result.ok) throw new Error(errorText(result.error));
        d.saved = edit;
        accept(result.snapshot);
        warnings = result.warnings || warnings;
        d.error = '';
      }
      return true;
    } catch (e) {
      d.error = 'Не удалось сохранить: ' + errorText(e) + '. Ввод сохранён в этом окне.';
      return false;
    } finally {
      d.busy = false;
      updateStatus();
    }
  }
  function errorText(e) {
    return typeof e === 'string' ? e : e?.message || e?.code || 'неизвестная ошибка';
  }
  function saveAll() {
    chain = chain
      .catch(() => false)
      .then(async () => {
        for (const d of drafts.values()) {
          if (!(await saveDraft(d))) return false;
        }
        return true;
      });
    return chain;
  }
  window.focusFlush = async () => {
    clearTimeout(timer);
    return saveAll();
  };
  async function safe(action) {
    if (await window.focusFlush()) await action();
    else updateStatus();
  }
  async function command(name, payload) {
    const r = await api.command(name, payload);
    if (!r.ok) throw new Error(errorText(r.error));
    accept(r.snapshot);
    warnings = r.warnings || warnings;
    return r;
  }
  function progress(o) {
    const rows = o.sections.filter((s) => s.type === 'items').flatMap((s) => s.items);
    return { total: rows.length, done: rows.filter((r) => r.d).length };
  }
  function orderTitle(o) {
    return o.number ? 'Заказ № ' + o.number : o.name || 'Новый заказ';
  }
  function open(kind, id) {
    current = { kind, id };
    if (!tabs.some((t) => t.kind === kind && t.id === id)) tabs.push(current);
    if (kind === 'order') area = record(kind, id)?.status === 'archived' ? 'archive' : 'active';
    render();
  }
  function sidebar() {
    const orders = snapshot.orders.filter(
      (o) => o.status === (area === 'archive' ? 'archived' : 'active'),
    );
    return `<aside class="sidebar"><div class="brand">${icon('checklist')}<div>Фокус<small>Мои заказы</small></div></div>${button('new-order', 'Новый заказ', 'plus', 'primary')}<nav class="nav" aria-label="Список заказов">${['active', 'archive'].map((a) => `<button data-action="area" data-id="${a}" class="${area === a ? 'active' : ''}" aria-pressed="${area === a}">${icon(a === 'active' ? 'checklist' : 'archive')}${a === 'active' ? 'Активные' : 'Архив'}<span class="count">${snapshot.orders.filter((o) => o.status === (a === 'active' ? 'active' : 'archived')).length}</span></button>`).join('')}</nav><div><p class="side-label">${area === 'archive' ? 'Завершённые заказы' : 'В работе'}</p><div class="orders">${
      orders
        .map((o) => {
          const p = progress(drafts.get('order:' + o.id)?.value || o);
          return `<button class="order ${current?.id === o.id ? 'active' : ''}" data-action="open-order" data-id="${esc(o.id)}" aria-pressed="${current?.id === o.id}"><strong>${esc(orderTitle(o))}</strong><small>${esc(o.name || 'Без названия')}</small><progress value="${p.done}" max="${p.total || 1}" aria-label="Выполнено ${p.done} из ${p.total}"></progress></button>`;
        })
        .join('') || '<p class="side-label">Пока нет заказов</p>'
    }</div></div><div class="sidefooter">${button('templates', 'Шаблоны заказов', 'layout-template')}${button('backups', 'Резервные копии', 'database')}${button('folder', 'Папка данных', 'folder')}</div></aside>`;
  }
  function tabbar() {
    return `<nav class="tabs" aria-label="Открытые вкладки">${tabs.map((t) => `<div class="tab ${current?.kind === t.kind && current?.id === t.id ? 'active' : ''}"><button data-action="tab" data-kind="${t.kind}" data-id="${esc(t.id || '')}">${esc(t.kind === 'order' ? orderTitle(record('order', t.id) || { name: 'Заказ' }) : t.kind === 'templates' ? 'Шаблоны' : 'Резервные копии')}</button><button class="icon" data-action="close-tab" data-kind="${t.kind}" data-id="${esc(t.id || '')}" aria-label="Закрыть вкладку">${icon('x')}</button></div>`).join('')}</nav>`;
  }
  function sectionNav() {
    return `<nav class="sectionnav" aria-label="Разделы ${current?.kind === 'templates' ? 'шаблона' : 'заказа'}">${[
      ['items', 'Проверка'],
      ['fields', 'Параметры'],
      ['q', 'Вопросы'],
      ['notes', 'Заметки'],
    ]
      .filter(([v]) => current?.kind !== 'templates' || v !== 'notes')
      .map(
        ([v, label]) =>
          `<button data-action="view" data-id="${v}" class="${view === v ? 'active' : ''}" aria-pressed="${view === v}">${label}</button>`,
      )
      .join('')}</nav>`;
  }
  function sections(d, readonly) {
    const v = d.value;
    return (
      v.sections
        .filter((s) => s.type === view)
        .map(
          (s) =>
            `<section class="section" data-section="${esc(s.id)}"><header class="sectionhead"><h2>${esc(s.title || 'Без названия')}</h2><div class="actions">${!readonly ? button('rename-section', '', 'edit', 'icon', `data-id="${esc(s.id)}" aria-label="Изменить название раздела"`) + button('delete-section', '', 'trash', 'icon', `data-id="${esc(s.id)}" aria-label="Удалить раздел"`) : ''}</div></header><div class="sectionbody">${s.items.map((r, i) => (s.type === 'fields' ? `<div class="row fieldrow"><input data-field="k" data-section="${esc(s.id)}" data-row="${esc(r.id)}" value="${esc(r.k)}" aria-label="Название параметра ${i + 1}" ${readonly ? 'disabled' : ''}><input data-field="v" data-section="${esc(s.id)}" data-row="${esc(r.id)}" value="${esc(r.v)}" aria-label="Значение параметра ${i + 1}" ${readonly ? 'disabled' : ''}>${!readonly ? button('delete-row', '', 'trash', 'icon', `data-section="${esc(s.id)}" data-id="${esc(r.id)}" aria-label="Удалить параметр ${i + 1}"`) : ''}</div>` : `<div class="row ${r.d ? 'done' : ''}"><input type="checkbox" data-field="d" data-section="${esc(s.id)}" data-row="${esc(r.id)}" ${r.d ? 'checked' : ''} ${readonly ? 'disabled' : ''} aria-label="${s.type === 'q' ? 'Вопрос решён' : 'Пункт выполнен'} ${i + 1}"><textarea class="text" data-field="t" data-section="${esc(s.id)}" data-row="${esc(r.id)}" aria-label="${s.type === 'q' ? 'Вопрос' : 'Пункт проверки'} ${i + 1}" rows="${Math.max(1, Math.min(6, String(r.t).split('\n').length))}" ${readonly ? 'disabled' : ''}>${esc(r.t)}</textarea>${!readonly ? button('delete-row', '', 'trash', 'icon', `data-section="${esc(s.id)}" data-id="${esc(r.id)}" aria-label="Удалить ${s.type === 'q' ? 'вопрос' : 'пункт'} ${i + 1}"`) : ''}</div>`)).join('') || '<p class="side-label">В разделе пока нет записей</p>'}${!readonly ? button('add-row', s.type === 'fields' ? 'Добавить параметр' : s.type === 'q' ? 'Добавить вопрос' : 'Добавить пункт', 'plus', 'addrow', `data-id="${esc(s.id)}"`) : ''}</div></section>`,
        )
        .join('') ||
      `<div class="empty"><h2>В этом виде пока нет разделов</h2><p>${readonly ? 'Заказ доступен для просмотра.' : 'Добавьте раздел, затем свои пункты.'}</p></div>`
    );
  }
  function editor(d, readonly) {
    return `${sectionNav()}${view === 'notes' ? `<section class="section"><div class="sectionhead"><h2>Мои заметки</h2></div><textarea class="notes" data-field="notes" aria-label="Заметки к заказу" placeholder="Записи по этому заказу…" ${readonly ? 'disabled' : ''}>${esc(d.value.notes)}</textarea></section>` : sections(d, readonly)}${view !== 'notes' ? `<div class="actions">${!readonly ? button('add-section', 'Добавить раздел', 'plus') : ''}${view === 'q' && current.kind === 'order' ? button('copy', 'Копировать нерешённые вопросы', 'copy') : ''}</div>` : ''}`;
  }
  function updateMetrics(d) {
    if (d.kind !== 'order') return;
    const p = progress(d.value),
      q = d.value.sections
        .filter((s) => s.type === 'q')
        .flatMap((s) => s.items)
        .filter((r) => !r.d).length;
    const summary = app.querySelector('.summary');
    if (summary) {
      summary.querySelector('strong').textContent = p.done + ' из ' + p.total;
      summary.querySelector('progress').value = p.done;
      summary.querySelector('progress').max = p.total || 1;
      summary.lastElementChild.textContent = q + ' нерешённых вопросов';
    }
    const side = app.querySelector('.order[data-id=' + CSS.escape(d.id) + '] progress');
    if (side) {
      side.value = p.done;
      side.max = p.total || 1;
      side.setAttribute('aria-label', 'Выполнено ' + p.done + ' из ' + p.total);
    }
  }
  function orderView() {
    const d = activeDraft();
    if (!d) return empty();
    const o = d.value,
      p = progress(o),
      ro = o.status === 'archived',
      q = o.sections
        .filter((s) => s.type === 'q')
        .flatMap((s) => s.items)
        .filter((r) => !r.d).length;
    return `<header class="header"><div><h1>${esc(orderTitle(o))}</h1><p>${esc(o.name || 'Название не задано')} · ${ro ? 'Архив · только просмотр' : 'Активный заказ'}</p></div><div class="actions">${!ro ? button('rename-order', 'Номер и название', 'edit') : ''}${button(ro ? 'restore' : 'archive', ro ? 'Вернуть в работу' : 'Завершить заказ', ro ? 'restore' : 'check', 'primary')}${button('delete-order', 'Удалить заказ', 'trash', 'danger')}</div></header>${ro ? '<div class="notice">Этот заказ завершён. Чтобы изменить его, верните заказ в работу.</div>' : ''}<div class="summary"><div><strong>${p.done} из ${p.total}</strong><br><small>пунктов проверено</small></div><progress value="${p.done}" max="${p.total || 1}" aria-label="Прогресс проверки"></progress><small>${q} нерешённых вопросов</small></div>${editor(d, ro)}`;
  }
  function templateView() {
    if (!snapshot.templates.some((t) => t.id === selectedTemplate))
      selectedTemplate = snapshot.templates[0]?.id;
    const d = activeDraft();
    if (view === 'notes') view = 'items';
    return `<header class="header"><div><h1>Шаблоны заказов</h1><p>Изменения применяются только к будущим заказам</p></div>${button('new-template', 'Новый шаблон', 'plus', 'primary')}</header><div class="templatepick"><label class="formlabel">Шаблон<select id="template-select">${snapshot.templates.map((t) => `<option value="${esc(t.id)}" ${t.id === selectedTemplate ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>${button('rename-template', 'Переименовать', 'edit')}${button('delete-template', 'Удалить', 'trash', 'danger', snapshot.templates.length <= 1 ? 'disabled title="Последний шаблон удалить нельзя"' : '')}</div>${d ? editor(d, false) : ''}`;
  }
  function backupView() {
    return `<header class="header"><div><h1>Резервные копии</h1><p>Все заказы и шаблоны в одной базе</p></div>${button('refresh-backups', 'Обновить список', 'restore')}</header><section class="tool-panel"><h2>Сохранить базу в файл</h2><p>Выберите отдельный диск или папку. Автоматические копии на этом компьютере не защищают от потери диска.</p>${button('export', 'Экспортировать базу', 'download')}</section><section class="tool-panel"><h2>Перенести данные</h2><p>Откройте файл базы или вставьте старые «Данные». Сначала покажем предпросмотр; замена потребует подтверждения.</p>${button('import-file', 'Открыть файл', 'upload')}<textarea id="import-text" class="importtext" aria-label="JSON для импорта" placeholder="Вставьте JSON из «Данных»"></textarea>${button('preview-import', 'Предпросмотр импорта', 'upload')}</section><section class="tool-panel"><h2>Автоматические снимки</h2><p>Последние подтверждённые состояния базы.</p>${!backupLoaded ? '<p class="loading">Загружаем список…</p>' : backups.length ? backups.map((b) => `<div class="backuprow"><div>${esc(new Date(b.createdAt).toLocaleString('ru-RU'))}<small>${esc(Math.ceil(b.size / 1024))} КБ</small></div>${button('restore-backup', 'Восстановить', 'restore', '', `data-id="${esc(b.id)}"`)}</div>`).join('') : '<p>Снимки появятся после сохранения изменений.</p>'}</section>`;
  }
  function empty() {
    return `<div class="empty"><h1>${area === 'archive' ? 'Архив заказов' : 'Всё готово к работе'}</h1><p>${area === 'archive' ? 'Выберите завершённый заказ слева.' : 'Создайте первый заказ по своему шаблону.<br>Все изменения сохраняются на этом компьютере.'}</p>${area === 'active' ? button('new-order', 'Создать заказ', 'plus', 'primary') : ''}</div>`;
  }
  function fitRows() {
    for (const field of app.querySelectorAll('.row textarea.text')) {
      field.style.height = 'auto';
      field.style.height = field.scrollHeight + 2 + 'px';
    }
  }
  function render() {
    const focused = document.activeElement;
    const previous =
      app.contains(focused) && focused.dataset.action ? { ...focused.dataset } : null;
    app.innerHTML = `<div class="shell">${sidebar()}<main class="main">${tabbar()}<div class="workspace"><div class="content">${warnings.length ? `<div class="notice error" role="alert">${warnings.map((w) => esc(errorText(w))).join('<br>')}</div>` : ''}${current?.kind === 'order' ? orderView() : current?.kind === 'templates' ? templateView() : current?.kind === 'backups' ? backupView() : empty()}</div></div><footer id="save-status" class="statusbar"></footer></main></div>`;
    updateStatus();
    fitRows();
    if (previous) {
      const next = [...app.querySelectorAll('[data-action]')].find((el) =>
        Object.entries(previous).every(([key, value]) => el.dataset[key] === value),
      );
      (
        next || app.querySelector('.tab.active button,.sectionnav button.active,.sidebar button')
      )?.focus({ preventScroll: true });
    }
  }
  window.addEventListener('resize', () => requestAnimationFrame(fitRows));
  document.fonts.ready.then(fitRows);
  function modal(title, fields, submitLabel, onSubmit, description = '') {
    dialogReturn = document.activeElement;
    dialog.innerHTML = `<h2 id="dialog-title">${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ''}<form>${fields}<p class="error" role="alert"></p><div class="actions"><button type="button" data-cancel>Отмена</button><button type="submit" class="primary">${esc(submitLabel)}</button></div></form>`;
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    dialog.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const submit = e.submitter;
      submit.disabled = true;
      try {
        await onSubmit(new FormData(e.target));
        dialog.close();
        render();
      } catch (ex) {
        dialog.querySelector('.error').textContent = errorText(ex);
        submit.disabled = false;
      }
    };
    dialog.showModal();
    dialog.querySelector('input,textarea,select,button')?.focus();
  }
  function field(label, name, value = '') {
    return `<label class="formlabel">${label}<input name="${name}" value="${esc(value)}" ${name === 'name' ? 'required' : ''}></label>`;
  }
  function confirm(title, description, action, submitLabel = 'Подтвердить') {
    modal(title, '', submitLabel, action, description);
  }
  dialog.addEventListener('close', () => {
    if (dialogReturn?.isConnected) dialogReturn.focus();
    else document.querySelector('.workspace button,.sidebar button')?.focus();
  });
  async function loadBackups() {
    backupLoaded = false;
    render();
    try {
      backups = await api.listBackups();
      backupLoaded = true;
      render();
    } catch (e) {
      backupLoaded = true;
      error = 'Не удалось открыть копии: ' + errorText(e);
      render();
    }
  }
  async function previewImport(text) {
    const r = await api.previewImport(text);
    if (r.error) throw new Error(errorText(r.error));
    replacePreview(r.snapshot, () => command('importData', { text }), 'Импорт данных');
  }
  function replacePreview(s, action, title) {
    confirm(
      title,
      `В файле: ${s.orders.length} заказов и ${s.templates.length} шаблонов.\nВ текущей базе: ${snapshot.orders.length} заказов и ${snapshot.templates.length} шаблонов.\nВся текущая база будет заменена. Перед заменой сохранится резервная копия.`,
      async () => {
        await action();
        drafts.clear();
        tabs = [];
        current = null;
        backupLoaded = false;
        message = 'База восстановлена';
      },
    );
  }
  app.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset.field) return;
    const d = activeDraft();
    if (!d || d.value.status === 'archived') return;
    const f = el.dataset.field;
    if (el.dataset.row) {
      const r = d.value.sections
        .find((s) => s.id === el.dataset.section)
        ?.items.find((r) => r.id === el.dataset.row);
      if (!r) return;
      r[f] = f === 'd' ? (el.checked ? 1 : 0) : el.value;
      if (f === 'd') el.closest('.row').classList.toggle('done', el.checked);
      if (f === 't') fitRows();
    } else d.value[f] = el.value;
    touch(d);
    updateMetrics(d);
  });
  app.addEventListener('change', (e) => {
    if (e.target.id === 'template-select') {
      const next = e.target.value;
      safe(() => {
        selectedTemplate = next;
        render();
      }).then(() => {
        if (selectedTemplate !== next) e.target.value = selectedTemplate;
      });
    }
  });
  app.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    const a = b.dataset.action,
      id = b.dataset.id;
    try {
      error = '';
      if (a === 'retry') {
        if (await window.focusFlush()) {
          message = 'Изменения сохранены';
          updateStatus();
        }
        return;
      }
      if (a === 'folder') {
        await api.openDataFolder();
        return;
      }
      if (a === 'copy') {
        const qs = activeDraft()
          .value.sections.filter((s) => s.type === 'q')
          .flatMap((s) => s.items)
          .filter((r) => !r.d && r.t.trim());
        await api.copyText(qs.map((q, i) => `${i + 1}. ${q.t}`).join('\n'));
        message = qs.length ? 'Вопросы скопированы' : 'Нет нерешённых вопросов для копирования';
        updateStatus();
        return;
      }
      await safe(async () => {
        const d = activeDraft(),
          ro = d?.value.status === 'archived';
        if (a === 'area') {
          area = id;
          current = null;
          render();
        } else if (a === 'open-order') open('order', id);
        else if (a === 'tab') open(b.dataset.kind, id || undefined);
        else if (a === 'close-tab') {
          tabs = tabs.filter((t) => !(t.kind === b.dataset.kind && (t.id || '') === id));
          if (current?.kind === b.dataset.kind && (current.id || '') === id)
            current = tabs.at(-1) || null;
          render();
        } else if (a === 'templates') {
          open('templates');
        } else if (a === 'backups') {
          open('backups');
          await loadBackups();
        } else if (a === 'view') {
          view = id;
          render();
        } else if (a === 'new-order') {
          modal(
            'Новый заказ',
            field('Номер заказа', 'number') +
              field('Название', 'name') +
              `<label class="formlabel">Шаблон<select name="templateId">${snapshot.templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label>`,
            'Создать заказ',
            async (f) => {
              const before = new Set(snapshot.orders.map((o) => o.id));
              await command('createOrder', {
                templateId: f.get('templateId'),
                number: f.get('number'),
                name: f.get('name'),
              });
              open('order', snapshot.orders.find((o) => !before.has(o.id)).id);
              view = 'items';
            },
          );
        } else if (a === 'rename-order' && !ro) {
          modal(
            'Номер и название',
            field('Номер заказа', 'number', d.value.number) +
              field('Название', 'name', d.value.name),
            'Сохранить',
            async (f) => {
              d.value.number = f.get('number');
              d.value.name = f.get('name');
              touch(d);
              if (!(await window.focusFlush())) throw new Error(d.error);
            },
          );
        } else if (a === 'archive' || a === 'restore') {
          confirm(
            a === 'archive' ? 'Завершить заказ?' : 'Вернуть заказ в работу?',
            a === 'archive'
              ? 'Все данные сохранятся. В архиве заказ будет доступен только для просмотра.'
              : 'Снова станут доступны редактирование и проверка.',
            async () => {
              await command(a === 'archive' ? 'archiveOrder' : 'restoreOrder', { id: d.id });
              area = a === 'archive' ? 'archive' : 'active';
            },
          );
        } else if (a === 'delete-order') {
          const deletingId = d.id;
          confirm(
            'Удалить заказ?',
            `${orderTitle(d.value)} — ${d.value.name}\nЗаказ будет удалён из текущей базы. Перед удалением сохранится резервная копия. Восстановить данные можно через восстановление всей базы из этой копии.`,
            async () => {
              await command('deleteOrder', { id: deletingId, expectedVersion: d.value.version });
              drafts.delete('order:' + deletingId);
              tabs = tabs.filter((tab) => tab.kind !== 'order' || tab.id !== deletingId);
              current = tabs.at(-1) || null;
              if (current?.kind === 'order')
                area = record('order', current.id)?.status === 'archived' ? 'archive' : 'active';
              message = 'Заказ удалён';
              backupLoaded = false;
            },
            'Удалить заказ',
          );
          dialog.querySelector('button[type=submit]').classList.replace('primary', 'danger');
        } else if (a === 'new-template') {
          modal('Новый шаблон', field('Название шаблона', 'name'), 'Создать', async (f) => {
            const before = new Set(snapshot.templates.map((t) => t.id));
            await command('createTemplate', { name: f.get('name'), sections: [] });
            selectedTemplate = snapshot.templates.find((t) => !before.has(t.id)).id;
            view = 'items';
          });
        } else if (a === 'rename-template') {
          modal(
            'Название шаблона',
            field('Название', 'name', d.value.name),
            'Сохранить',
            async (f) => {
              d.value.name = f.get('name');
              touch(d);
              if (!(await window.focusFlush())) throw new Error(d.error);
            },
          );
        } else if (a === 'delete-template') {
          confirm(
            'Удалить шаблон?',
            `Шаблон «${d.value.name}» будет удалён. Уже созданные заказы сохранятся.`,
            async () => {
              await command('deleteTemplate', { id: d.id });
              selectedTemplate = null;
            },
          );
        } else if (a === 'add-section' && !ro) {
          modal('Новый раздел', field('Название раздела', 'name'), 'Добавить', async (f) => {
            d.value.sections.push({ id: uid(), title: f.get('name'), type: view, items: [] });
            touch(d);
          });
        } else if (a === 'rename-section' && !ro) {
          const s = d.value.sections.find((s) => s.id === id);
          modal('Название раздела', field('Название', 'name', s.title), 'Сохранить', async (f) => {
            s.title = f.get('name');
            touch(d);
          });
        } else if (a === 'delete-section' && !ro) {
          confirm(
            'Удалить раздел?',
            'Раздел и все его записи будут удалены из ' +
              (d.kind === 'template' ? 'этого шаблона.' : 'этого заказа.'),
            async () => {
              d.value.sections = d.value.sections.filter((s) => s.id !== id);
              touch(d);
            },
          );
        } else if (a === 'add-row' && !ro) {
          const s = d.value.sections.find((s) => s.id === id);
          s.items.push(
            s.type === 'fields' ? { id: uid(), k: '', v: '' } : { id: uid(), t: '', d: 0 },
          );
          touch(d);
          render();
          const rows = app.querySelector(`[data-section="${CSS.escape(id)}"] .sectionbody`);
          rows
            ?.querySelector(
              '.row:last-of-type input:not([type=checkbox]),.row:last-of-type textarea',
            )
            ?.focus();
        } else if (a === 'delete-row' && !ro) {
          confirm(
            'Удалить запись?',
            'Эта запись будет удалена из ' + (d.kind === 'template' ? 'шаблона.' : 'заказа.'),
            async () => {
              const s = d.value.sections.find((s) => s.id === b.dataset.section);
              s.items = s.items.filter((r) => r.id !== id);
              touch(d);
            },
          );
        } else if (a === 'refresh-backups') await loadBackups();
        else if (a === 'export') {
          const r = await api.exportFile();
          if (!r.ok && !r.cancelled) throw new Error(errorText(r.error));
          message = r.cancelled ? 'Экспорт отменён' : 'База сохранена в файл';
          updateStatus();
        } else if (a === 'preview-import')
          await previewImport(document.getElementById('import-text').value);
        else if (a === 'import-file') {
          const f = await api.readImportFile();
          if (f) await previewImport(f.text);
        } else if (a === 'restore-backup') {
          const r = await api.previewBackup(id);
          if (r.error) throw new Error(errorText(r.error));
          replacePreview(
            r.snapshot,
            () => command('restoreBackup', { id }),
            'Восстановление копии',
          );
        }
      });
    } catch (ex) {
      error = errorText(ex);
      updateStatus();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if ([...drafts.values()].some((d) => dirty(d))) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  (async () => {
    try {
      if (!api) throw new Error('Связь с локальной базой недоступна. Откройте приложение Фокус.');
      const r = await api.init();
      snapshot = r.snapshot;
      warnings = r.warnings || [];
      dataPath = r.dataPath || '';
      render();
    } catch (e) {
      app.innerHTML = `<div class="empty"><h1>Не удалось открыть базу</h1><p role="alert">${esc(errorText(e))}</p><p>Данные не заменялись. Закройте приложение и повторите запуск.</p></div>`;
    }
  })();
})();
