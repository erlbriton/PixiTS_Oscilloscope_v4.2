// src/ini-manager/table-editor.ts

import { serialManager, calculateCRC } from '../serial/serial-actions.js';
import { parseRegisterAddress, float32ToHex } from './tree-core.js';
import type { IniConfig } from '../core/ini/index.js';
import { planControllerWrite } from './tree-core.js';
import { showIdModal } from '../ui/ui.js';
import { writeRegistersFC16, readHoldingRegistersFC03 } from '../serial/serial-actions.js';

/** Ячейка с активным инлайн-редактором */
interface EditableCell extends HTMLElement {
    blurEditor?: () => void;
}

/** Тип функции updateRowValues из tree-ui.ts */
type UpdateRowValuesFn = (
    rowElement: HTMLTableRowElement,
    rowParts: string[],
    rowDataType: string,
    rowScale: number,
    rowHexIndex: number,
    rowOriginalHexLen: number,
    rowPrmListOptions: Record<string, string>,
    argHexToFloat32: (hexStr: string) => number,
    argFloat32ToHex: (floatVal: number, padLen?: number) => string,
    colIndex?: number,
) => void;

export interface TableEditorState {
    slaveAddress?: number;
    isPolling?: boolean;
    currentIniConfig?: IniConfig | null;
}

/**
 * Очистка активных ячеек редактора.
 */
export function clearAnyActiveCellEditors(): void {
    document.querySelectorAll<EditableCell>('.is-editing-cell').forEach(el => {
        if (el.blurEditor) el.blurEditor();
    });
}

/**
 * Заглушка редактора hex-ячейки.
 * Типизирована для совместимости с renderModbusTable.
 */
// src/ini-manager/table-editor.ts

// ... (импорты остаются прежними)

/**
 * Инициализация редактора hex-ячейки.
 * Добавлены параметры stateObj и colIndex для поддержки редактирования Контроллера и нативной архитектуры.
 */
export function initHexCellEditor(
    cell: HTMLElement,
    row: HTMLTableRowElement,
    parts: string[],
    hexIndex: number,
    updateFn: UpdateRowValuesFn,
    dataType: string,
    scale: number,
    originalHexLen: number,
    prmListOptions: Record<string, string>,
    stateObj: TableEditorState, // <--- НОВЫЙ АРГУМЕНТ (10-й)
    colIndex: number            // <--- НОВЫЙ АРГУМЕНТ (11-й)
): void {
    cell.setAttribute('data-edit-type', 'hex');
    cell.setAttribute('data-col-index', colIndex.toString());

    cell.addEventListener('dblclick', (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        // Вызываем настоящий редактор
        startInlineEdit(cell, stateObj);
    });
}

/**
 * Инициализация редактора физической ячейки.
 * Добавлены параметры stateObj и colIndex.
 */
export function initPhysicalCellEditor(
    cell: HTMLElement,
    row: HTMLTableRowElement,
    parts: string[],
    dataType: string,
    scale: number,
    hexIndex: number,
    originalHexLen: number,
    prmListOptions: Record<string, string>,
    updateFn: UpdateRowValuesFn,
    hexToFloat32Fn: (hexStr: string) => number,
    float32ToHexFn: (floatVal: number, padLen?: number) => string,
    stateObj: TableEditorState, // <--- НОВЫЙ АРГУМЕНТ (12-й)
    colIndex: number            // <--- НОВЫЙ АРГУМЕНТ (13-й)
): void {
    cell.setAttribute('data-edit-type', 'phys');
    cell.setAttribute('data-col-index', colIndex.toString());

    cell.addEventListener('dblclick', (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        // Вызываем настоящий редактор
        startInlineEdit(cell, stateObj);
    });
}

/**
 * Инициализация слушателей инлайн-редактирования.
 */
export function initTableEditor(containerOrTableId: string, stateObj: TableEditorState): void {
    try {
        const container = typeof containerOrTableId === 'string'
            ? document.getElementById(containerOrTableId)
            : containerOrTableId;

        if (!container) return;

        container.addEventListener('dblclick', (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target) return;
            const editableCell = target.closest<HTMLElement>('td.editable-cell');
            if (editableCell) startInlineEdit(editableCell, stateObj);
        });

        console.log("[TableEditor] Инлайн-редактор таблицы подключен.");
    } catch (err) {
        console.error("[TableEditor] Ошибка инициализации:", err);
    }
}

