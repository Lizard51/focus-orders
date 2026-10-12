# Сторонние компоненты

Код приложения «Фокус — Заказы» распространяется по [MIT](LICENSE). Сторонние компоненты сохраняют собственные лицензии.

| Компонент | Назначение | Лицензия и уведомления |
|---|---|---|
| [Electron](https://github.com/electron/electron) | Офлайн-окно приложения и встроенный движок | MIT; `LICENSE` и `LICENSES.chromium.html` входят в установку |
| [Manrope](https://github.com/sharanda/manrope) | Локальный шрифт, включая кириллицу | SIL Open Font License 1.1; [полный текст](src/assets/LICENSE-Manrope.txt) |
| [Tabler Icons](https://github.com/tabler/tabler-icons) | Иконки интерфейса и значок приложения | MIT; [полный текст](src/assets/LICENSE-Tabler.txt) |

Приложение не обращается к CDN для шрифтов и иконок. `src/assets/app-icon.svg` основан на иконке `checklist` Tabler. Изменена композиция: зелёный фон и белый знак.

electron-builder, Playwright и пакеты установки шрифта/иконок используются при разработке и сборке. Их точные версии зафиксированы в `package-lock.json`; собственные лицензии находятся в соответствующих пакетах.
