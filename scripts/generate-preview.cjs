const { _electron: electron } = require('playwright');
const { Store } = require('../src/store.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
(async () => {
  let app;
  try {
    const root = path.resolve(__dirname, '..'),
      directory = path.join(root, 'evidence/public-preview-' + randomUUID());
    const sections = [
      {
        id: 'demo-checks',
        title: 'Документы и помещение',
        type: 'items',
        items: [
          { id: 'demo-1', t: 'Согласовать эскиз и размеры с менеджером', d: 1 },
          { id: 'demo-2', t: 'Проверить замер помещения и высоту потолка', d: 1 },
          { id: 'demo-3', t: 'Уточнить расположение розеток и выводов воды', d: 0 },
          { id: 'demo-4', t: 'Проверить сторону открывания фасадов', d: 0 },
        ],
      },
      {
        id: 'demo-build',
        title: 'Конструктив и производство',
        type: 'items',
        items: [
          { id: 'demo-5', t: 'Сверить материалы корпуса, фасадов и столешницы', d: 1 },
          { id: 'demo-6', t: 'Проверить зазоры для встроенной техники', d: 0 },
        ],
      },
      {
        id: 'demo-params',
        title: 'Материалы',
        type: 'fields',
        items: [{ id: 'demo-param', k: 'Фасады', v: 'Матовые, светлые' }],
      },
      {
        id: 'demo-questions',
        title: 'Вопросы менеджеру',
        type: 'q',
        items: [{ id: 'demo-question', t: 'Подтверждена ли модель варочной панели?', d: 0 }],
      },
    ];
    const store = await Store.open({ directory, seed: sections });
    for (const [number, name] of [
      ['1042', 'Кухня · светлые фасады'],
      ['1051', 'Шкаф в прихожую'],
      ['1036', 'Завершённый проект'],
    ])
      await store.command('createOrder', {
        number,
        name,
        templateId: store.snapshot().templates[0].id,
      });
    await store.command('archiveOrder', { id: store.snapshot().orders[2].id });
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root, '--focus-hidden', '--focus-data-dir=' + directory],
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.shell');
    await page.locator('.order').filter({ hasText: '1042' }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 850),
    );
    await page.waitForFunction(() => window.innerWidth === 1280);
    await page.evaluate(() => document.fonts.ready);
    // Public demo: hide the test machine's filesystem path without editing a raster.
    await page.evaluate(() => {
      document.querySelector('.statusbar .path').textContent = '%APPDATA%\\FocusOrders';
    });
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
          stayHidden: true,
        })
      )
        .toPNG()
        .toString('base64'),
    );
    await fs.mkdir(path.join(root, 'docs/images'), { recursive: true });
    await fs.writeFile(path.join(root, 'docs/images/main-window.png'), Buffer.from(png, 'base64'));
    console.log('Public demo screenshot captured; no real orders or machine-specific path.');
  } catch (e) {
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
})();