export async function sendModbusWriteCommand(
    slaveAddr: number,
    startReg: number,
    words: number[]
): Promise<boolean> {
    if (!words || words.length === 0) return false;

    if (words.length === 1) {
        const word = words[0] & 0xFFFF;
        const body = new Uint8Array([
            slaveAddr & 0xFF,
            0x06,
            (startReg >> 8) & 0xFF,
            startReg & 0xFF,
            (word >> 8) & 0xFF,
            word & 0xFF
        ]);
        const crc = calculateCRC(body);
        const packet = new Uint8Array(8);
        packet.set(body, 0);
        packet[6] = crc & 0xFF;
        packet[7] = (crc >> 8) & 0xFF;

        const checkComplete = (buf: Uint8Array) => buf.length >= 8;

        try {
            const response = await serialManager.executeTransaction(packet, checkComplete, 1000);
            return response.length >= 8 && response[1] === 0x06;
        } catch (err) {
            console.error("[TableEditor] Ошибка записи FC 06:", err);
            return false;
        }
    } else {
        const regCount = words.length;
        const byteCount = regCount * 2;
        const body = new Uint8Array(7 + byteCount);
        body[0] = slaveAddr & 0xFF;
        body[1] = 0x10;
        body[2] = (startReg >> 8) & 0xFF;
        body[3] = startReg & 0xFF;
        body[4] = (regCount >> 8) & 0xFF;
        body[5] = regCount & 0xFF;
        body[6] = byteCount & 0xFF;

        for (let i = 0; i < regCount; i++) {
            const word = words[i] & 0xFFFF;
            body[7 + i * 2] = (word >> 8) & 0xFF;
            body[8 + i * 2] = word & 0xFF;
        }

        const crc = calculateCRC(body);
        const packet = new Uint8Array(body.length + 2);
        packet.set(body, 0);
        packet[body.length] = crc & 0xFF;
        packet[body.length + 1] = (crc >> 8) & 0xFF;

        const checkComplete = (buf: Uint8Array) => buf.length >= 8;

        try {
            const response = await serialManager.executeTransaction(packet, checkComplete, 1000);
            return response.length >= 8 && response[1] === 0x10;
        } catch (err) {
            console.error("[TableEditor] Ошибка записи FC 16:", err);
            return false;
        }
    }
}

/**
 * Обновляет класс row-mismatch (красная подсветка расхождения с Базой)
 * для строки таблицы. Для TPrmList сравнивает текст опции, для остальных — хекс.
 */
function updateMismatchClass(tr: HTMLTableRowElement, dataType: string): void {
    const tds = tr.querySelectorAll('td');
    let mismatch = false;

    if (dataType === 'TPRMLIST') {
        // Для TPrmList сравниваем текст опции из <div class="prm-val-display">,
        // потому что в ячейке может быть скрытый <select>, и td.textContent
        // вернёт лишний текст из него.
        const getDisplayText = (td: Element): string => {
            const display = td.querySelector('.prm-val-display');
            if (display) return (display.textContent || '').trim();
            return (td.textContent || '').trim();
        };
        const baseText = tds[4] ? getDisplayText(tds[4]) : '';
        const liveText = tds[6] ? getDisplayText(tds[6]) : '';
        mismatch = baseText !== '—' && liveText !== '—' && baseText !== '' && liveText !== '' && baseText !== liveText;
    } else {
        // Для остальных типов сравниваем как хекс
        const parseHexValue = (hexStr: string): number | null => {
            if (!hexStr) return null;
            const clean = hexStr.trim().toUpperCase().replace(/^X/, '');
            if (!clean || !/^[0-9A-F]+$/.test(clean)) return null;
            const n = parseInt(clean, 16);
            return isNaN(n) ? null : n;
        };

        const hexBaseRaw = tds[4] ? (tds[4].textContent || '').trim() : '';
        const hexLiveRaw = tds[6] ? (tds[6].textContent || '').trim() : '';
        const valBase = parseHexValue(hexBaseRaw);
        const valLive = parseHexValue(hexLiveRaw);
        mismatch =
            hexBaseRaw !== '—' &&
            hexLiveRaw !== '—' &&
            valBase !== null &&
            valLive !== null &&
            valBase !== valLive;
    }
    tr.classList.toggle('row-mismatch', mismatch);
}

/**
 * Обработка значения TPrmList в БАЗЕ (колонки 4 и 5).
 * Полностью повторяет логику Контроллера для TPrmList,
 * но БЕЗ отправки по Modbus — только обновление в памяти браузера.
 */
async function processBasePrmListWrite(
    tr: HTMLTableRowElement,
    selectedHex: string,
    colIndex: number
): Promise<boolean> {
    const byteValue = parseInt(selectedHex.replace(/^(x|0x)/i, ''), 16);
    if (isNaN(byteValue)) return false;

    let parts: string[] = [];
    try {
        parts = JSON.parse(tr.dataset.parts || '[]');
    } catch {
        parts = [];
    }

    // Находим текст опции по численному значению (игнорируем ведущие нули)
    let optionText = selectedHex;
    for (const p of parts) {
        const part = (p || '').trim();
        if (part.includes('#')) {
            const [h, t] = part.split('#');
            if (h && t && parseInt(h.slice(1), 16) === byteValue) {
                optionText = t;
                break;
            }
        }
    }

    // ВАЖНО: НЕ пишем в parts[hexIndex] — этот слот принадлежит живому значению
    // Контроллера. Иначе редактор Контроллера посчитает, что текущее значение уже
    // равно значению Базы, и защита "selectedHex === currentHex" запретит запись.
    // База хранится только в тексте ячеек 4/5 (в памяти браузера).

    // Обновляем обе ячейки Базы (4 и 5) текстом опции
    const tds = tr.querySelectorAll('td');
    const setCellText = (idx: number) => {
        if (idx < 0 || idx >= tds.length) return;
        const td = tds[idx];
        const display = td.querySelector('.prm-val-display');
        if (display) {
            display.textContent = optionText;
        } else {
            td.innerHTML = `<div class="prm-val-display">${optionText}</div>`;
        }
    };
    setCellText(4);
    setCellText(5);

    // Пересчитываем подсветку расхождения с Контроллером
    updateMismatchClass(tr, 'TPRMLIST');

    const activeCell = tds[colIndex];
    if (activeCell) {
        activeCell.classList.add('write-success');
        setTimeout(() => activeCell.classList.remove('write-success'), 1000);
    }

    console.log(`[BASE TPrmList] Значение обновлено в памяти: ${optionText} (без отправки по Modbus).`);
    return true;
}

