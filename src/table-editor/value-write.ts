// src/table-editor/value-write.ts
// Диспетчер записи значения: распределяет запрос между Контроллером и Базой.

import { float32ToHex } from '../ini-manager/tree-core.js';
import { processControllerWrite, updateMismatchClass, updateCellDisplay } from './controller-write.js';
import { processBasePrmListWrite, processBaseIpAddrWrite } from './base-write.js';
import type { TableEditorState } from '../ini-manager/table-editor.js';

export async function processValueWrite(
    tr: HTMLTableRowElement,
    editType: string,
    newValueStr: string,
    stateObj: TableEditorState,
    colIndex: number // 4, 5 - База (только UI); 6, 7 - Контроллер
): Promise<boolean> {
    // Контроллер обрабатывается отдельной функцией
    if (colIndex === 6 || colIndex === 7) {
        return await processControllerWrite(tr, editType, newValueStr, stateObj, colIndex);
    }

    const dataType = (tr.getAttribute('data-type') || '').toUpperCase();
    const sub = tr.getAttribute('data-sub') || '';

    // Специальные типы Базы
    if (dataType === 'TPRMLIST') {
        return processBasePrmListWrite(tr, newValueStr, colIndex);
    }
    if (dataType === 'TIPADDR') {
        return processBaseIpAddrWrite(tr, editType, newValueStr, colIndex);
    }

    // --- Общая логика Базы для остальных типов ---
    let parts: string[] = [];
    try {
        parts = JSON.parse(tr.dataset.parts || '[]');
    } catch (e) {
        console.error("[TableEditor] Ошибка разбора data-parts:", e);
        return false;
    }

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

    if (editType === 'hex') {
        const cleanHex = newValueStr.replace(/^(x|0x)/i, '');
        if (!/^[0-9A-Fa-f]+$/.test(cleanHex)) {
            alert("Некорректный HEX формат");
            return false;
        }
        let parsedVal = parseInt(cleanHex, 16);
        if (isNaN(parsedVal)) return false;

        newHexValue = 'x' + parsedVal.toString(16).toUpperCase().padStart(is32Bit ? 8 : 4, '0');
        parts[hexIndexInParts] = newHexValue;

        if (dataType.includes('FLOAT')) {
            const buf = new ArrayBuffer(4);
            const dv = new DataView(buf);
            if (is32Bit) {
                dv.setUint32(0, parsedVal, false);
                const floatVal = dv.getFloat32(0, false);
                newPhysValue = (floatVal * scale).toFixed(4);
            } else {
                let signedVal = parsedVal;
                if (signedVal > 32767) signedVal -= 65536;
                newPhysValue = (signedVal * scale).toString();
            }
        } else if (dataType === 'TBIT') {
            const bitIndex = parseInt(sub, 16);
            const bitVal = (parsedVal >> (isNaN(bitIndex) ? 0 : bitIndex)) & 1;
            newPhysValue = bitVal.toString();
        } else {
            let signedVal = parsedVal;
            if (!is32Bit && signedVal > 32767) signedVal -= 65536;
            if (is32Bit && parsedVal > 2147483647) signedVal = parsedVal - 4294967296;
            newPhysValue = (signedVal * scale).toString();
        }
        parts[physIndexInParts] = newPhysValue || newValueStr;
    } else {
        const valNum = parseFloat(newValueStr.replace(',', '.'));
        if (isNaN(valNum)) {
            alert("Некорректное число");
            return false;
        }
        newPhysValue = newValueStr;
        parts[physIndexInParts] = newPhysValue;

        if (dataType.includes('FLOAT')) {
            const unscaledVal = valNum / scale;
            const hexStr = float32ToHex(unscaledVal);
            newHexValue = 'x' + hexStr.toUpperCase();
            parts[hexIndexInParts] = newHexValue;
        } else if (dataType === 'TBIT') {
            const bitVal = valNum > 0 ? 1 : 0;
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
            const rawVal = Math.round(valNum / scale);
            if (is32Bit) {
                newHexValue = 'x' + rawVal.toString(16).toUpperCase().padStart(8, '0');
            } else {
                const word = rawVal & 0xFFFF;
                newHexValue = 'x' + word.toString(16).toUpperCase().padStart(4, '0');
            }
            parts[hexIndexInParts] = newHexValue;
        }
    }

    tr.dataset.parts = JSON.stringify(parts);

    const tds = tr.querySelectorAll('td');
    updateCellDisplay(tds[4], parts[4]);
    updateCellDisplay(tds[5], parts[5]);

    updateMismatchClass(tr, dataType);

    const activeCell = tds[colIndex];
    if (activeCell) {
        activeCell.classList.add('write-success');
        setTimeout(() => activeCell.classList.remove('write-success'), 1000);
    }

    console.log(`[UI ONLY] Значения обновлены в памяти. Hex: ${parts[4]}, Phys: ${parts[5]}`);
    return true;
}