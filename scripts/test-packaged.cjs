const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
(async () => {
  let app;
  const report = {};
  try {
    const executablePath =
      process.env.FOCUS_EXECUTABLE ||
      path.resolve(__dirname, '../release/win-unpacked/Фокус — Заказы.exe');
    const directory = path.resolve(__dirname, '../evidence/packaged-data-' + randomUUID());
    report.executable = executablePath;
    report.directory = directory;
    async function launch() {
      const a = await electron.launch({
        executablePath,
        args: ['--focus-hidden', '--focus-data-dir=' + directory],
        env: {
          ...process.env,
          PATH: path.join(process.env.SystemRoot || 'C:/Windows', 'System32'),
        },
      });
      const p = await a.firstWindow();
      await p.waitForSelector('.shell');
      return { a, p };
    }
    let p;
    ({ a: app, p } = await launch());
    assert.equal(await p.evaluate(() => typeof window.require), 'undefined');
    await p.locator('[data-action=new-order]').first().click();
    await p.locator('#dialog input[name=number]').fill('701');
    await p.locator('#dialog input[name=block]').fill('701');
    await p.locator('#dialog button[type=submit]').click();
    await p.locator('#dialog').waitFor({ state: 'hidden' });
    await p.locator('[data-action=view][data-id=notes]').click();
    await p.locator('[data-field=notes]').fill('Упакованная программа\nСохранение и перезапуск');
    assert.equal(await p.evaluate(() => window.focusFlush()), true);
    await app.close();
    app = null;
    ({ a: app, p } = await launch());
    const snapshot = await p.evaluate(async () => (await window.focusAPI.init()).snapshot);
    assert.equal(snapshot.orders.length, 1);
    assert.equal(snapshot.orders[0].notes, 'Упакованная программа\nСохранение и перезапуск');
    report.result = 'PASS';
    report.checks = [
      'No renderer Node access',
      'Create and save through actual UI',
      'PATH excludes Python/Node/npm',
      'Restart retains full notes',
    ];
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    report.result = 'FAIL';
    report.failure = e.stack;
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    await app?.close();
    await fs.writeFile(
      path.resolve(__dirname, '../evidence/packaged-validation.json'),
      JSON.stringify(report, null, 2),
    );
  }
})();