//  Обработка значения Контроллера (колонки 6 и 7).
//  * Шаг 3: валидация ввода через чистую функцию planControllerWrite.
//  * Отправка (FC16), обратное чтение (FC03) и сравнение — в следующих шагах.
//  */
async function processControllerWrite(
    tr: HTMLTableRowElement,
    editType: string,
    newValueStr: string,
    stateObj: TableEditorState,
    colIndex: number
): Promise<boolean> {
    const dataType = (tr.getAttribute('data-type') || '').toUpperCase();
    const sub = tr.getAttribute('data-sub') || '';

    let parts: string[] = [];
    try {
        parts = JSON.parse(tr.dataset.parts || '[]');
    } catch (e) {
        console.error('[TableEditor] Ошибка разбора data-parts:', e);
        return false;
    }

    let scale = 1.0;
    if (parts.length > 6 && parts[6]) {
        const parsedScale = parseFloat(parts[6].replace(',', '.'));
        if (!isNaN(parsedScale) && parsedScale !== 0) scale = parsedScale;
    }

    // Для TBYTE и TPRMLIST: модификатор байта (L/H) берём из data-sub, куда его сохранил tree.ts
    let bytePos = '';
    if (dataType === 'TBYTE' || dataType === 'TPRMLIST') {
        bytePos = (sub || '').toUpperCase();
    }

    // Чистая валидация и построение плана записи (без DOM)
    const plan = planControllerWrite(dataType, editType, newValueStr, scale, sub, bytePos);

    // --- ДИАГНОСТИКА TByte и TPrmList (только лог, без изменения логики) ---
    if (dataType === 'TBYTE' || dataType === 'TPRMLIST') {
        let partsRaw: string[] = [];
        try { partsRaw = JSON.parse(tr.dataset.parts || '[]'); } catch { partsRaw = []; }
        
        // Извлекаем опции списка из parts (формат "hex#текст")
        const prmOptions: Record<string, string> = {};
        for (const p of partsRaw) {
            const part = (p || '').trim();
            if (part.includes('#')) {
                const [h, t] = part.split('#');
                if (h && t) {
                    prmOptions[h.toLowerCase()] = t;
                }
            }
        }
        
        console.log(`[CONTROLLER] ${dataType} диагностика:`);
        console.log('  data-reg:', tr.getAttribute('data-reg'));
        console.log('  data-sub:', tr.getAttribute('data-sub'));
        console.log('  data-hex-index:', tr.getAttribute('data-hex-index'));
        console.log('  parts (полный массив):', JSON.stringify(partsRaw));
        console.log('  prmListOptions:', JSON.stringify(prmOptions));
        console.log('  plan:', JSON.stringify(plan));
    }
    // -------------------------------------------------------------

    if (!plan.ok) {
        console.warn(`[CONTROLLER] Некорректное значение: тип=${dataType}, editType=${editType}, value="${newValueStr}"`);
        showIdModal('Некорректное значение');
        return false;
    }

    // Значение валидно. Шаг 4: реальная отправка по FC 0x10.
    const addrStr = tr.getAttribute('data-reg');
    if (!addrStr) return false;
    const reg = parseInt(addrStr, 16);
    if (isNaN(reg)) return false;

    const slaveAddr = (stateObj && stateObj.slaveAddress) ? stateObj.slaveAddress : 0x01;

    if (plan.kind === 'words') {
        console.log(
            `[CONTROLLER] Запись FC16: slave=0x${slaveAddr.toString(16)}, reg=0x${reg.toString(16)}, ` +
            `words=[${plan.words.map((w) => '0x' + w.toString(16)).join(', ')}]`
        );

        // Шаг 7: приостановка фонового опроса (осциллограф) на время serial-транзакций.
        // Паттерн как в device_updater.ts: сохранили флаг, опустили, восстановили в finally.
        const wasPolling = stateObj.isPolling === true;
        if (wasPolling) {
            console.log('[CONTROLLER] Фоновый опрос активен — приостанавливаю на время транзакций...');
            stateObj.isPolling = false;
            // Даём readLoop время завершить текущую итерацию
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        let writeOk = false;
        let readWords: number[] | null = null;

        try {
            writeOk = await writeRegistersFC16(slaveAddr, reg, plan.words);

            if (writeOk) {
                console.log('[CONTROLLER] Запись FC16 подтверждена устройством.');
                readWords = await readHoldingRegistersFC03(slaveAddr, reg, plan.words.length);
            }
        } finally {
            // Восстанавливаем опрос при ЛЮБОМ исходе записи
            if (wasPolling) {
                console.log('[CONTROLLER] Возобновляю фоновый опрос.');
                stateObj.isPolling = true;
            }
        }

        if (!writeOk) {
            console.error('[CONTROLLER] Запись FC16 не удалась (таймаут или исключение).');
            return false;
        }

        if (readWords === null) {
            console.error('[CONTROLLER] Обратное чтение FC03 не удалось (таймаут или исключение).');
            return false;
        }

        console.log(
            `[CONTROLLER] Обратное чтение FC03: reg=0x${reg.toString(16)}, ` +
            `read=[${readWords.map((w) => '0x' + w.toString(16)).join(', ')}]`
        );

        // Шаг 6: сравнение отправленных и прочитанных слов
        const wordsMatch =
            readWords.length === plan.words.length &&
            plan.words.every((w, i) => readWords[i] === w);

        if (!wordsMatch) {
            console.error(
                `[CONTROLLER] НЕСОВПАДЕНИЕ: sent=[${plan.words.map((w) => '0x' + w.toString(16)).join(', ')}], ` +
                `read=[${readWords.map((w) => '0x' + w.toString(16)).join(', ')}]`
            );
            showIdModal('Значение не записалось');
            return false;
        }

        // Значение записано и подтверждено. Обновляем UI ячеек 6 и 7.
        const tds = tr.querySelectorAll('td');

        const updateCellDisplay = (idx: number, val: string) => {
            if (idx < 0 || idx >= tds.length || !val) return;
            const td = tds[idx];
            if (val.startsWith('<div') || val.startsWith('<select')) {
                td.innerHTML = val;
            } else if (val.startsWith('x')) {
                td.textContent = val;
            } else {
                if (!td.innerHTML.includes('prm-val-display')) {
                    td.innerHTML = `<div class="prm-val-display">${val}</div>`;
                } else {
                    const display = td.querySelector('.prm-val-display');
                    if (display) display.textContent = val;
                }
            }
        };

        // Сохраняем новые значения в parts (для пересчёта mismatch и будущих операций)
        let parts: string[] = [];
        try {
            parts = JSON.parse(tr.dataset.parts || '[]');
        } catch {
            parts = [];
        }

        // Обновляем соответствующую пару ячеек (Hex=6, Phys=7 для Контроллера)
        if (plan.newHex) {
            if (parts.length > 6) parts[6] = plan.newHex;
            updateCellDisplay(6, plan.newHex);
        }
        if (plan.newPhys) {
            if (parts.length > 7) parts[7] = plan.newPhys;
            updateCellDisplay(7, plan.newPhys);
        }

        tr.dataset.parts = JSON.stringify(parts);

        // Пересчитываем класс row-mismatch (красная подсветка расхождения с Базой)
        updateMismatchClass(tr, dataType);

        // Зелёная вспышка успеха на отредактированной ячейке
        const activeCell = tds[colIndex];
        if (activeCell) {
            activeCell.classList.add('write-success');
            setTimeout(() => activeCell.classList.remove('write-success'), 1000);
        }

        console.log('[CONTROLLER] Значение успешно записано, подтверждено и синхронизировано.');
        return true;
    }

    // TBYTE (kind === 'byte'): байтовый read-modify-write.
    if (plan.kind === 'byte') {
        const wasPolling = stateObj.isPolling === true;
        if (wasPolling) {
            console.log('[CONTROLLER] TBYTE: Фоновый опрос активен — приостанавливаю на время транзакций...');
            stateObj.isPolling = false;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        let currentWords: number[] | null = null;
        let writeOk = false;
        let readWords: number[] | null = null;

        try {
            // 1) Чтение текущего 16-битного слова
            currentWords = await readHoldingRegistersFC03(slaveAddr, reg, 1);

            if (currentWords === null) {
                console.error('[CONTROLLER] TBYTE: не удалось прочитать текущее слово (таймаут или исключение).');
                return false;
            }

            const currentWord = currentWords[0];
            console.log(
                `[CONTROLLER] TBYTE: reg=0x${reg.toString(16)}, bytePos=${plan.bytePos}, ` +
                `желаемый байт=0x${plan.byteValue.toString(16)}, текущее слово=0x${currentWord.toString(16)}`
            );

            // 2) Modify: заменяем нужный байт, второй не трогаем
            const highByte = (currentWord >> 8) & 0xFF;
            const lowByte = currentWord & 0xFF;
            const newWord = plan.bytePos === 'H'
                ? ((plan.byteValue << 8) | lowByte) & 0xFFFF
                : ((highByte << 8) | plan.byteValue) & 0xFFFF;

            console.log(
                `[CONTROLLER] TBYTE: записываю слово=0x${newWord.toString(16)} ` +
                `(было 0x${currentWord.toString(16)}), другой байт слова без изменений`
            );

            writeOk = await writeRegistersFC16(slaveAddr, reg, [newWord]);

            if (writeOk) {
                // 3) Обратное чтение и проверка байта
                readWords = await readHoldingRegistersFC03(slaveAddr, reg, 1);
            }
        } finally {
            if (wasPolling) {
                console.log('[CONTROLLER] TBYTE: Возобновляю фоновый опрос.');
                stateObj.isPolling = true;
            }
        }

        if (!writeOk) {
            console.error('[CONTROLLER] TBYTE: запись слова по FC16 не удалась (таймаут или исключение).');
            showIdModal('Значение не записалось');
            return false;
        }

        if (readWords === null) {
            console.error('[CONTROLLER] TBYTE: обратное чтение по FC03 не удалось (таймаут или исключение).');
            showIdModal('Значение не записалось');
            return false;
        }

        const readWord = readWords[0];
        const readByte = plan.bytePos === 'H' ? (readWord >> 8) & 0xFF : readWord & 0xFF;

        if (readByte !== plan.byteValue) {
            console.error(
                `[CONTROLLER] TBYTE: НЕСОВПАДЕНИЕ: байт ${plan.bytePos} после записи = 0x${readByte.toString(16)}, ` +
                `ожидалось 0x${plan.byteValue.toString(16)} (прочитано слово=0x${readWord.toString(16)})`
            );
            showIdModal('Значение не записалось');
            return false;
        }

        console.log('[CONTROLLER] TBYTE: байт записан и проверен.');

        // Обновление UI ячеек 6 и 7 + пересчёт row-mismatch.
        const tds = tr.querySelectorAll('td');
        const hexIndex = parseInt(tr.getAttribute('data-hex-index') || '-1', 10);

        const updateCellDisplay = (idx: number, val: string) => {
            if (idx < 0 || idx >= tds.length || !val) return;
            const td = tds[idx];
            if (val.startsWith('<div') || val.startsWith('<select')) {
                td.innerHTML = val;
            } else if (val.startsWith('x')) {
                td.textContent = val;
            } else {
                if (!td.innerHTML.includes('prm-val-display')) {
                    td.innerHTML = `<div class="prm-val-display">${val}</div>`;
                } else {
                    const display = td.querySelector('.prm-val-display');
                    if (display) display.textContent = val;
                }
            }
        };

        // Для TBYTE и TPRMLIST: в parts[hexIndex] хранится hex байта (x0A)
        const byteHex = 'x' + plan.byteValue.toString(16).toUpperCase().padStart(2, '0');

        if (hexIndex >= 0 && hexIndex < parts.length) {
            parts[hexIndex] = byteHex;
        }

        tr.dataset.parts = JSON.stringify(parts);

        // Для TPRMLIST: в обеих ячейках показываем текст опции (например, "115200"),
        // а не хекс или число.
        if (dataType === 'TPRMLIST') {
            let optionText = byteHex; // fallback, если опция не найдена
            for (const p of parts) {
                const part = (p || '').trim();
                if (part.includes('#')) {
                    const [h, t] = part.split('#');
                    if (h && t && h.toLowerCase() === byteHex.toLowerCase()) {
                        optionText = t;
                        break;
                    }
                }
            }
            updateCellDisplay(6, optionText);
            updateCellDisplay(7, optionText);
        } else {
            // Для TBYTE: в хекс-ячейке — хекс, в физикал — число
            updateCellDisplay(6, byteHex);
            updateCellDisplay(7, plan.newPhys);
        }

        // Пересчитываем класс row-mismatch (красная подсветка расхождения с Базой)
        updateMismatchClass(tr, dataType);

        // Зелёная вспышка успеха на отредактированной ячейке
        const activeCell = tds[colIndex];
        if (activeCell) {
            activeCell.classList.add('write-success');
            setTimeout(() => activeCell.classList.remove('write-success'), 1000);
        }

        console.log('[CONTROLLER] TBYTE: Значение успешно записано, подтверждено и синхронизировано.');
        return true;
    }

    // TBIT (kind === 'bit'): схема read-modify-write.
    // Приостановка фонового опроса на время всех трёх транзакций (чтение, запись, проверка).
    const wasPolling = stateObj.isPolling === true;
    if (wasPolling) {
        console.log('[CONTROLLER] TBIT: Фоновый опрос активен — приостанавливаю на время транзакций...');
        stateObj.isPolling = false;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }

    let currentWords: number[] | null = null;
    let writeOk = false;
    let readWords: number[] | null = null;

    try {
        // 1) Предварительное чтение текущего слова по FC03.
        currentWords = await readHoldingRegistersFC03(slaveAddr, reg, 1);

        if (currentWords === null) {
            console.error('[CONTROLLER] TBIT: не удалось прочитать текущее слово (таймаут или исключение).');
            return false;
        }

        const currentWord = currentWords[0];
        console.log(
            `[CONTROLLER] TBIT: reg=0x${reg.toString(16)}, bitIndex=${plan.bitIndex}, ` +
            `желаемый bitValue=${plan.bitValue}, текущее слово=0x${currentWord.toString(16)}, ` +
            `текущее значение бита=${(currentWord >> plan.bitIndex) & 1}`
        );

        // 2) Modify: устанавливаем или сбрасываем ТОЛЬКО нужный бит, остальные не трогаем.
        const bitMask = 1 << plan.bitIndex;
        const newWord = plan.bitValue === 1
            ? (currentWord | bitMask) & 0xFFFF
            : (currentWord & ~bitMask) & 0xFFFF;

        console.log(
            `[CONTROLLER] TBIT: записываю слово=0x${newWord.toString(16)} ` +
            `(было 0x${currentWord.toString(16)}), остальные биты слова без изменений`
        );

        writeOk = await writeRegistersFC16(slaveAddr, reg, [newWord]);

        if (writeOk) {
            // 3) Обратное чтение и проверка ТОЛЬКО нужного бита.
            readWords = await readHoldingRegistersFC03(slaveAddr, reg, 1);
        }
    } finally {
        // Восстанавливаем опрос при ЛЮБОМ исходе
        if (wasPolling) {
            console.log('[CONTROLLER] TBIT: Возобновляю фоновый опрос.');
            stateObj.isPolling = true;
        }
    }

    if (!writeOk) {
        console.error('[CONTROLLER] TBIT: запись слова по FC16 не удалась (таймаут или исключение).');
        showIdModal('Значение не записалось');
        return false;
    }

    if (readWords === null) {
        console.error('[CONTROLLER] TBIT: обратное чтение по FC03 не удалось (таймаут или исключение).');
        showIdModal('Значение не записалось');
        return false;
    }

    const readBit = (readWords[0] >> plan.bitIndex) & 1;

    if (readBit !== plan.bitValue) {
        console.error(
            `[CONTROLLER] TBIT: НЕСОВПАДЕНИЕ: бит ${plan.bitIndex} после записи = ${readBit}, ` +
            `ожидалось ${plan.bitValue} (прочитано слово=0x${readWords[0].toString(16)})`
        );
        showIdModal('Значение не записалось');
        return false;
    }

    console.log('[CONTROLLER] TBIT: бит записан и проверен.');

    // Обновление UI ячеек 6 и 7 + пересчёт row-mismatch.
    const tds = tr.querySelectorAll('td');
    const hexIndex = parseInt(tr.getAttribute('data-hex-index') || '-1', 10);

    const updateCellDisplay = (idx: number, val: string) => {
        if (idx < 0 || idx >= tds.length || !val) return;
        const td = tds[idx];
        if (val.startsWith('<div') || val.startsWith('<select')) {
            td.innerHTML = val;
        } else if (val.startsWith('x')) {
            td.textContent = val;
        } else {
            if (!td.innerHTML.includes('prm-val-display')) {
                td.innerHTML = `<div class="prm-val-display">${val}</div>`;
            } else {
                const display = td.querySelector('.prm-val-display');
                if (display) display.textContent = val;
            }
        }
    };

    // Для TBIT и в hex, и в physical показывается значение бита (0/1), а не полное слово.
    // parts[hexIndex] для TBIT — это последний элемент, туда кладём бит как hex.
    const bitStr = plan.newPhys; // '0' или '1'
    const bitHex = 'x' + bitStr.padStart(4, '0');

    if (hexIndex >= 0 && hexIndex < parts.length) {
        parts[hexIndex] = bitHex;
    }
    if (parts.length > 0) {
        parts[parts.length - 1] = bitHex;
    }

    // Ячейка 6 (hex): показываем бит напрямую (как updateRowValues: rCellHex.textContent = bHex)
    if (tds[6]) {
        tds[6].textContent = bitStr;
    }
    // Ячейка 7 (physical): показываем бит в обёртке prm-val-display
    updateCellDisplay(7, bitStr);

    tr.dataset.parts = JSON.stringify(parts);

    // Пересчитываем класс row-mismatch (красная подсветка расхождения с Базой)
    updateMismatchClass(tr, dataType);

    // Зелёная вспышка успеха на отредактированной ячейке
    const activeCell = tds[colIndex];
    if (activeCell) {
        activeCell.classList.add('write-success');
        setTimeout(() => activeCell.classList.remove('write-success'), 1000);
    }

    console.log('[CONTROLLER] TBIT: Значение успешно записано, подтверждено и синхронизировано.');
    return true;
}

async function processValueWrite(
    tr: HTMLTableRowElement,
    editType: string,
    newValueStr: string,
    stateObj: TableEditorState,
    colIndex: number // 4, 5 - База (только UI); 6, 7 - Контроллер
): Promise<boolean> {
    // Ветвление по колонкам: Контроллер обрабатывается отдельной функцией
    if (colIndex === 6 || colIndex === 7) {
        return await processControllerWrite(tr, editType, newValueStr, stateObj, colIndex);
    }

    const dataType = (tr.getAttribute('data-type') || '').toUpperCase();
    const sub = tr.getAttribute('data-sub') || '';

    // TPrmList в БАЗЕ: ведём себя как Контроллер, но БЕЗ отправки по Modbus.
    if (dataType === 'TPRMLIST') {
        return processBasePrmListWrite(tr, newValueStr, colIndex);
    }

    let parts: string[] = [];
    try {
        parts = JSON.parse(tr.dataset.parts || '[]');
    } catch (e) {
        console.error("[TableEditor] Ошибка разбора data-parts:", e);
        return false;
    }

    // Для Базы Hex всегда лежит в parts[4], Physical в parts[5]
    const hexIndexInParts = 4;
    const physIndexInParts = 5;

    let scale = 1.0;
    if (parts.length > 6 && parts[6]) {
        const parsedScale = parseFloat(parts[6].replace(',', '.'));
        if (!isNaN(parsedScale) && parsedScale !== 0) scale = parsedScale;
    }

    const is32Bit = dataType.includes('FLOAT') || dataType.includes('DWORD') ||
        dataType.includes('LONG') || dataType.includes('INT32');

    let newHexValue: string | null = null;
    let newPhysValue: string | null = null;

    // --- ЛОГИКА ПРЕОБРАЗОВАНИЯ (ТОЛЬКО ДЛЯ UI) ---
    if (editType === 'hex') {
        // Пользователь ввел HEX -> обновляем Hex и пересчитываем Physical
        const cleanHex = newValueStr.replace(/^(x|0x)/i, '');
        if (!/^[0-9A-Fa-f]+$/.test(cleanHex)) {
            alert("Некорректный HEX формат");
            return false;
        }

        let parsedVal = parseInt(cleanHex, 16);
        if (isNaN(parsedVal)) return false;

        newHexValue = 'x' + parsedVal.toString(16).toUpperCase().padStart(is32Bit ? 8 : 4, '0');
        parts[hexIndexInParts] = newHexValue;

        // Пересчет Physical из нового Hex
        if (dataType.includes('FLOAT')) {
            const buf = new ArrayBuffer(4);
            const dv = new DataView(buf);
            // Для 32 бит нужно корректно собрать слово, если ввод был полным
            if (is32Bit) {
                dv.setUint32(0, parsedVal, false); // Big-endian
                const floatVal = dv.getFloat32(0, false);
                newPhysValue = (floatVal * scale).toFixed(4);
            } else {
                // 16 бит
                let signedVal = parsedVal;
                if (signedVal > 32767) signedVal -= 65536; // Int16 conversion
                newPhysValue = (signedVal * scale).toString();
            }
        } else if (dataType === 'TBIT') {
            // Для бита просто показываем 0 или 1
            const bitIndex = parseInt(sub, 16);
            const bitVal = (parsedVal >> (isNaN(bitIndex) ? 0 : bitIndex)) & 1;
            newPhysValue = bitVal.toString();
        } else {
            // Целые числа
            let signedVal = parsedVal;
            if (!is32Bit && signedVal > 32767) signedVal -= 65536; // Int16
            if (is32Bit && parsedVal > 2147483647) signedVal = parsedVal - 4294967296; // Int32

            newPhysValue = (signedVal * scale).toString();
        }

        parts[physIndexInParts] = newPhysValue || newValueStr; // Fallback

    } else {
        // Пользователь ввел Physical -> обновляем Physical и пересчитываем Hex
        const valNum = parseFloat(newValueStr.replace(',', '.'));
        if (isNaN(valNum)) {
            alert("Некорректное число");
            return false;
        }

        newPhysValue = newValueStr; // Сохраняем как есть (или форматированное)
        parts[physIndexInParts] = newPhysValue;

        // Пересчет Hex из нового Physical
        if (dataType.includes('FLOAT')) {
            const unscaledVal = valNum / scale;
            const hexStr = float32ToHex(unscaledVal);
            newHexValue = 'x' + hexStr.toUpperCase();
            parts[hexIndexInParts] = newHexValue;
        } else if (dataType === 'TBIT') {
            const bitVal = valNum > 0 ? 1 : 0;
            // Получаем текущее слово из Hex
            const currentHexStr = parts[hexIndexInParts] && parts[hexIndexInParts].startsWith('x')
                ? parts[hexIndexInParts]
                : 'x0';
            let currentWord = parseInt(currentHexStr.slice(1), 16) || 0;
            const bitIndex = parseInt(sub, 16);

            if (!isNaN(bitIndex)) {
                if (bitVal === 1) currentWord |= (1 << bitIndex);
                else currentWord &= ~(1 << bitIndex);
            }
            newHexValue = 'x' + currentWord.toString(16).toUpperCase().padStart(4, '0');
            parts[hexIndexInParts] = newHexValue;
        } else {
            // Целые числа
            const rawVal = Math.round(valNum / scale);
            let word = rawVal & 0xFFFF;
            if (is32Bit) {
                // Для 32 бит нужно сохранить полное значение, но в parts[4] может быть только 16 бит?
                // Зависит от структуры parts. Если parts[4] хранит 32-битное hex, то ок.
                // Иначе логика сложнее. Пока считаем, что hex в parts[4] вмещает значение.
                newHexValue = 'x' + rawVal.toString(16).toUpperCase().padStart(8, '0');
            } else {
                newHexValue = 'x' + word.toString(16).toUpperCase().padStart(4, '0');
            }
            parts[hexIndexInParts] = newHexValue;
        }
    }

    // Сохраняем обновленный массив parts обратно в DOM
    tr.dataset.parts = JSON.stringify(parts);

    // === ОБНОВЛЕНИЕ ВИЗУАЛЬНОГО ОТОБРАЖЕНИЯ ===
    const tds = tr.querySelectorAll('td');

    const updateCellDisplay = (idx: number, val: string) => {
        if (idx < 0 || idx >= tds.length || !val) return;
        const td = tds[idx];

        if (val.startsWith('<div') || val.startsWith('<select')) {
            td.innerHTML = val;
        } else if (val.startsWith('x')) {
            td.textContent = val;
        } else {
            if (!td.innerHTML.includes('prm-val-display')) {
                td.innerHTML = `<div class="prm-val-display">${val}</div>`;
            } else {
                const display = td.querySelector('.prm-val-display');
                if (display) display.textContent = val;
            }
        }
    };

        // Обновляем обе ячейки (Hex и Physical) новыми значениями из parts
    updateCellDisplay(4, parts[4]);
    updateCellDisplay(5, parts[5]);

    // Пересчитываем цвет расхождения Базы и Контроллера после правки Базы
    updateMismatchClass(tr, dataType);

    // Визуальный эффект успеха
    const activeCell = tds[colIndex];
    if (activeCell) {
        activeCell.classList.add('write-success');
        setTimeout(() => activeCell.classList.remove('write-success'), 1000);
    }

    console.log(`[UI ONLY] Значения обновлены в памяти. Hex: ${parts[4]}, Phys: ${parts[5]}`);

    return true; // Всегда возвращаем true, т.к. отправки нет
}

export function startInlineEdit(cell: HTMLElement, stateObj: TableEditorState): void {
    const tr = cell.closest<HTMLTableRowElement>('tr');
    if (!tr) return;
    if (cell.querySelector('input')) return;

    const editType = cell.getAttribute('data-edit-type') || 'phys';
    // Читаем индекс колонки из атрибута, установленного при инициализации
    const colIndex = parseInt(cell.getAttribute('data-col-index') || '4', 10);

    const originalValue = cell.innerText.trim();

    // Для TPrmList: создаём выпадающий список вместо текстового поля
    const dataType = (tr.getAttribute('data-type') || '').toUpperCase();

    if (dataType === 'TPRMLIST') {
        // Извлекаем опции из parts (формат "hex#текст")
        let partsRaw: string[] = [];
        try { partsRaw = JSON.parse(tr.dataset.parts || '[]'); } catch { partsRaw = []; }

        const prmOptions: { hex: string; text: string }[] = [];
        for (const p of partsRaw) {
            const part = (p || '').trim();
            if (part.includes('#')) {
                const [h, t] = part.split('#');
                if (h && t) {
                    prmOptions.push({ hex: h.toLowerCase(), text: t });
                }
            }
        }

        // Текущее значение.
        // Для Контроллера (колонки 6/7) — живое значение из parts[hexIndex].
        // Для Базы (колонки 4/5) — значение, отображённое в ячейке Базы,
        //   переведённое обратно в hex через список опций.
        const hexIndex = parseInt(tr.getAttribute('data-hex-index') || '-1', 10);
        let currentHex = '';
        if (colIndex === 4 || colIndex === 5) {
            const match = prmOptions.find((o) => o.text === originalValue);
            currentHex = match ? match.hex : '';
        } else {
            currentHex = (hexIndex >= 0 && hexIndex < partsRaw.length)
                ? (partsRaw[hexIndex] || '').toLowerCase()
                : '';
        }

        const select = document.createElement('select');
        select.className = 'inline-cell-select';
        select.style.width = '100%';

        for (const opt of prmOptions) {
            const option = document.createElement('option');
            option.value = opt.hex;
            option.textContent = opt.text;
            if (opt.hex === currentHex) {
                option.selected = true;
            }
            select.appendChild(option);
        }

        cell.innerHTML = '';
        cell.appendChild(select);
        select.focus();

        let isFinished = false;

        const saveSelect = async () => {
            if (isFinished) return;
            isFinished = true;

            const selectedHex = select.value; // например, "x06"
            if (!selectedHex || selectedHex === currentHex) {
                cell.innerText = originalValue;
                return;
            }

            // Для TPrmList в обеих ячейках показываем текст опции (например, "115200"),
            // а не хекс (например, "x06").
            const selectedText = select.options[select.selectedIndex]?.text || selectedHex;
            cell.innerText = selectedText;

            try {
                // Передаём хекс опции как новое значение
                const success = await processValueWrite(tr, 'hex', selectedHex, stateObj, colIndex);
                if (!success) {
                    cell.innerText = originalValue;
                    cell.classList.add('write-error');
                    setTimeout(() => cell.classList.remove('write-error'), 1500);
                } else {
                    cell.classList.add('write-success');
                    setTimeout(() => cell.classList.remove('write-success'), 1000);
                }
            } catch (err) {
                console.error('Error saving TPrmList value:', err);
                cell.innerText = originalValue;
            }
        };

        select.addEventListener('change', () => saveSelect());
        select.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                select.blur();
            } else if (e.key === 'Escape') {
                isFinished = true;
                cell.innerText = originalValue;
            }
        });
        // Если фокус ушёл со списка без выбора (клик мимо, Enter, Tab) —
        // возвращаем ячейку к исходному текстовому виду.
        // Без этого список "зависает" в ячейке, как на скриншоте.
        select.addEventListener('blur', () => saveSelect());

        return; // Выходим, чтобы не создавать input
    }

    // Для остальных типов: текстовое поле
    const input = document.createElement('input');
    input.type = 'text';
    input.value = originalValue;
    input.className = 'inline-cell-input';
    input.style.width = '100%';

    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    let isFinished = false;

    const save = async () => {
        if (isFinished) return;
        isFinished = true;

        const newValue = input.value.trim();
        if (newValue === originalValue || newValue === '') {
            cell.innerText = originalValue;
            return;
        }

        cell.innerText = newValue; // Временное отображение

        try {
            // Передаем colIndex в процесс записи
            const success = await processValueWrite(tr, editType, newValue, stateObj, colIndex);

            if (!success) {
                cell.innerText = originalValue;
                cell.classList.add('write-error');
                setTimeout(() => cell.classList.remove('write-error'), 1500);
            } else {
                cell.classList.add('write-success');
                setTimeout(() => cell.classList.remove('write-success'), 1000);
                // UI уже обновлен внутри processValueWrite
            }
        } catch (err) {
            console.error("Error saving value:", err);
            cell.innerText = originalValue;
        }
    };

    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            isFinished = true;
            cell.innerText = originalValue;
        }
    });

    input.addEventListener('blur', () => save());
}