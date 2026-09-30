# Фича: окно «Командная строка» — доработки

> Портативный документ. Описывает все изменения, сделанные в окне
> «Командная строка» (Modbus-консоль). Применяется в любой версии проекта
> (нативной и браузерной) одинаково — кроме `serial-manager.ts`, где
> транспорт зависит от платформы.

**Последнее обновление:** 2026-09-30

---

## Что было добавлено

1. **Эхо команд** — в чёрное поле дублируется каждая поданная команда
   с префиксом `[You]`, ответ — `[Ok]` (зелёный), ошибка/таймаут — `[Err]` (красный).
2. **История уникальных команд** — выпадающий список над полем ввода
   (нативный `<datalist>`). Сохраняется в `localStorage`, лимит — 50 команд,
   самая свежая сверху.
3. **Кнопка «Удалить историю»** — в панели controls, между `MODE` и `Clear`.
   По клику — диалог подтверждения.
4. **Диагностика ответов** — 4 состояния: `ok`, `bad_crc`, `too_short`, `timeout`.
5. **Перетаскивание окна за заголовок** — окно можно перемещать мышью
   за серую полосу с названием «Командная строка». При каждом открытии
   позиция сбрасывается, окно по центру.
6. **z-index диалогов** — поднят с 10000 до 12000, чтобы окна подтверждения
   не скрывались под `cmdline-overlay` (z-index 11700).

---

## Файлы, затронутые изменениями

| Файл | Что изменено |
|---|---|
| `index.html` | Разметка `#cmdlineOverlay`: кнопка «Удалить историю», `list` + `<datalist>` у поля ввода |
| `src/css/cmdline.css` | Стили `.cmdline-history-btn`, `.cmdline-line`, `.cmdline-prefix*`, `.cmdline-text`, `cursor: move` для header |
| `src/ui/cmdline-ui.ts` | Полностью переписан: история, эхо, диагностика ответов, перетаскивание окна |
| `src/serial/serial-manager.ts` | Новый метод `executeTransactionVerbose`, тип `TransactionResult`, приватный `_transaction` |
| `src/ui/confirm-dialog.ts` | `z-index` поднят до 12000 (в 3 местах) |

---

## 1. `index.html` — разметка окна

Найти `#cmdlineOverlay` (≈ строка 340). Заменить блок целиком:

```html
<div id="cmdlineOverlay" class="cmdline-overlay hidden">
  <div class="cmdline-window">
    <div class="cmdline-header">
      <span class="cmdline-header-title">Командная строка</span>
      <button id="cmdlineCloseBtn" class="cmdline-close-btn" type="button" title="Закрыть">✕</button>
    </div>
    <div class="cmdline-controls">
      <span class="cmdline-label">BUS</span>
      <select id="cmdlineBusSelect" class="cmdline-select">
        <option value="RTU">MODBUS RTU</option>
        <option value="TSP">MODBUS TCP</option>
      </select>
      <span class="cmdline-label">BPS</span>
      <select id="cmdlineBpsSelect" class="cmdline-select">
        <option value="1200">1200</option>
        <option value="2400">2400</option>
        <option value="4800">4800</option>
        <option value="9600">9600</option>
        <option value="19200">19200</option>
        <option value="38400">38400</option>
        <option value="57600">57600</option>
        <option value="115200" selected>115200</option>
        <option value="230400">230400</option>
        <option value="460800">460800</option>
        <option value="921600">921600</option>
      </select>
      <span class="cmdline-label">FE</span>
      <input id="cmdlineFeInput" class="cmdline-fe-input" type="text" value="20" />
      <span class="cmdline-label">MODE</span>
      <select id="cmdlineModeSelect" class="cmdline-select">
        <option value="HEX">HEX</option>
        <option value="ASCII">ASCII</option>
        <option value="ASCII_FILTER">ASCII Filter</option>
      </select>
      <button id="cmdlineClearHistoryBtn" class="cmdline-history-btn" type="button" title="Удалить историю команд">Удалить историю</button>
      <button id="cmdlineClearBtn" class="cmdline-clear-btn" type="button">Clear</button>
    </div>
    <div id="cmdlineOutput" class="cmdline-output"></div>
    <div class="cmdline-input-row">
      <input id="cmdlineInput" class="cmdline-input" type="text" spellcheck="false" autocomplete="off" list="cmdlineHistory"/>
      <datalist id="cmdlineHistory"></datalist>
    </div>
  </div>
</div>
```

