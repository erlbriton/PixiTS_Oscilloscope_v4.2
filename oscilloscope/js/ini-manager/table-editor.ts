// oscilloscope/js/ini-manager/table-editor.ts

import { startInlineEdit } from './table-editor-logic.js';

export interface TableEditorState {
    slaveAddress?: number;
    isPolling?: boolean;
    currentDeviceConfig?: any;
}

/**
 * Очистка активных ячеек редактора.
 */
export function clearAnyActiveCellEditors(): void {
    document.querySelectorAll<HTMLElement>('.is-editing-cell').forEach(el => {
        if ((el as any).blurEditor) (el as any).blurEditor();
    });
}

/**
 * Заглушки для обратной совместимости.
 */
export function initHexCellEditor(...args: any[]): void {
    if (args[0]?.addEventListener) args[0].addEventListener('click', (e: MouseEvent) => e.stopPropagation());
}

export function initPhysicalCellEditor(...args: any[]): void {
    if (args[0]?.addEventListener) args[0].addEventListener('click', (e: MouseEvent) => e.stopPropagation());
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
