'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Store } = require('../src/store.cjs');
const seed = require('../src/seed.json');
const root = path.resolve(__dirname, '..');
const packaged = !!process.env.FOCUS_EXECUTABLE;
const directory = path.join(root, 'evidence', 'flex-' + randomUUID());
const report = { packaged, checks: [], errors: [] };
let app, page;
const action = (a) => page.locator(`[data-action="${a}"]`);
const view = (v) => page.locator(`[data-action=view][data-id="${v}"]`);
const state = () => page.evaluate(async () => (await window.focusAPI.init()).snapshot);
const flush = async () => assert.equal(await page.evaluate(() => window.focusFlush()), true);
async function launch() {
  app = await electron.launch({
    executablePath: process.env.FOCUS_EXECUTABLE || require('electron'),
    args: [...(packaged ? [] : [root]), '--focus-data-dir=' + directory],
  });
  page = await app.firstWindow();
  // A normal visible window avoids Electron's hidden-frame throttling during UI interaction.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.show();
    win.focus();
  });
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.waitForSelector('.shell');
  await page.locator('.order[data-id="' + report.orderId + '"]').click();
}
async function check(name, fn) {
  try {
    await fn();
    report.checks.push({ name, pass: true });
    console.log('PASS ' + name);
  } catch (e) {
    report.checks.push({ name, pass: false, error: e.message });
    console.log('FAIL ' + name + ': ' + e.message);
    if (await page.locator('#dialog[open]').count())
      await page.locator('#dialog [data-cancel]').click();
  }
}
const section = (id) => page.locator(`section[data-section="${id}"]`);
const rowHandle = (s, r) => section(s).locator(`[data-move="row"][data-row="${r}"]`);
const numbers = () => page.locator('.question-number').allTextContents();
async function drag(source, target) {
  // Start the pointer gesture before scrolling its destination into view.
  await source.scrollIntoViewIfNeeded();
  const a = await source.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 4 });
  await target.scrollIntoViewIfNeeded();
  const b = await target.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.move(b.x + b.width / 2 + 1, b.y + b.height / 2);
  await page.mouse.up();
}
async function capture(name) {
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
        stayHidden: true,
      })
    )
      .toPNG()
      .toString('base64'),
  );
  await fs.writeFile(path.join(root, 'evidence', name + '.png'), Buffer.from(png, 'base64'));
}
(async () => {
  try {
    const store = await Store.open({ directory, seed });
    await store.command('createOrder', {
      number: '78',
      name: 'Существующий заказ',
      templateId: store.snapshot().templates[0].id,
    });
    let o = store.snapshot().orders[0];
    report.orderId = o.id;
    await store.command('saveOrder', {
      id: o.id,
      expectedVersion: o.version,
      patch: {
        sections: [
          {
            id: 'q1',
            title: 'Техника',
            type: 'q',
            items: [
              { id: 'a', t: 'Холодильник?', d: 0 },
              { id: 'b', t: 'Духовка?', d: 0 },
            ],
          },
          { id: 'empty', title: 'Конструкция', type: 'q', items: [] },
          {
            id: 'q2',
            title: 'Помещение',
            type: 'q',
            items: [
              { id: 'blank', t: '', d: 0 },
              { id: 'c', t: 'Высота?\nУточнить у клиента.', d: 0 },
            ],
          },
          {
            id: 'f1',
            title: 'Размеры',
            type: 'fields',
            items: [
              { id: 'frow1', k: 'Высота', v: '900' },
              { id: 'frow2', k: 'Ширина', v: '600' },
            ],
          },
          { id: 'f2', title: 'Материалы', type: 'fields', items: [] },
          {
            id: 'i1',
            title: 'Проверка',
            type: 'items',
            items: [{ id: 'irow', t: 'Проверить чертёж', d: 0 }],
          },
        ],
      },
    });
    await launch();
    await check('Numeric block form and titles', async () => {
      await action('new-order').first().click();
      const block = page.getByLabel('Блок', { exact: true });
      await block.fill('00445');
      await page.locator('#dialog input[name=number]').fill('79');
      await page.locator('#dialog button[type=submit]').click();
      await page.locator('#dialog').waitFor({ state: 'hidden' });
      const db = await state();
      const n = db.orders.find((x) => x.number === '79');
      assert.equal(n.name, 'Блок 00445');
      assert.equal(n.block, '00445');
      assert.match(await page.locator('h1').innerText(), /Блок 00445/);
      assert.match(await page.locator('.tab.active').innerText(), /Блок 00445/);
      assert.match(await page.locator('.order[data-id="' + n.id + '"]').innerText(), /Блок 00445/);
      await page.locator('.order[data-id="' + report.orderId + '"]').click();
    });
    await check('Search by number, block and legacy title keeps open tabs and clears', async () => {
      const search = page.getByLabel('Поиск заказов', { exact: true });
      const tabCount = await page.locator('.tab').count();
      await search.fill('00445');
      assert.equal(await page.locator('.order').count(), 1);
      assert.match(await page.locator('.order').innerText(), /Блок 00445/);
      await search.fill('  СУЩЕСТВУЮЩИЙ  ');
      assert.equal(await page.locator('.order').count(), 1);
      await search.fill('78');
      assert.equal(await page.locator('.order').count(), 1);
      await search.fill('Такого заказа нет');
      assert.equal(await page.locator('.order').count(), 0);
      assert.equal(await page.getByText('Заказы не найдены', { exact: true }).count(), 1);
      assert.equal(await page.locator('.tab').count(), tabCount);
      assert.match(await page.locator('h1').innerText(), /78/);
      await search.fill('');
      assert.equal(await page.locator('.order').count(), 2);
    });
    await view('q').click();
    await check('Global non-editable numbering and copy, including blank sections', async () => {
      assert.deepEqual(await numbers(), ['1.', '2.', '3.']);
      assert.equal(
        await page
          .locator(
            '.question-number input,.question-number textarea,[contenteditable=true].question-number',
          )
          .count(),
        0,
      );
      await section('q1').locator('[data-field=d][data-row=b]').check();
      await action('copy').click();
      assert.equal(
        await app.evaluate(({ clipboard }) => clipboard.readText()),
        '1. Холодильник?\n3. Высота?\nУточнить у клиента.',
      );
    });
    await check(
      'Row drag changes question order and numbers without losing typed text',
      async () => {
        await section('q1').locator('textarea[data-row=a]').fill('Изменено перед переносом');
        await drag(rowHandle('q1', 'b'), rowHandle('q1', 'a'));
        await flush();
        const o = (await state()).orders.find((x) => x.id === report.orderId);
        assert.deepEqual(
          o.sections.find((x) => x.id === 'q1').items.map((x) => x.id),
          ['b', 'a'],
        );
        assert.equal(o.sections.find((x) => x.id === 'q1').items[1].t, 'Изменено перед переносом');
        assert.deepEqual(await numbers(), ['1.', '2.', '3.']);
      },
    );
    await check(
      'Section drag across siblings recomputes global numbering; rows stay in their section',
      async () => {
        await drag(
          section('q2').locator('[data-move=section]'),
          section('q1').locator('[data-move=section]'),
        );
        await flush();
        const order = (await state()).orders.find((x) => x.id === report.orderId);
        assert.deepEqual(
          order.sections.filter((x) => x.type === 'q').map((x) => x.id),
          ['q2', 'q1', 'empty'],
        );
        assert.deepEqual(await numbers(), ['1.', '2.', '3.']);
        await drag(rowHandle('q1', 'a'), rowHandle('q2', 'c'));
        await flush();
        assert.deepEqual(
          (await state()).orders.find((x) => x.id === report.orderId).sections,
          order.sections,
        );
      },
    );
    await check('Clearing, adding and deleting questions immediately renumbers', async () => {
      await section('q2').locator('textarea[data-row=c]').fill('');
      assert.deepEqual(await numbers(), ['1.', '2.']);
      await section('q2').locator('textarea[data-row=c]').fill('Высота?');
      assert.deepEqual(await numbers(), ['1.', '2.', '3.']);
      await section('empty').locator('[data-action=add-row]').click();
      await section('empty').locator('textarea').fill('Новый вопрос');
      assert.deepEqual(await numbers(), ['1.', '2.', '3.', '4.']);
      await section('empty').locator('[data-action=delete-row]').click();
      await page.locator('#dialog button[type=submit]').click();
      await page.locator('#dialog').waitFor({ state: 'hidden' });
      assert.deepEqual(await numbers(), ['1.', '2.', '3.']);
    });
    await check('Work tabs reorder by drag and keyboard, preserving active view', async () => {
      await drag(view('items'), view('notes'));
      await flush();
      assert.deepEqual(
        await page
          .locator('.sectionnav [data-action=view]')
          .evaluateAll((es) => es.map((e) => e.dataset.id)),
        ['fields', 'q', 'notes', 'items'],
      );
      assert.equal(await view('q').getAttribute('aria-pressed'), 'true');
      await view('items').focus();
      await page.keyboard.press('Alt+ArrowLeft');
      await flush();
      assert.deepEqual((await state()).orders.find((x) => x.id === report.orderId).viewOrder, [
        'fields',
        'q',
        'items',
        'notes',
      ]);
    });
    await view('fields').click();
    await check(
      'Arrow table navigation keeps column, edits, boundary and normal text cursor',
      async () => {
        const first = section('f1').locator('input[data-row=frow1][data-field=v]');
        const second = section('f1').locator('input[data-row=frow2][data-field=v]');
        await first.fill('910');
        await first.press('ArrowDown');
        assert.equal(await second.evaluate((e) => document.activeElement === e), true);
        await second.press('ArrowUp');
        assert.equal(await first.evaluate((e) => document.activeElement === e), true);
        await first.evaluate((e) => e.setSelectionRange(1, 1));
        await first.press('ArrowLeft');
        assert.equal(
          await first.evaluate((e) => document.activeElement === e && e.selectionStart === 0),
          true,
        );
        await first.press('ArrowLeft');
        assert.equal(
          await section('f1')
            .locator('input[data-row=frow1][data-field=k]')
            .evaluate((e) => document.activeElement === e),
          true,
        );
        await flush();
        assert.equal(
          (await state()).orders
            .find((x) => x.id === report.orderId)
            .sections.find((x) => x.id === 'f1').items[0].v,
          '910',
        );
      },
    );
    await check(
      'Parameter checklists can be created, checked, reordered, stay out of Check',
      async () => {
        await action('add-section').click();
        await page.locator('#dialog input[name=name]').fill('Согласование');
        await page.getByLabel('Тип раздела').selectOption('items');
        await page.locator('#dialog button[type=submit]').click();
        await page.locator('#dialog').waitFor({ state: 'hidden' });
        const s = page
          .locator('section')
          .filter({ has: page.locator('h2', { hasText: 'Согласование' }) });
        await s.locator('[data-action=add-row]').click();
        await s.locator('textarea').fill('Чертёж согласован');
        await s.locator('[data-field=d]').check();
        await flush();
        let o = (await state()).orders.find((x) => x.id === report.orderId);
        const n = o.sections.find((x) => x.title === 'Согласование');
        assert.equal(n.type, 'items');
        assert.equal(n.view, 'fields');
        assert.equal(n.items[0].d, 1);
        report.checkSection = n.id;
        await s.locator('[data-move=section]').focus();
        await page.keyboard.press('ArrowUp');
        await flush();
        await view('items').click();
        assert.equal(await page.locator('h2').filter({ hasText: 'Согласование' }).count(), 0);
        await view('fields').click();
        assert.equal(await s.count(), 1);
      },
    );
    await check('Field rows reorder with keyboard and keep focus', async () => {
      await rowHandle('f1', 'frow2').focus();
      await page.keyboard.press('ArrowUp');
      await flush();
      assert.deepEqual(
        (await state()).orders
          .find((x) => x.id === report.orderId)
          .sections.find((x) => x.id === 'f1')
          .items.map((x) => x.id),
        ['frow2', 'frow1'],
      );
      assert.equal(
        await rowHandle('f1', 'frow2').evaluate((e) => document.activeElement === e),
        true,
      );
    });
    await check('Layouts at 1440 and 1024, no overflow', async () => {
      for (const width of [1440, 1024]) {
        await app.evaluate(
          ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 768),
          width,
        );
        await page.waitForFunction((w) => innerWidth === w, width);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await capture('flex-parameters-' + width + (packaged ? '-packaged' : ''));
        await view('q').click();
        await capture('flex-questions-' + width + (packaged ? '-packaged' : ''));
        await view('fields').click();
      }
    });
    await check(
      'Restart and whole database import retain changed order without affecting legacy name',
      async () => {
        await flush();
        const before = await state();
        await app.close();
        app = null;
        await launch();
        const after = await state();
        assert.deepEqual(after.orders, before.orders);
        assert.equal(after.orders.find((x) => x.id === report.orderId).name, 'Существующий заказ');
        assert.equal(
          after.orders
            .find((x) => x.id === report.orderId)
            .sections.some((x) => x.id === report.checkSection),
          true,
        );
        const r = await page.evaluate(
          async (db) => window.focusAPI.command('importData', { text: JSON.stringify(db) }),
          before,
        );
        assert.equal(r.ok, true);
        assert.deepEqual(r.snapshot.orders, before.orders);
      },
    );
    await check('Archive has no row/section drag and no editable table fields', async () => {
      await action('archive').click();
      await page.locator('#dialog button[type=submit]').click();
      await page.locator('#dialog').waitFor({ state: 'hidden' });
      await view('fields').click();
      assert.equal(await page.locator('[data-move=section],[data-move=row]').count(), 0);
      assert.equal(await page.locator('.fieldrow input:not([disabled])').count(), 0);
      assert.equal(await page.locator('.sectionnav [draggable=true]').count(), 0);
      const search = page.getByLabel('Поиск заказов', { exact: true });
      await search.fill('78');
      assert.equal(await page.locator('.order').count(), 1);
      await search.fill('00445');
      assert.equal(await page.locator('.order').count(), 0);
      await search.fill('');
      assert.equal(await page.locator('.order').count(), 1);
    });
    await check(
      'Template parameter checklists and view order are inherited by future orders only',
      async () => {
        const previousOrders = (await state()).orders;
        await action('templates').click();
        await action('new-template').click();
        await page.locator('#dialog input[name=name]').fill('Порядок и галочки');
        await page.locator('#dialog button[type=submit]').click();
        await page.locator('#dialog').waitFor({ state: 'hidden' });
        await view('fields').click();
        await action('add-section').click();
        await page.locator('#dialog input[name=name]').fill('Проверки параметров');
        await page.getByLabel('Тип раздела').selectOption('items');
        await page.locator('#dialog button[type=submit]').click();
        await page.locator('#dialog').waitFor({ state: 'hidden' });
        const card = page
          .locator('section')
          .filter({ has: page.locator('h2', { hasText: 'Проверки параметров' }) });
        await card.locator('[data-action=add-row]').click();
        await card.locator('textarea').fill('Первый пункт');
        await card.locator('[data-field=d]').check();
        await card.locator('[data-action=add-row]').click();
        await card.locator('textarea').nth(1).waitFor({ state: 'visible' });
        await card.locator('textarea').last().fill('Второй пункт');
        await card.locator('[data-move=row]').last().focus();
        await page.keyboard.press('ArrowUp');
        await flush();
        await view('fields').focus();
        await page.keyboard.press('Alt+ArrowLeft');
        await flush();
        const tpl = (await state()).templates.at(-1);
        assert.equal(tpl.sections[0].view, 'fields');
        assert.deepEqual(
          tpl.sections[0].items.map((x) => x.t),
          ['Второй пункт', 'Первый пункт'],
        );
        assert.deepEqual(tpl.viewOrder, ['fields', 'items', 'q', 'notes']);
        await action('new-order').first().click();
        await page.getByLabel('Блок', { exact: true }).fill('222');
        await page.locator('#dialog input[name=number]').fill('80');
        await page.locator('#dialog select[name=templateId]').selectOption(tpl.id);
        await page.locator('#dialog button[type=submit]').click();
        await page.locator('#dialog').waitFor({ state: 'hidden' });
        const db = await state(),
          created = db.orders.find((x) => x.number === '80');
        assert.deepEqual(created.sections, tpl.sections);
        assert.deepEqual(created.viewOrder, tpl.viewOrder);
        assert.deepEqual(
          db.orders.filter((x) => x.id !== created.id),
          previousOrders,
        );
        await view('fields').click();
        assert.equal(await page.locator('.row input[type=checkbox]:checked').count(), 1);
      },
    );
    assert.deepEqual(report.errors, []);
  } catch (e) {
    report.errors.push(e.stack);
    console.error(e.stack);
  } finally {
    await app?.close();
    const ok = !report.errors.length && report.checks.every((x) => x.pass);
    await fs.writeFile(
      path.join(
        root,
        'evidence',
        'flex-' + (packaged ? 'packaged-' : '') + (ok ? 'green' : 'red') + '.json',
      ),
      JSON.stringify(report, null, 2),
    );
    process.exitCode = ok ? 0 : 1;
  }
})();