**Важно:** `#cmdlineHistory` — `<datalist>`, не `<div>`. Нативные `<option>` внутри стилизуются слабо, поэтому в CSS есть попытка уменьшить интервал — работает не во всех webview.

---

## 2. `src/css/cmdline.css` — стили

### 2.1. Полностью заменить блок `.cmdline-output`

```css
.cmdline-output {
    flex: 1 !important;
    background: #000000 !important;
    color: #ffffff !important;
    font-family: 'Courier New', monospace !important;
    font-size: 13px !important;
    line-height: 1.45 !important;
    padding: 8px 10px !important;
    margin: 0 !important;
    overflow-y: auto !important;
}

/* Одна строка вывода. Префикс — слева, текст переносится
   с выравниванием под первым словом (flex + align-items: flex-start). */
.cmdline-line {
    display: flex !important;
    align-items: flex-start !important;
    gap: 6px !important;
    margin: 0 !important;
    padding: 0 !important;
}

.cmdline-prefix {
    flex-shrink: 0 !important;
    font-weight: 600 !important;
    white-space: nowrap !important;
}

.cmdline-prefix-you { color: #b0b0b0 !important; }
.cmdline-prefix-ok  { color: #3ddc84 !important; }
.cmdline-prefix-err { color: #ff5555 !important; }

.cmdline-text {
    min-width: 0 !important;
    white-space: pre-wrap !important;
    word-break: break-all !important;
}
```

### 2.2. Заменить блок `.cmdline-header` — добавляем `cursor: move` и `user-select: none`

```css
.cmdline-header {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    padding: 6px 10px !important;
    background: #d8d8d8 !important;
    border-bottom: 1px solid #bbb !important;
    margin: 0 !important;
    cursor: move !important;      /* весь заголовок — ручка перетаскивания */
    user-select: none !important; /* не выделять текст при drag */
}

/* Кнопка закрытия не должна инициировать перетаскивание */
.cmdline-close-btn {
    cursor: pointer !important;
}
```

### 2.3. Добавить стили кнопки «Удалить историю»

Вставить после `.cmdline-clear-btn:hover`:

```css
.cmdline-history-btn {
    padding: 3px 10px !important;
    font-family: 'Segoe UI', Arial, sans-serif !important;
    font-size: 12px !important;
    background: #ffffff !important;
    color: #333333 !important;
    border: 1px solid #999 !important;
    border-radius: 3px !important;
    cursor: pointer !important;
}

.cmdline-history-btn:hover {
    background: #e8e8e8 !important;
}
```

### 2.4. Добавить попытку стилизовать `<datalist>` (в конец файла)

```css
/* Пункты выпадающего списка истории (нативный datalist).
   В большинстве webview padding/line-height на <option> игнорируются —
   это ограничение движка, а не ошибка в CSS. */
#cmdlineHistory option,
datalist option {
    padding: 0 !important;
    margin: 0 !important;
    line-height: 1 !important;
    min-height: 0 !important;
    font-size: 13px !important;
}
```

---

## 3. `src/ui/cmdline-ui.ts` — вся логика

**Файл переписывается целиком.** Платформо-независим — в браузерной версии работает так же, как в нативной, потому что транспорт — `serialManager.executeTransactionVerbose`, который у каждой версии свой.

