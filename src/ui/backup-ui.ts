// src/ui/backup-ui.ts
/**
 * Окно "Создать резерв для устройства...": создание записи в базе с
 * параметрами, идентичными существующему устройству (шаблону).
 *
 * Сейчас: показ окна, заполнение данных, выбор строки-шаблона.
 * Алгоритм "Применить" — следующий шаг.
 */
import { parseDeviceIdString } from '../core/report-data.js';
import { getAllDevices } from '../ini-manager/tree-core.js';
import { getFileStore } from '../ini-manager/file-loader.js';
import { encodeToWindows1251 } from '../core/encoding.js';
import { showIdModal } from './ui.js';
import { ensureDbFolder, saveFileToDbFolder } from '../ini-manager/db-folder.js'

/** Идентификатор устройства, выбранного шаблоном. */
let selectedTemplateId: string | null = null;

export function getBackupTemplateId(): string | null {
    return selectedTemplateId;
}

/** Связка с конвейером загрузки (вставляет uiManager, у него есть appState). */
type LoadFn = (content: string, fileName: string, file: File, handle?: FileSystemFileHandle) => Promise<void>;
let loadFn: LoadFn | null = null;

export function setBackupLoadFn(fn: LoadFn): void {
    loadFn = fn;
}

export function initBackupUI(): void {
    document.getElementById('backupCloseBtn')?.addEventListener('click', () => {
        hideBackupWindow();
    });
    document.getElementById('backupCancelBtn')?.addEventListener('click', () => {
        hideBackupWindow();
    });

    document.getElementById('backupTypeSelect')?.addEventListener('change', () => {
        renderBackupTable();
    });

    document.getElementById('backupApplyBtn')?.addEventListener('click', () => {
        void handleBackupApply();
    });
}

/** Открывает окно и заполняет данные создаваемого устройства. */
export function showBackupWindow(): void {
    const overlay = document.getElementById('backupOverlay');
    if (!overlay) return;

    const idText = (document.querySelector('.id-banner span')?.textContent ?? '').trim();
    const parsed = parseDeviceIdString(idText);

    // Блок "Устройство" — данные создаваемого устройства.
    const info = document.getElementById('backupDeviceInfo');
    if (info) {
        const mech = (document.getElementById('newDeviceMechInput') as HTMLInputElement | null)?.value.trim() ?? '';
        const loc = (document.getElementById('newDeviceLocInput') as HTMLInputElement | null)?.value.trim() ?? '';
        info.textContent =
            `Серийный номер : ${parsed.serial}\n` +
            `Механизм       : ${mech}\n` +
            `Место установки: ${loc}`;
    }

    // "Устройство типа" — все типы, имеющиеся в базе.
    const select = document.getElementById('backupTypeSelect') as HTMLSelectElement | null;
    if (select) {
        select.innerHTML = '';
        const types: string[] = [];
        for (const d of getAllDevices()) {
            const devId = d.iniConfig.device ? d.iniConfig.device.id : '';
            const t = parseDeviceIdString(devId).deviceType;
            if (t && !types.includes(t)) types.push(t);
        }
        for (const t of types) {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            select.appendChild(opt);
        }
        // Если устройства того же типа есть — поле заполняется сразу.
        if (types.includes(parsed.deviceType)) {
            select.value = parsed.deviceType;
        } else if (types.length > 0) {
            select.value = types[0];
        }
    }

    selectedTemplateId = null;
    renderBackupTable();
    overlay.classList.remove('hidden');
}

function hideBackupWindow(): void {
    document.getElementById('backupOverlay')?.classList.add('hidden');
}

