const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Store } = require('../src/store.cjs');
const seed = require('../src/seed.json');
(async () => {
  let app;
  const findings = [];
  try {
    const directory = path.resolve(__dirname, '../evidence/accessibility-' + randomUUID());
    const store = await Store.open({ directory, seed });
    await store.command('createOrder', {
      number: '601',
      name: 'Проверка длинного текста',
      templateId: store.snapshot().templates[0].id,
    });
    let order = store.snapshot().orders[0];
    const text =
      'Уточнить положение розетки, высоту столешницы и расстояние до края фасада. '.repeat(15);
    await store.command('saveOrder', {
      id: order.id,
      expectedVersion: order.version,
      patch: {
        sections: [
          {
            id: 'long-section',
            title: 'Длинная проверка',
            type: 'items',
            items: [{ id: 'long-item', t: text, d: 0 }],
          },
        ],
      },
    });
    app = await electron.launch({
      executablePath: require('electron'),
      args: [path.resolve(__dirname, '..'), '--focus-hidden', '--focus-data-dir=' + directory],
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.shell');
    await page.locator('.order').click();
    await page.evaluate(() => document.fonts.ready);
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
      await fs.writeFile(
        path.resolve(__dirname, '../evidence/' + name + '.png'),
        Buffer.from(png, 'base64'),
      );
    }
    for (const width of [1440, 1024]) {
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 768),
        width,
      );
      await page.waitForFunction((width) => window.innerWidth === width, width);
      const box = await page
        .locator('.row textarea')
        .evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
      findings.push({ check: 'wrapped-text-' + width, pass: box.scroll <= box.client + 2, ...box });
      await capture('wrapped-' + width);
    }
    const view = page.locator('[data-action=view][data-id=notes]');
    await view.focus();
    await view.press('Enter');
    findings.push({
      check: 'keyboard-view-focus',
      pass: await page.evaluate(
        () =>
          document.activeElement?.dataset.action === 'view' &&
          document.activeElement?.dataset.id === 'notes',
      ),
    });
    await capture('keyboard-notes');
    await page.locator('[data-action=templates]').focus();
    await page.keyboard.press('Enter');
    findings.push({
      check: 'keyboard-tool-tab-focus',
      pass: await page.evaluate(() => document.activeElement?.dataset.action === 'templates'),
    });
    console.log(JSON.stringify(findings, null, 2));
    const ok = findings.every((f) => f.pass);
    process.exitCode = ok ? 0 : 1;
    await fs.writeFile(
      path.resolve(__dirname, '../evidence/ui-accessibility-' + (ok ? 'green' : 'red') + '.json'),
      JSON.stringify(findings, null, 2),
    );
  } catch (e) {
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
})();