```ts
// src/ui/cmdline-ui.ts
/**
 * Командная строка Modbus (инструмент продвинутого пользователя).
 *
 * - пользователь вводит кадр БЕЗ CRC — CRC16 дописывается автоматически;
 * - в чёрное поле эхо поданной команды выводится с префиксом [You],
 *   ответ контроллера — с [Ok] (зелёный), ошибка/таймаут — с [Err] (красный);
 * - в поле ввода доступна история уникальных команд (datalist),
 *   сохраняется в localStorage между запусками приложения, лимит — 50;
 * - окно перетаскивается за заголовок; позиция сбрасывается при открытии;
 * - BPS в окне автономный: при открытии запоминается скорость основного
 *   соединения, при закрытии окна — восстанавливается;
 * - ничего больше (осциллограф, таблица) не останавливается.
 */
import { serialManager, calculateCRC } from '../serial/serial-actions.js';
import { showConfirmDialog } from './confirm-dialog.js';

type ModeType = 'HEX' | 'ASCII' | 'ASCII_FILTER';

const HISTORY_KEY = 'tauri-ajuster:cmdline-history';
const HISTORY_LIMIT = 50;

let savedBaudRate: number | null = null;

// ─── Состояние перетаскивания окна ──────────────────────────
// Смещение окна относительно центра экрана (в пикселях).
// Применяется через CSS transform: translate(...) — не ломает flex-центрирование
// родителя и легко сбрасывается при каждом открытии окна.
let dragOffsetX = 0;
let dragOffsetY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

// ─── История команд ─────────────────────────────────────────

function loadHistory(): string[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((x): x is string => typeof x === 'string');
    } catch {
        return [];
    }
}

function saveHistory(items: string[]): void {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
    } catch (err) {
        console.warn('[cmdline] Не удалось сохранить историю:', err);
    }
}

function renderHistoryDatalist(): void {
    const datalist = document.getElementById('cmdlineHistory') as HTMLDataListElement | null;
    if (!datalist) return;
    datalist.innerHTML = '';
    for (const item of loadHistory()) {
        const opt = document.createElement('option');
        opt.value = item;
        datalist.appendChild(opt);
    }
}

function addToHistory(cmd: string): void {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    const items = loadHistory();
    const filtered = items.filter((x) => x !== trimmed);
    filtered.unshift(trimmed);
    saveHistory(filtered.slice(0, HISTORY_LIMIT));
    renderHistoryDatalist();
}

function clearHistory(): void {
    saveHistory([]);
    renderHistoryDatalist();
}

// ─── Перетаскивание окна за заголовок ───────────────────────

/**
 * Применяет текущее смещение к окну через transform.
 * Не трогает position/left/top — работает поверх flex-центрирования.
 */
function applyDragTransform(): void {
    const win = document.querySelector<HTMLElement>('.cmdline-window');
    if (!win) return;
    if (dragOffsetX === 0 && dragOffsetY === 0) {
        win.style.transform = '';
    } else {
        win.style.transform = `translate(${dragOffsetX}px, ${dragOffsetY}px)`;
    }
}

/**
 * Вешает обработчики перетаскивания на заголовок окна.
 * Вызывается один раз при инициализации UI.
 */
function setupCmdlineDragging(): void {
    const header = document.querySelector<HTMLElement>('#cmdlineOverlay .cmdline-header');
    const win = document.querySelector<HTMLElement>('.cmdline-window');
    if (!header || !win) return;

    header.addEventListener('mousedown', (e: MouseEvent) => {
        const target = e.target as HTMLElement;

        // Любая интерактивная цель внутри header (кнопки, поля) —
        // не начинаем drag и НЕ вызываем preventDefault, чтобы не
        // подавить click на кнопке закрытия. В WebView2 preventDefault
        // на mousedown иногда блокирует последующий click у соседних
        // элементов — из-за этого окно переставало закрываться.
        if (target.closest('button, input, select, a, textarea')) return;

        isDragging = true;
        dragStartX = e.clientX - dragOffsetX;
        dragStartY = e.clientY - dragOffsetY;
        // Запрет выделения на время drag — через CSS-свойство, без preventDefault.
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
        if (!isDragging) return;
        dragOffsetX = e.clientX - dragStartX;
        dragOffsetY = e.clientY - dragStartY;
        applyDragTransform();
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.userSelect = '';
    });
}

// ────────────────────────────────────────────────────────────
// Инициализация UI
// ────────────────────────────────────────────────────────────

export function initCmdlineUI(): void {
    renderHistoryDatalist();
    setupCmdlineDragging();

    document.getElementById('cmdlineBtn')?.addEventListener('click', () => {
        openCmdline();
    });

    document.getElementById('cmdlineCloseBtn')?.addEventListener('click', () => {
        closeCmdline();
    });

    document.getElementById('cmdlineClearBtn')?.addEventListener('click', () => {
        const output = document.getElementById('cmdlineOutput');
        if (output) output.textContent = '';
    });

    document.getElementById('cmdlineClearHistoryBtn')?.addEventListener('click', async () => {
        const ok = await showConfirmDialog('Удалить всю историю команд?');
        if (ok) clearHistory();
    });

    const bpsSelect = document.getElementById('cmdlineBpsSelect') as HTMLSelectElement | null;
    bpsSelect?.addEventListener('change', () => {
        const baudRate = parseInt(bpsSelect.value, 10);
        if (!isNaN(baudRate)) {
            void changeBaudRate(baudRate);
        }
    });

    const input = document.getElementById('cmdlineInput') as HTMLInputElement | null;
    input?.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const bus = (document.getElementById('cmdlineBusSelect') as HTMLSelectElement | null)?.value ?? 'RTU';
        const modeRaw = (document.getElementById('cmdlineModeSelect') as HTMLSelectElement | null)?.value ?? 'HEX';
        const mode = (modeRaw === 'ASCII' || modeRaw === 'ASCII_FILTER' ? modeRaw : 'HEX') as ModeType;
        const frameText = (input.value ?? '').trim();
        input.value = '';
        void sendCommand(frameText, bus, mode);
    });
}

// ────────────────────────────────────────────────────────────
// Открытие / закрытие окна
// ────────────────────────────────────────────────────────────

function openCmdline(): void {
    const overlay = document.getElementById('cmdlineOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');

    // Сбрасываем позицию окна — при каждом открытии оно по центру.
    dragOffsetX = 0;
    dragOffsetY = 0;
    applyDragTransform();

    const mainBps = document.getElementById('baudSelect') as HTMLSelectElement | null;
    savedBaudRate = mainBps ? parseInt(mainBps.value, 10) || 115200 : 115200;

    const bpsSelect = document.getElementById('cmdlineBpsSelect') as HTMLSelectElement | null;
    if (bpsSelect) bpsSelect.value = String(savedBaudRate);

    const output = document.getElementById('cmdlineOutput');
    if (output) {
        output.textContent = '';
        appendLine(output, 'Command Line (tool for advanced user)');
        appendLine(output, 'WEB Ajuster v0.1');
        appendLine(output, 'www.intmash.ru');
    }

    const input = document.getElementById('cmdlineInput') as HTMLInputElement | null;
    setTimeout(() => input?.focus(), 100);
}

function closeCmdline(): void {
    const overlay = document.getElementById('cmdlineOverlay');
    if (!overlay) return;
    overlay.classList.add('hidden');

    if (savedBaudRate !== null) {
        void changeBaudRate(savedBaudRate);
        savedBaudRate = null;
    }
}

async function changeBaudRate(baudRate: number): Promise<void> {
    const serial = (serialManager as unknown as {
        serial?: { updateBaudRate?: (b: number) => Promise<void> };
    }).serial;
    if (serial && typeof serial.updateBaudRate === 'function') {
        await serial.updateBaudRate(baudRate);
    }
}

// ────────────────────────────────────────────────────────────
// Отправка кадра и вывод ответа
// ────────────────────────────────────────────────────────────

async function sendCommand(frameText: string, bus: string, mode: ModeType): Promise<void> {
    const output = document.getElementById('cmdlineOutput');
    if (!output || !frameText) return;

    appendLine(output, frameText, '[You]', 'cmdline-prefix-you');

    if (bus === 'TCP') {
        appendLine(output, 'MODBUS TCP не реализован в WEB-версии.', '[Err]', 'cmdline-prefix-err');
        return;
    }

    const bytes = parseHexFrame(frameText);
    if (!bytes) {
        appendLine(output, 'Неправильный формат запроса', '[Err]', 'cmdline-prefix-err');
        return;
    }

    addToHistory(frameText);

    const crc = calculateCRC(bytes);
    const packet = new Uint8Array(bytes.length + 2);
    packet.set(bytes, 0);
    packet[bytes.length] = crc & 0xff;
    packet[bytes.length + 1] = (crc >> 8) & 0xff;

    try {
        const result = await serialManager.executeTransactionVerbose(packet, 1000);

        if (result.kind === 'ok') {
            appendLine(output, formatReply(result.bytes, mode), '[Ok]', 'cmdline-prefix-ok');
        } else if (result.kind === 'bad_crc') {
            const hexAll = formatReply(result.bytes, 'HEX');
            appendLine(output, `Ответ с неверным CRC: ${hexAll}`, '[Err]', 'cmdline-prefix-err');
        } else if (result.kind === 'too_short') {
            const hexAll = formatReply(result.bytes, 'HEX');
            appendLine(output, `Ответ короче 4 байт: ${hexAll}`, '[Err]', 'cmdline-prefix-err');
        } else if (result.kind === 'timeout') {
            appendLine(output, 'Нет ответа от устройства (таймаут 1000 мс)', '[Err]', 'cmdline-prefix-err');
        } else if (result.kind === 'error') {
            appendLine(output, 'Ошибка транзакции: ' + result.message, '[Err]', 'cmdline-prefix-err');
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appendLine(output, 'Неожиданная ошибка: ' + message, '[Err]', 'cmdline-prefix-err');
    }
}

function parseHexFrame(text: string): Uint8Array | null {
    const cleaned = text.replace(/[\s,;]+/g, '').trim();
    if (!cleaned) return null;
    if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) return null;
    const bytes: number[] = [];
    for (let i = 0; i < cleaned.length; i += 2) {
        bytes.push(parseInt(cleaned.substring(i, i + 2), 16));
    }
    return bytes.length > 0 ? new Uint8Array(bytes) : null;
}

function formatReply(reply: Uint8Array, mode: ModeType): string {
    if (mode === 'HEX') {
        return Array.from(reply).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    }
    if (mode === 'ASCII') {
        return Array.from(reply).map((b) => String.fromCharCode(b)).join('');
    }
    return Array.from(reply)
        .filter((b) => b >= 0x20 && b < 0x7f)
        .map((b) => String.fromCharCode(b))
        .join('');
}

function appendLine(
    output: HTMLElement,
    text: string,
    prefix?: string,
    prefixClass?: string,
): void {
    const line = document.createElement('div');
    line.className = 'cmdline-line';

    if (prefix) {
        const prefixEl = document.createElement('span');
        prefixEl.className = 'cmdline-prefix' + (prefixClass ? ' ' + prefixClass : '');
        prefixEl.textContent = prefix;
        line.appendChild(prefixEl);
    }

    const textEl = document.createElement('span');
    textEl.className = 'cmdline-text';
    textEl.textContent = text;
    line.appendChild(textEl);

    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}
```

