// src/table-editor/copy-ops.ts
// Операции массового копирования значений между Базой и Контроллером.
// Шаг 1: копирование в памяти браузера (без Modbus и без записи в INI).

import { updateMismatchClass } from './controller-write.js';

/**
 * Копирует значения Контроллера (колонки 6,7) в Базу (колонки 4,5)
 * для всех строк таблицы — только в памяти браузера.
 * Возвращает количество обработанных строк.
 */
export function copyControllerToBase(): number {
    const rows = Array.from(
        document.querySelectorAll<HTMLTableRowElement>('#grid-data-rows tr'),
    );
    let copied = 0;

    for (const tr of rows) {
        const tds = tr.querySelectorAll('td');
        if (tds.length < 8) continue;

        const baseHex = tds[4];
        const basePhys = tds[5];
        const ctrlHex = tds[6];
        const ctrlPhys = tds[7];
        if (!baseHex || !basePhys || !ctrlHex || !ctrlPhys) continue;

        // Не копируем пустые и прочерки — там нет живого значения
        const ctrlHexText = (ctrlHex.textContent || '').trim();
        if (!ctrlHexText || ctrlHexText === '—') continue;

        // Переписываем содержимое ячеек Контроллера в Базу
        baseHex.innerHTML = ctrlHex.innerHTML;
        basePhys.innerHTML = ctrlPhys.innerHTML;

        // Пересчитываем подсветку расхождения (после копирования — совпадает, станет чёрной)
        const dataType = (tr.getAttribute('data-type') || '').toUpperCase();
        updateMismatchClass(tr, dataType);

        copied++;
    }

    return copied;
}