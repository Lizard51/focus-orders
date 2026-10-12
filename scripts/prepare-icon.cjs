const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  let browser;
  try {
    const target = path.resolve(__dirname, '../src/assets');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../node_modules/@tabler/icons/icons/outline/checklist.svg'),
      'utf8',
    );
    const paths = source.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#427259"/><g transform="translate(44 44) scale(7)" fill="none" stroke="white" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      paths +
      '</g></svg>';
    fs.writeFileSync(path.join(target, 'app-icon.svg'), svg);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({
      viewport: { width: 256, height: 256 },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      '<html><body style="margin:0;background:transparent">' + svg + '</body></html>',
    );
    const png = await page.screenshot({ omitBackground: true });
    fs.writeFileSync(path.join(target, 'app-icon.png'), png);
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(22, 18);
    fs.writeFileSync(path.join(target, 'app-icon.ico'), Buffer.concat([header, png]));
    console.log('256px Focus icon PNG/ICO created from licensed Tabler SVG.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
})();