---

## 4. `src/serial/serial-manager.ts` — диагностика

### 4.1. Добавить импорт и тип

В начало файла, после `import type { ISerialPort }`:

```ts
import { calculateCRC } from './serial-actions.js';

export type TransactionResult =
    | { kind: 'ok'; bytes: Uint8Array }
    | { kind: 'bad_crc'; bytes: Uint8Array; expected: number; actual: number }
    | { kind: 'too_short'; bytes: Uint8Array }
    | { kind: 'timeout' }
    | { kind: 'error'; message: string };
```

### 4.2. Заменить методы класса

Существующий `executeTransaction` разбить на три: `_transaction` (приватный), `executeTransaction` (старый API, используется `read-loop`, `device_updater`, `modbus-scanner`), `executeTransactionVerbose` (новый, для `cmdline-ui`).

```ts
private async _transaction(packet: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    const oldLock = this.lock;
    let release: () => void = () => { };
    this.lock = new Promise((r) => { release = r; });
    await oldLock;

    const port = this.serial;

    try {
        if (!port) {
            throw new Error("[SerialManager] Порт не инициализирован для транзакции.");
        }
        const dataArray = Array.from(packet);
        const response = await invoke<number[]>('serial_transaction', {
            data: dataArray,
            timeoutMs,
        });
        return new Uint8Array(response);
    } catch (err) {
        console.error("[SerialManager] Ошибка транзакции:", err);
        const msg = err instanceof Error ? err.message : String(err);
        const isFatal =
            msg.includes('фатальная ошибка') ||
            msg.includes('os error 22') ||
            msg.includes('Устройство не опознает команду') ||
            msg.includes('Порт не открыт');
        if (isFatal && port) {
            const maybe = port as unknown as { notifyDisconnect?: () => void };
            if (typeof maybe.notifyDisconnect === 'function') {
                maybe.notifyDisconnect();
            }
        }
        throw err;
    } finally {
        release();
    }
}

public async executeTransaction(
    packet: Uint8Array,
    _checkCompleteFn: CheckCompleteFn,
    timeoutMs: number = 1000
): Promise<Uint8Array> {
    return this._transaction(packet, timeoutMs);
}

public async executeTransactionVerbose(
    packet: Uint8Array,
    timeoutMs: number = 1000
): Promise<TransactionResult> {
    let bytes: Uint8Array;
    try {
        bytes = await this._transaction(packet, timeoutMs);
    } catch (err) {
        return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    }

    if (bytes.length === 0) return { kind: 'timeout' };
    if (bytes.length < 4) return { kind: 'too_short', bytes };

    const payload = bytes.slice(0, bytes.length - 2);
    const expected = calculateCRC(payload);
    const actual = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);

    if (expected !== actual) {
        return { kind: 'bad_crc', bytes, expected, actual };
    }
    return { kind: 'ok', bytes };
}
```

