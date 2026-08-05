import { populateDeviceForm } from './ui.js';
import { currentDeviceConfig, deviceRegistry, addDeviceToRegistry, parseRegisterAddress, hexToFloat32, float32ToHex } from './ini-manager/tree-core.js';
import { clearAnyActiveCellEditors, initHexCellEditor, initPhysicalCellEditor } from './ini-manager/table-editor.js';
import { updateRowValues } from './ini-manager/tree-ui.js';

// Объявление глобальной функции, вызываемой для ресайза колонок
declare global {
    interface Window {
        initTableResizers?: () => void;
    }
}

export function renderModbusTable(config?: Record<string, any>): void {
    const tableBody = document.getElementById('grid-data-rows');
    if (!tableBody) return;

    const modeSelect = document.querySelector<HTMLSelectElement>('.toolbar-device-mode-select');
    const selectedMode = modeSelect && modeSelect.value ? modeSelect.value : 'FLASH';

    tableBody.innerHTML = ''; 

    if (!config || !config[selectedMode]) {
        return;
    }

    const sectionData = config[selectedMode] as Record<string, any>;
    const keys = Object.keys(sectionData);

    for (let i = 0; i < keys.length; i++) {
        try {
            const key = keys[i];
            const parts = sectionData[key];
            
            const isArray = Array.isArray(parts);
            const name = isArray ? String(parts[0] ?? '') : '';
            const description = isArray ? String(parts[1] ?? '') : '';
            const dataType = isArray ? String(parts[2] ?? '') : '';
            
            const dataTypeUpper = dataType.toUpperCase();
            
            // Учитываем смещение индексов в INI-файле для дискретных параметров TBit
            // Принудительно приводим к string, чтобы не было типа (string | number)
            const regAddrString = isArray 
                ? String(dataTypeUpper === 'TBIT' ? (parts[5] ?? '') : (parts[4] ?? '')) 
                : '';

            const units = isArray 
                ? (dataTypeUpper === 'TBIT' ? '—' : String(parts[5] ?? '—')) 
                : '—';

            const parsedAddr = parseRegisterAddress(regAddrString);
            const scale = isArray ? parseFloat(parts[6] ? String(parts[6]).replace(',', '.') : 'NaN') : NaN;

            let hexIndex = -1;
            if (isArray) {
                if (dataTypeUpper === 'TBIT') {
                    hexIndex = parts.length - 1;
                } else {
                    for (let j = parts.length - 1; j >= 3; j--) {
                        const part = parts[j] !== undefined && parts[j] !== null ? String(parts[j]).trim() : '';
                        if (!part.includes('#') && part.startsWith('x')) {
                            hexIndex = j;
                            break;
                        }
                    }
                }
            }

            let originalHexLen = 4;
            if (hexIndex !== -1 && isArray && parts[hexIndex] !== undefined && parts[hexIndex] !== null) {
                const hexStr = String(parts[hexIndex]);
                if (hexStr.startsWith('x')) {
                    originalHexLen = hexStr.slice(1).length;
                }
            }

            let prmListOptions: Record<string, string> = {}; 
            if (isArray) {
                for (let j = parts.length - 1; j >= 3; j--) {
                    const part = parts[j] !== undefined && parts[j] !== null ? String(parts[j]).trim() : '';
                    if (part.includes('#')) {
                        const [h, t] = part.split('#');
                        if (h && t) {
                            prmListOptions[h.toLowerCase()] = t;
                        }
                    }
                }
            }

            const tr = document.createElement('tr');
            tr.setAttribute('data-type', dataType);
            tr.setAttribute('data-section', selectedMode);
            tr.setAttribute('data-key', key);
            if (parsedAddr && parsedAddr.reg !== null && parsedAddr.reg !== undefined) {
                tr.setAttribute('data-reg', parsedAddr.reg.toString(16));
                if (parsedAddr.sub) {
                    tr.setAttribute('data-sub', String(parsedAddr.sub));
                }
            }

            tr.setAttribute('data-hex-index', hexIndex.toString());
            tr.innerHTML = `
                <td>${key}</td>
                <td class="param-name" title="${name}">${name}</td>
                <td class="param-desc" title="${description}">${description}</td>
                <td>—</td>
                <td class="hex-val">—</td>
                <td>—</td>
                <td class="hex-val">—</td>
                <td>—</td>
            `;

            const unitsDisplay = (dataType === 'TBit') ? '.' : (units === '*' ? '—' : units);
            const tds = tr.querySelectorAll('td');
            if (tds[3]) {
                tds[3].textContent = unitsDisplay;
            }

            if (isArray) {
                updateRowValues(tr, parts, dataType, scale, hexIndex, originalHexLen, prmListOptions, hexToFloat32, float32ToHex);

                if (tds[4] && tds[5]) {
                    initHexCellEditor(tds[4], tr, parts, hexIndex, updateRowValues, dataType, scale, originalHexLen, prmListOptions);
                    initPhysicalCellEditor(tds[5], tr, parts, dataType, scale, hexIndex, originalHexLen, prmListOptions, updateRowValues, hexToFloat32, float32ToHex);
                }
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
            console.error("Ошибка при отрисовке строки:", keys[i], e);
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
            if (currentDeviceConfig) renderModbusTable(currentDeviceConfig);
        });
    }
    
    document.addEventListener('click', () => {
        clearAnyActiveCellEditors();
    });
});