/** Таблица устройств выбранного типа; клик по строке — выбор шаблона. */
function renderBackupTable(): void {
    const tbody = document.getElementById('backupTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    selectedTemplateId = null;

    const select = document.getElementById('backupTypeSelect') as HTMLSelectElement | null;
    const type = select?.value ?? '';
    if (!type) return;

    const store = getFileStore();

    for (const d of getAllDevices()) {
        const dev = d.iniConfig.device;
        const devId = dev ? dev.id : '';
        if (parseDeviceIdString(devId).deviceType !== type) continue;

        const serial = parseDeviceIdString(devId).serial;
        const location = dev?.location ?? '';
        const mech = dev?.description ?? '';

        // Имя файла — из хранилища по ключу "location::id".
        let fileName = '—';
        const entry = store.get(`${location}::${devId}`);
        if (entry?.file) fileName = entry.file.name;

        const tr = document.createElement('tr');
        for (const text of [location, mech, serial, fileName]) {
            const td = document.createElement('td');
            td.textContent = text;
            td.title = text;
            tr.appendChild(td);
        }
        tr.addEventListener('click', () => {
            tbody.querySelectorAll('tr.is-selected').forEach((r) => r.classList.remove('is-selected'));
            tr.classList.add('is-selected');
            selectedTemplateId = d.id;
        });
        tbody.appendChild(tr);
    }
}
/**
 * "Применить": файл выбранной строки загружается в таблицу, но в строке ID=
 * серийный номер заменяется на номер подключённого блока;
 * Location= и Description= остаются только при взведенных галочках,
 * иначе эти строки удаляются. На диск ничего не пишется.
 */
async function handleBackupApply(): Promise<void> {
    if (!selectedTemplateId) {
        showIdModal('Выберите строку-шаблон в таблице.');
        return;
    }
    const templateDev = getAllDevices().find((d) => d.id === selectedTemplateId);
    if (!templateDev) {
        showIdModal('Шаблон не найден в реестре устройств.');
        return;
    }
    const dev = templateDev.iniConfig.device;
    const devId = dev ? dev.id : '';
    const loc = dev?.location ?? '';

    const store = getFileStore();
    const entry = store.get(`${loc || 'Неизвестное место'}::${devId || 'Без ID'}`);
    if (!entry || !entry.content) {
        showIdModal('Файл шаблона не найден в хранилище.');
        return;
    }

    const bannerId = (document.querySelector('.id-banner span')?.textContent ?? '').trim();
    const newSerial = parseDeviceIdString(bannerId).serial;
    if (!newSerial) {
        showIdModal('ID подключённого устройства пуст.');
        return;
    }

    const useLocation = (document.getElementById('backupUseLocation') as HTMLInputElement | null)?.checked ?? false;
    const useMech = (document.getElementById('backupUseMech') as HTMLInputElement | null)?.checked ?? false;

    const content = buildBackupContent(entry.content, newSerial, useLocation, useMech);

    // Новый ID — для выделения узла в дереве:
    // в ID шаблона меняем только первый токен (серийный номер).
    const tokens = devId.split(/\s+/);
    tokens[0] = newSerial;
    const newIdValue = tokens.join(' ');

    const fileName = entry.file ? entry.file.name : 'backup.ini';
    const bytes = encodeToWindows1251(content);
    const file = new File([bytes], fileName, { type: 'text/plain' });

    // Сохраняем резерв в папку базы и получаем ручку для редактирования.
    let fileHandle: FileSystemFileHandle | undefined;
    const dbFolder = await ensureDbFolder();
    if (dbFolder) {
        const result = await saveFileToDbFolder(dbFolder, fileName, bytes);
        if (result.status === 'saved' || result.status === 'exists') {
            fileHandle = result.fileHandle ?? undefined;
        }
    }

    if (loadFn) {
        await loadFn(content, fileName, file, fileHandle);
        selectBackupDeviceInTree(newIdValue);
    } else {
        console.warn('[backup] Связка с конвейером загрузки не установлена.');
    }
    // Закрываем оба окна: резерв и "Новое устройство".
    hideBackupWindow();
    document.getElementById('newDeviceOverlay')?.classList.add('hidden');
}

/**
 * Сборка контента резерва: в [DEVICE] строки ID= заменяем серийный номер,
 * Location=/Description= оставляем только при соответствующих галочках,
 * иначе удаляем эти строки.
 */
function buildBackupContent(
    templateText: string,
    newSerial: string,
    useLocation: boolean,
    useMech: boolean,
): string {
    const lines = templateText.split(/\r?\n/);
    const out: string[] = [];
    let inDevice = false;

    for (const line of lines) {
        const trimmed = line.trim();
        const sec = trimmed.match(/^\[(.*)\]$/);
        if (sec) {
            inDevice = ((sec[1] ?? '').trim().toUpperCase() === 'DEVICE');
            out.push(line);
            continue;
        }
        if (inDevice && trimmed.includes('=')) {
            const key = trimmed.split('=')[0].trim().toLowerCase();
            if (key === 'id') {
                const value = trimmed.substring(trimmed.indexOf('=') + 1).trim();
                const parts = value.split(/\s+/);
                parts[0] = newSerial;
                out.push(`ID=${parts.join(' ')}`);
                continue;
            }
            if (key === 'location' && !useLocation) continue; // удаляем строку
            if (key === 'description' && !useMech) continue; // удаляем строку
        }
        out.push(line);
    }
    return out.join('\n');
}

/** Выделяет в дереве узел созданного резерва. */
function selectBackupDeviceInTree(newIdValue: string): void {
    const found = getAllDevices().find((d) => (d.iniConfig.device ? d.iniConfig.device.id : '') === newIdValue);
    if (!found) return;
    document.querySelectorAll('.tree-id-item.is-selected').forEach((el) => el.classList.remove('is-selected'));
    const leaf = document.querySelector(`.tree-id-item.is-leaf[data-device-id="${CSS.escape(found.id)}"]`);
    if (leaf) leaf.classList.add('is-selected');
}