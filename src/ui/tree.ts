// src/ui/tree.ts

import { populateDeviceForm } from './ui.js';
import { currentIniConfig, hexToFloat32, float32ToHex } from '../ini-manager/tree-core.js';
import {
    clearAnyActiveCellEditors,
    initHexCellEditor,
    initPhysicalCellEditor,
} from '../ini-manager/table-editor.js';
import { updateRowValues } from '../ini-manager/tree-ui.js';
import { IniConfig } from '../core/ini/index.js';

declare global {
    interface Window {
        initTableResizers?: () => void;
    }
}

export function renderModbusTable(config?: IniConfig): void {
    const tableBody = document.getElementById('grid-data-rows');
    if (!tableBody) return;

    const modeSelect = document.querySelector<HTMLSelectElement>('.toolbar-device-mode-select');
    const selectedMode = modeSelect && modeSelect.value ? modeSelect.value : 'FLASH';

    tableBody.innerHTML = '';

    if (!config || !config.isValid) return;

    const params = config.getSection(selectedMode);
    if (params.length === 0) return;

    for (const param of params) {
        try {
            const tr = document.createElement('tr');
            tr.setAttribute('data-type', param.dataType);
            tr.setAttribute('data-section', selectedMode);
            tr.setAttribute('data-key', param.id);

            if (param.registerAddress !== null) {
                tr.setAttribute('data-reg', param.registerAddress.toString(16));
                if (param.bitIndex !== null) {
                    tr.setAttribute('data-sub', param.bitIndex.toString(16));
                }
            }

            let hexIndex = -1;
            if (param.isBit) {
                hexIndex = param.rawParts.length - 1;
            } else {
                for (let j = param.rawParts.length - 1; j >= 3; j--) {
                    const part = (param.rawParts[j] ?? '').trim();
                    if (!part.includes('#') && part.startsWith('x')) {
                        hexIndex = j;
                        break;
                    }
                }
            }
            tr.setAttribute('data-hex-index', hexIndex.toString());
            tr.dataset.parts = JSON.stringify(param.rawParts);

            tr.innerHTML = `
                <td>${param.id}</td>
                <td class="param-name" title="${param.name}">${param.name}</td>
                <td class="param-desc" title="${param.description}">${param.description}</td>
                <td>—</td>
                <td class="hex-val">—</td>
                <td>—</td>
                <td class="hex-val">—</td>
                <td>—</td>
            `;

            const unitsDisplay = param.isBit ? '.' : (param.unit === '*' ? '—' : param.unit);
            const tds = tr.querySelectorAll('td');
            if (tds[3]) {
                tds[3].textContent = unitsDisplay;
            }

            let originalHexLen = 4;
            if (hexIndex !== -1 && param.rawParts[hexIndex] !== undefined) {
                const hexStr = String(param.rawParts[hexIndex]);
                if (hexStr.startsWith('x')) {
                    originalHexLen = hexStr.slice(1).length;
                }
            }

            const prmListOptions: Record<string, string> = {};
            for (let j = param.rawParts.length - 1; j >= 3; j--) {
                const part = (param.rawParts[j] ?? '').trim();
                if (part.includes('#')) {
                    const [h, t] = part.split('#');
                    if (h && t) {
                        prmListOptions[h.toLowerCase()] = t;
                    }
                }
            }

            updateRowValues(
                tr,
                param.rawParts,
                param.dataType,
                param.scale,
                hexIndex,
                originalHexLen,
                prmListOptions,
                hexToFloat32,
                float32ToHex,
            );

            // Инициализация редакторов (они могут перехватывать клик на td[4] и td[5])
            if (tds[4] && tds[5]) {
                initHexCellEditor(
                    tds[4], tr, param.rawParts, hexIndex,
                    updateRowValues, param.dataType, param.scale,
                    originalHexLen, prmListOptions,
                );
                initPhysicalCellEditor(
                    tds[5], tr, param.rawParts, param.dataType,
                    param.scale, hexIndex, originalHexLen,
                    prmListOptions, updateRowValues,
                    hexToFloat32, float32ToHex,
                );
            }

            // --- ЛОГИКА ВЫДЕЛЕНИЯ СТРОКИ (ДЛЯ КЛИКОВ СЛЕВА) ---
            // Работает только если клик прошел через td[0..3]
            tr.addEventListener('click', (event: MouseEvent) => {
                const target = event.target as HTMLElement;
                const clickedCell = target.closest('td');
                
                // Если клик был по одной из 4-х правых ячеек, игнорируем этот слушатель (их обрабатывают отдельные слушатели ниже)
                if (clickedCell && (clickedCell === tds[4] || clickedCell === tds[5] || clickedCell === tds[6] || clickedCell === tds[7])) {
                    return; 
                }

                // Стандартное выделение строки при клике слева
                const prevSelectedRow = document.querySelector('#grid-data-rows tr.is-selected');
                if (prevSelectedRow && prevSelectedRow !== tr) {
                    prevSelectedRow.classList.remove('is-selected');
                    clearAnyActiveCellEditors();
                }
                tr.classList.add('is-selected');
                
                // Сброс желтого цвета при клике слева
                document.querySelectorAll('#grid-data-rows td.cell-active').forEach(el => el.classList.remove('cell-active'));
            });

            // --- ЛОГИКА ДЛЯ 4-Х ПРАВЫХ ЯЧЕЕК (БАЗА И КОНТРОЛЛЕР) ---
            // Вешаем обработчик НАПРЯМУЮ на каждую ячейку, чтобы обойти stopPropagation внутри редакторов
            const dataCells = [tds[4], tds[5], tds[6], tds[7]];
            
            dataCells.forEach((cell) => {
                if (!cell) return;
                cell.style.cursor = 'pointer';

                // Добавляем слушатель напрямую на ячейку
                cell.addEventListener('click', (e) => {
                    e.stopPropagation(); // Останавливаем всплытие, чтобы не триггерить лишний раз логику строки

                    // 1. Сброс желтого цвета со ВСЕЙ таблицы
                    document.querySelectorAll('#grid-data-rows td.cell-active').forEach(el => {
                        el.classList.remove('cell-active');
                    });

                    // 2. Выделение текущей строки зеленым
                    const prevSelectedRow = document.querySelector('#grid-data-rows tr.is-selected');
                    if (prevSelectedRow && prevSelectedRow !== tr) {
                        prevSelectedRow.classList.remove('is-selected');
                        clearAnyActiveCellEditors();
                    }
                    tr.classList.add('is-selected');

                    // 3. Подсветка текущей ячейки желтым
                    cell.classList.add('cell-active');
                });
            });

            tableBody.appendChild(tr);
        } catch (e) {
            console.error('Ошибка при отрисовке строки:', param.id, e);
        }
    }

    if (typeof window.initTableResizers === 'function') {
        window.initTableResizers();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const modeSelect = document.querySelector<HTMLSelectElement>('.toolbar-device-mode-select');
    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            clearAnyActiveCellEditors();
            if (currentIniConfig) renderModbusTable(currentIniConfig);
        });
    }
    document.addEventListener('click', () => {
        clearAnyActiveCellEditors();
    });
});