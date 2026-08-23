// src/ini-manager/table-editor.ts

import { serialManager, calculateCRC } from '../serial/serial-actions.js';
import { parseRegisterAddress, float32ToHex } from './tree-core.js';
import type { IniConfig } from '../core/ini/index.js';

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
): void {
    cell.addEventListener('click', (e: MouseEvent) => e.stopPropagation());
}

/**
 * Заглушка редактора физической ячейки.
 * Типизирована для совместимости с renderModbusTable.
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
): void {
    cell.addEventListener('click', (e: MouseEvent) => e.stopPropagation());
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

async function processValueWrite(
    tr: HTMLTableRowElement,
    editType: string,
    newValueStr: string,
    stateObj: TableEditorState
): Promise<boolean> {
    const addrStr = tr.getAttribute('data-reg');
    if (!addrStr) return false;

    const { reg } = parseRegisterAddress(addrStr);
    if (reg === null) return false;

    const dataType = (tr.getAttribute('data-type') || '').toUpperCase();
    const sub = tr.getAttribute('data-sub') || '';

    let parts: string[] = [];
    try {
        parts = JSON.parse(tr.dataset.parts || '[]');
    } catch (e) {
        console.error("[TableEditor] Ошибка разбора data-parts:", e);
    }

    let scale = 1.0;
    if (parts[6]) {
        const parsedScale = parseFloat(parts[6].replace(',', '.'));
        if (!isNaN(parsedScale) && parsedScale !== 0) scale = parsedScale;
    }

    const is32Bit = dataType.includes('FLOAT') || dataType.includes('DWORD') ||
                    dataType.includes('LONG') || dataType.includes('INT32');

    let wordsToWrite: number[] = [];

    if (editType === 'hex') {
        const cleanHex = newValueStr.replace(/^(x|0x)/i, '');
        if (!/^[0-9A-Fa-f]+$/.test(cleanHex)) return false;
        const parsedVal = parseInt(cleanHex, 16);
        if (isNaN(parsedVal)) return false;

        if (is32Bit) {
            const lowWord = parsedVal & 0xFFFF;
            const highWord = (parsedVal >>> 16) & 0xFFFF;
            wordsToWrite = [lowWord, highWord];
        } else {
            wordsToWrite = [parsedVal & 0xFFFF];
        }
    } else {
        const valNum = parseFloat(newValueStr.replace(',', '.'));
        if (isNaN(valNum)) return false;

        if (dataType.includes('FLOAT')) {
            const hexStr = float32ToHex(valNum);
            const rawInt = parseInt(hexStr, 16);
            const highWord = (rawInt >>> 16) & 0xFFFF;
            const lowWord = rawInt & 0xFFFF;
            wordsToWrite = [lowWord, highWord];
        } else if (dataType.includes('LONG') || dataType.includes('INT32') || dataType.includes('DWORD')) {
            const rawVal = Math.round(valNum / scale);
            const lowWord = rawVal & 0xFFFF;
            const highWord = (rawVal >>> 16) & 0xFFFF;
            wordsToWrite = [lowWord, highWord];
        } else if (dataType === 'TBIT') {
            const bitVal = valNum > 0 ? 1 : 0;
            const bitIndex = parseInt(sub, 16);
            const currentHexStr = parts[5] ? parts[5].replace(/^x/i, '') : '0';
            let currentWord = parseInt(currentHexStr, 16) || 0;
            if (!isNaN(bitIndex)) {
                if (bitVal === 1) currentWord |= (1 << bitIndex);
                else currentWord &= ~(1 << bitIndex);
            }
            wordsToWrite = [currentWord & 0xFFFF];
        } else {
            const rawVal = Math.round(valNum / scale);
            wordsToWrite = [rawVal & 0xFFFF];
        }
    }

    const slaveAddr = (stateObj && stateObj.slaveAddress) ? stateObj.slaveAddress : 0x01;
    return await sendModbusWriteCommand(slaveAddr, reg, wordsToWrite);
}

export function startInlineEdit(cell: HTMLElement, stateObj: TableEditorState): void {
    const tr = cell.closest<HTMLTableRowElement>('tr');
    if (!tr) return;

    if (cell.querySelector('input')) return;

    const editType = cell.getAttribute('data-edit-type') || 'phys';
    const originalValue = cell.innerText.trim();

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

        cell.innerText = newValue;

        try {
            const success = await processValueWrite(tr, editType, newValue, stateObj);
            if (!success) {
                cell.innerText = originalValue;
                cell.classList.add('write-error');
                setTimeout(() => cell.classList.remove('write-error'), 1500);
            } else {
                cell.classList.add('write-success');
                setTimeout(() => cell.classList.remove('write-success'), 1000);
            }
        } catch (err) {
            cell.innerText = originalValue;
        }
    };

    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') input.blur();
        else if (e.key === 'Escape') { isFinished = true; cell.innerText = originalValue; }
    });

    input.addEventListener('blur', () => save());
}