---

## 5. `src/ui/confirm-dialog.ts` — z-index

В трёх местах (`showConfirmDialog`, `showFailedParamsList`, `showAddressDialog`) заменить:

```ts
overlay.style.zIndex = '10000';
```

на:

```ts
overlay.style.zIndex = '12000';
```

Причина: `cmdline-overlay` имеет `z-index: 11700`. Диалоги с 10000 оказывались под ним, и пользователь не видел подтверждения «Удалить историю?».

---

## Чек-лист проверки в новой версии

После переноса всех правок:

1. `npm run lint` — без ошибок.
2. `npm run tauri dev` (или `npm run dev` для браузерной).
3. Открыть окно «Командная строка».
4. **Эхо:** отправить `01 03 00 00 00 01`. В поле должно появиться:
   ```
   [You] 01 03 00 00 00 01
   [Ok] 01 03 02 XX XX YY YY
   ```
5. **Ошибка формата:** отправить `83475gfg` → `[You] 83475gfg` + `[Err] Неправильный формат запроса`. В историю не попадает.
6. **Таймаут:** отправить `F7 03 00 00 00 01` → `[Err] Нет ответа от устройства (таймаут 1000 мс)`.
7. **История:** после нескольких валидных команд начать вводить `01` — должен появиться выпадающий список с фильтром.
8. **Кнопка «Удалить историю»** — вызвать, подтвердить Yes, проверить что история пуста.
9. **Перезапуск** — история должна сохраниться (localStorage).
10. **Диалоги** — проверить, что подтверждения не прячутся под окнами.
11. **Закрытие окна** — клик по крестику `✕` закрывает окно.
12. **Перетаскивание** — окно двигается за заголовок, но не за поле ввода / чёрное поле / селекты.
13. **Крестик после перетаскивания** — закрывает окно.
14. **Позиция после закрытия** — при следующем открытии окно снова по центру.

---

## Если браузерная версия — отдельный репозиторий

Транспорт (`serial-manager.ts`) в браузерной версии может быть другим (Web Serial API вместо Tauri-команды). Тогда:

- Разделы **1, 2, 3, 5** применяются как есть — они платформо-независимы.
- Раздел **4** нужно адаптировать: тип `TransactionResult` и логику анализа (timeout / bad_crc / too_short / ok) встроить в браузерный аналог `serial-manager`. Ключевая идея — возвращать не просто байты, а структурированный результат с полем `kind`.

Если в браузерной версии нет метода `executeTransactionVerbose` — добавьте его, сохранив старый `executeTransaction` как обёртку. Это гарантирует, что остальные модули (`read-loop`, `device_updater`) не сломаются.