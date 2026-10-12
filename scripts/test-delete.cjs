const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { Store } = require('../src/store.cjs');
const seed = require('../src/seed.json');
(async () => {
  let app;
  const report = { checks: [] };
  try {
    const root = path.resolve(__dirname, '..'),
      directory = path.join(root, 'evidence/delete-ui-' + randomUUID());
    const setup = await Store.open({ directory, seed });
    for (const number of ['801', '802', '803'])
      await setup.command('createOrder', {
        number,
        name: 'Заказ ' + number,
        templateId: setup.snapshot().templates[0].id,
      });
    const archived = setup.snapshot().orders.find((o) => o.number === '803');
    await setup.command('archiveOrder', { id: archived.id });
    const executablePath = process.env.FOCUS_EXECUTABLE || require('electron');
    const packaged = !!process.env.FOCUS_EXECUTABLE;
    const launch = async () => {
      app = await electron.launch({
        executablePath,
        args: [...(packaged ? [] : [root]), '--focus-hidden', '--focus-data-dir=' + directory],
      });
      const page = await app.firstWindow();
      await page.waitForSelector('.shell');
      return page;
    };
    let page = await launch();
    const db = () => page.evaluate(async () => (await window.focusAPI.init()).snapshot);
    await page.locator('.order').filter({ hasText: '802' }).click();
    await page.locator('.order').filter({ hasText: '801' }).click();
    await page.locator('[data-action=view][data-id=notes]').click();
    await page.locator('[data-field=notes]').fill('Заметка перед удалением');
    await page.locator('[data-action=delete-order]').click();
    assert.match(await page.locator('#dialog').innerText(), /801/);
    await page.locator('#dialog [data-cancel]').click();
    assert.equal((await db()).orders.length, 3);
    assert.equal(
      (await db()).orders.find((o) => o.number === '801').notes,
      'Заметка перед удалением',
    );
    report.checks.push('Cancel preserves order and pending notes');
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1024, 768),
    );
    await page.waitForFunction(() => window.innerWidth === 1024);
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
          stayHidden: true,
        })
      )
        .toPNG()
        .toString('base64'),
    );
    await fs.writeFile(
      path.join(root, 'evidence/delete-header-1024.png'),
      Buffer.from(png, 'base64'),
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await page.locator('[data-action=delete-order]').click();
    await page.locator('#dialog button[type=submit]').click();
    await page.locator('#dialog').waitFor({ state: 'hidden' });
    assert.equal(
      (await db()).orders.some((o) => o.number === '801'),
      false,
    );
    assert.equal(await page.locator('.tab').filter({ hasText: '801' }).count(), 0);
    assert.equal(await page.locator('.tab').filter({ hasText: '802' }).count(), 1);
    report.checks.push('Active deletion closes only its tab and preserves another order');
    await page.locator('[data-action=area][data-id=archive]').click();
    await page.locator('.order').filter({ hasText: '803' }).click();
    await page.locator('[data-action=delete-order]').click();
    await page.locator('#dialog button[type=submit]').click();
    await page.locator('#dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(
      (await db()).orders.map((o) => o.number),
      ['802'],
    );
    report.checks.push('Archived deletion without restoration');
    await app.close();
    app = null;
    page = await launch();
    assert.deepEqual(
      (await db()).orders.map((o) => o.number),
      ['802'],
    );
    const copies = await page.evaluate(() => window.focusAPI.listBackups());
    let recoverable = false;
    for (const copy of copies) {
      const preview = await page.evaluate((id) => window.focusAPI.previewBackup(id), copy.id);
      if (
        preview.snapshot.orders.some(
          (o) => o.number === '801' && o.notes === 'Заметка перед удалением',
        )
      )
        recoverable = true;
    }
    assert.equal(recoverable, true);
    report.checks.push('Deletion persists after restart and pre-delete notes are backed up');
    report.result = 'PASS';
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    report.result = 'FAIL';
    report.failure = e.stack;
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    await app?.close();
    await fs.writeFile(
      path.resolve(
        __dirname,
        '../evidence/delete-' +
          (process.env.FOCUS_EXECUTABLE ? 'packaged' : 'desktop') +
          '-validation.json',
      ),
      JSON.stringify(report, null, 2),
    );
  }
})();
