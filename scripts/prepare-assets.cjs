const fs = require('node:fs');
const path = require('node:path');
const target = path.join(__dirname, '../src/assets');
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(path.join(__dirname, '../LICENSE'), path.join(target, 'LICENSE-Focus-Orders.txt'));
const fontRoot = path.join(__dirname, '../node_modules/@fontsource-variable/manrope');
fs.cpSync(path.join(fontRoot, 'files'), path.join(target, 'files'), { recursive: true });
fs.writeFileSync(
  path.join(target, 'fonts.css'),
  fs
    .readFileSync(path.join(fontRoot, 'index.css'), 'utf8')
    .replaceAll("'Manrope Variable'", "'Manrope'"),
);
const names = [
  'plus',
  'archive',
  'layout-template',
  'database',
  'check',
  'trash',
  'edit',
  'x',
  'search',
  'folder',
  'download',
  'upload',
  'copy',
  'restore',
  'alert-triangle',
  'checklist',
];
const iconsRoot = path.join(__dirname, '../node_modules/@tabler/icons/icons/outline');
const aliases = { 'layout-template': 'template' };
const symbols = names.map((name) => {
  const raw = fs.readFileSync(path.join(iconsRoot, (aliases[name] || name) + '.svg'), 'utf8');
  return (
    '<symbol id="' +
    name +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '') +
    '</symbol>'
  );
});
fs.writeFileSync(
  path.join(target, 'icons.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg">' + symbols.join('') + '</svg>',
);
for (const [source, name] of [
  [fontRoot, 'Manrope'],
  [path.dirname(path.dirname(iconsRoot)), 'Tabler'],
])
  fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'LICENSE-' + name + '.txt'));
console.log('Local Manrope (including Cyrillic) and Tabler icon sprite prepared.');
