'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'evidence');
const executablePath = process.env.FOCUS_EXECUTABLE || require('electron');
const packaged = !!process.env.FOCUS_EXECUTABLE;
const directories = {
  normal: path.join(evidence, 'desktop-data-' + randomUUID()),
  fault: path.join(evidence, 'desktop-fault-' + randomUUID()),
};
const report = { packaged, scenarios: [], errors: [] };
let application, page;
async function capture(file) {
  const png = await application.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.showInactive();
    try {
      return (await win.webContents.capturePage()).toPNG().toString('base64');
    } finally {
      win.hide();
    }
  });
  await fs.writeFile(file, Buffer.from(png, 'base64'));
}
async function launch(directory, extra = []) {
  const app = await electron.launch({
    executablePath,
    args: [
      ...(packaged ? [] : [root]),
      '--focus-hidden',
      '--focus-data-dir=' + directory,
      ...extra,
    ],
    timeout: 30000,
  });
  const p = await app.firstWindow();
  p.on('pageerror', (e) => report.errors.push(e.message));
  await p.waitForSelector('.shell');
  return { app, p };
}
const flushed = async () => {
  assert.equal(await page.evaluate(() => window.focusFlush()), true);
};
const state = () => page.evaluate(async () => (await window.focusAPI.init()).snapshot);
const action = (a) => page.locator('[data-action="' + a + '"]');
async function scenario(name, fn) {
  await fn();
  report.scenarios.push({ name, result: 'PASS' });
  console.log('PASS ' + name);
}
async function create(number, name) {
  await action('new-order').first().click();
  await page.locator('#dialog input[name=number]').fill(number);
  await page.locator('#dialog input[name=name]').fill(name);
  await page.locator('#dialog button[type=submit]').click();
  await page.locator('#dialog').waitFor({ state: 'hidden' });
}
async function confirm() {
  await page.locator('#dialog button[type=submit]').click();
  await page.locator('#dialog').waitFor({ state: 'hidden' });
}
async function addSection(title) {
  await action('add-section').click();
  await page.locator('#dialog input[name=name]').fill(title);
  await confirm();
  await flushed();
  return page.locator('.section').filter({ has: page.locator('h2', { hasText: title }) });
}
async function close() {
  if (application) {
    await application.close();
    application = null;
  }
}
(async () => {
  await fs.mkdir(evidence, { recursive: true });
  try {
    ({ app: application, p: page } = await launch(directories.normal));
    await scenario('Empty database, two independent orders and closable tabs', async () => {
      assert.equal((await state()).orders.length, 0);
      await create('101', 'Первая кухня');
      await create('102', 'Вторая кухня');
      assert.equal((await state()).orders.length, 2);
      await page.locator('.order').filter({ hasText: '101' }).click();
      assert.match(await page.locator('h1').innerText(), /101/);
      await page.locator('.tab.active [data-action=close-tab]').click();
      assert.equal((await state()).orders.length, 2);
      await page.locator('.order').filter({ hasText: '101' }).click();
    });
    await scenario('Checklists, parameters and questions CRUD, copied text', async () => {
      const section = await addSection('Своя проверка');
      await section.locator('[data-action=add-row]').click();
      await section.locator('textarea').fill('Проверить ширину');
      await section.locator('input[type=checkbox]').check();
      await flushed();
      await page.locator('[data-action=view][data-id=fields]').click();
      const fields = await addSection('Свои параметры');
      await fields.locator('[data-action=add-row]').click();
      await fields.locator('[data-field=k]').fill('Мой размер');
      await fields.locator('[data-field=v]').fill('123 мм');
      await flushed();
      await page.locator('[data-action=view][data-id=q]').click();
      const questions = await addSection('Свои вопросы');
      await questions.locator('[data-action=add-row]').click();
      await questions.locator('textarea').fill('Где розетка?');
      await flushed();
      await action('copy').click();
      const clipboard = await application.evaluate(({ clipboard }) => clipboard.readText());
      assert.ok(clipboard.includes('Где розетка?'));
      assert.ok(clipboard.startsWith('1.'));
      await questions.locator('[data-action=add-row]').click();
      await questions.locator('textarea').last().fill('Удалить меня');
      await questions.locator('[data-action=delete-row]').last().click();
      await confirm();
      await flushed();
      assert.equal(await questions.locator('textarea').count(), 1);
      const db = await state();
      const a = db.orders.find((o) => o.number === '101'),
        b = db.orders.find((o) => o.number === '102');
      assert.ok(a.sections.some((s) => s.title === 'Своя проверка'));
      assert.ok(!b.sections.some((s) => s.title === 'Своя проверка'));
      assert.ok(!db.templates[0].sections.some((s) => s.title === 'Своя проверка'));
    });
    const note = 'Длинная заметка без потери фокуса\nВторая строка с пробелами.';
    await scenario(
      'Continuous multiline input, navigation and archive restore retain data',
      async () => {
        await page.locator('[data-action=view][data-id=notes]').click();
        const input = page.locator('[data-field=notes]');
        await input.focus();
        await input.pressSequentially(note);
        await flushed();
        assert.equal(await input.inputValue(), note);
        assert.equal(await input.evaluate((el) => el === document.activeElement), true);
        await page.locator('.order').filter({ hasText: '102' }).click();
        assert.equal(await page.locator('[data-field=notes]').inputValue(), '');
        await page.locator('.order').filter({ hasText: '101' }).click();
        assert.equal(await page.locator('[data-field=notes]').inputValue(), note);
        await action('archive').click();
        await confirm();
        assert.equal(await page.locator('[data-field=notes]').isDisabled(), true);
        await action('restore').click();
        await confirm();
        assert.equal(await page.locator('[data-field=notes]').inputValue(), note);
        assert.equal(await page.locator('[data-field=notes]').isDisabled(), false);
      },
    );
    await scenario('Named templates are a separate tab and affect only new orders', async () => {
      await action('templates').click();
      assert.match(await page.locator('h1').innerText(), /Шаблоны/);
      await action('new-template').click();
      await page.locator('#dialog input[name=name]').fill('Особый шаблон');
      await confirm();
      const section = await addSection('Проверка особого шаблона');
      await section.locator('[data-action=add-row]').click();
      await section.locator('textarea').fill('Особый пункт');
      await flushed();
      await action('new-order').click();
      await page.locator('#dialog input[name=number]').fill('103');
      await page.locator('#dialog input[name=name]').fill('По особому шаблону');
      await page.locator('#dialog select').selectOption({ label: 'Особый шаблон' });
      await confirm();
      assert.ok(
        (await state()).orders
          .find((o) => o.number === '103')
          .sections.some((s) => s.title === 'Проверка особого шаблона'),
      );
      await action('templates').click();
      await page.locator('#template-select').selectOption({ label: 'Особый шаблон' });
      await page.locator('.section textarea').fill('Пункт изменён');
      await flushed();
      assert.equal(
        (await state()).orders.find((o) => o.number === '103').sections[0].items[0].t,
        'Особый пункт',
      );
    });
    await scenario('Backup tab, preview, malformed import and IPC constraints', async () => {
      await action('backups').click();
      await page.waitForSelector('.backuprow');
      assert.match(await page.locator('h1').innerText(), /Резервные копии/);
      assert.ok(await page.locator('.tab').filter({ hasText: 'Шаблоны' }).count());
      await page.locator('#import-text').fill('{broken');
      await action('preview-import').click();
      await page.waitForFunction(() =>
        document.querySelector('#save-status').textContent.includes('INVALID'),
      );
      assert.equal((await state()).orders.length, 3);
      assert.equal((await page.evaluate(() => window.focusAPI.command('unknown', {}))).ok, false);
      assert.ok((await page.evaluate(() => window.focusAPI.previewBackup('../state.json'))).error);
      const preview = await page.evaluate(async () => {
        const list = await window.focusAPI.listBackups();
        return window.focusAPI.previewBackup(list[0].id);
      });
      assert.equal(preview.snapshot.orders.length, 3);
      await page.locator('[data-action=restore-backup]').first().click();
      assert.match(await page.locator('#dialog').innerText(), /3 заказов/);
      await page.locator('#dialog [data-cancel]').click();
    });
    await scenario('Native export and file import with full preview', async () => {
      const file = path.join(directories.normal, 'manual.json');
      await application.evaluate(({ dialog }, file) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, file);
      await action('export').click();
      await page.waitForFunction(() =>
        document.querySelector('#save-status').textContent.includes('База сохранена в файл'),
      );
      const saved = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.equal(saved.orders.length, 3);
      assert.equal(saved.templates.length, 2);
      await action('import-file').click();
      assert.match(await page.locator('#dialog').innerText(), /3 заказов и 2 шаблонов/);
      await confirm();
      assert.equal((await state()).orders.length, 3);
    });
    await scenario('Real restart preserves orders, notes and templates', async () => {
      await flushed();
      await close();
      ({ app: application, p: page } = await launch(directories.normal));
      const db = await state();
      assert.equal(db.orders.length, 3);
      assert.equal(db.templates.length, 2);
      assert.equal(db.orders.find((o) => o.number === '101').notes, note);
      await page.locator('.order').filter({ hasText: '101' }).click();
      await page.locator('[data-action=view][data-id=items]').click();
    });
    await scenario('Window layout and reduced motion', async () => {
      for (const [width, height] of [
        [1440, 900],
        [1024, 768],
      ]) {
        await application.evaluate(
          ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
          [width, height],
        );
        await capture(
          path.join(evidence, (packaged ? 'packaged-' : '') + 'desktop-' + width + '.png'),
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          true,
        );
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.ok(
        (
          await page
            .locator('button')
            .first()
            .evaluate((el) => getComputedStyle(el).transitionDuration)
        )
          .split(',')
          .every((s) => parseFloat(s) < 0.01),
      );
    });
    assert.deepEqual(report.errors, []);
    await close();
    if (!packaged) {
      ({ app: application, p: page } = await launch(directories.fault, [
        '--focus-test-save-failure',
      ]));
      await create('501', 'Ошибка записи');
      await page.locator('[data-action=view][data-id=notes]').click();
      await page.locator('[data-field=notes]').fill('Несохранённый ввод остаётся');
      assert.equal(await page.evaluate(() => window.focusFlush()), false);
      await scenario('Visible failed-save draft survives and retry succeeds', async () => {
        assert.match(await page.locator('#save-status').innerText(), /Не удалось сохранить/);
        assert.equal(
          await page.locator('[data-field=notes]').inputValue(),
          'Несохранённый ввод остаётся',
        );
        assert.equal((await state()).orders[0].notes, '');
        await action('retry').click();
        await page.waitForFunction(() =>
          document.querySelector('#save-status').textContent.includes('Изменения сохранены'),
        );
        assert.equal((await state()).orders[0].notes, 'Несохранённый ввод остаётся');
      });
      await close();
    }
    report.result = 'PASS';
  } catch (error) {
    report.result = 'FAIL';
    report.failure = error.stack;
    console.error(error.stack);
    process.exitCode = 1;
    try {
      if (page) await capture(path.join(evidence, 'desktop-failure.png'));
    } catch {}
  } finally {
    await close().catch(() => {});
    await fs.writeFile(
      path.join(evidence, packaged ? 'packaged-validation.json' : 'desktop-validation.json'),
      JSON.stringify(report, null, 2),
    );
  }
})();
