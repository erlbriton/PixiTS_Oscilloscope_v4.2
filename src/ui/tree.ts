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

            tr.addEventListener('click', () => {
                clearAnyActiveCellEditors();
                const prevSelected = document.querySelector('#grid-data-rows tr.is-selected');
                if (prevSelected && prevSelected !== tr) {
                    prevSelected.classList.remove('is-selected');
                }
                tr.classList.add('is-selected');
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