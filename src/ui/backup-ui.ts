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
import { ensureDbFolder, saveFileToDbFolder, DbDirectoryHandleLike } from '../ini-manager/db-folder.js'

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

export interface BackupWindowSource {
    mechInputId?: string;
    locInputId?: string;
    callerOverlayId?: string;
}

/** Окно-источник: откуда брать Механизм/Расположение и что закрывать после применения. */
let currentSource = {
    mechInputId: 'newDeviceMechInput',
    locInputId: 'newDeviceLocInput',
    callerOverlayId: 'newDeviceOverlay',
};

/** Открывает окно и заполняет данные создаваемого устройства. */
export function showBackupWindow(source?: BackupWindowSource): void {
    const overlay = document.getElementById('backupOverlay');
    if (!overlay) return;

    const mechInputId = source?.mechInputId ?? 'newDeviceMechInput';
    const locInputId = source?.locInputId ?? 'newDeviceLocInput';
    currentSource = {
        mechInputId,
        locInputId,
        callerOverlayId: source?.callerOverlayId ?? 'newDeviceOverlay',
    };

    const idText = (document.querySelector('.id-banner span')?.textContent ?? '').trim();
    const parsed = parseDeviceIdString(idText);

    // Блок "Устройство" — данные создаваемого устройства.
    const info = document.getElementById('backupDeviceInfo');
    if (info) {
        const mech = (document.getElementById(mechInputId) as HTMLInputElement | null)?.value.trim() ?? '';
        const loc = (document.getElementById(locInputId) as HTMLInputElement | null)?.value.trim() ?? '';
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
            // Резервные копии (файлы xxx_old.ini, помеченные красным) — не шаблоны
            if (d.isBackup) continue;
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
        // Резервные копии (файлы xxx_old.ini, помеченные красным) — не шаблоны
        if (d.isBackup) continue;
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
    console.log('[backup] Apply: selectedTemplateId =', selectedTemplateId);
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

    // Ищем контент шаблона в хранилище: сначала по ключу, затем перебором по ID в [DEVICE]
    const store = getFileStore();
    let entry = store.get(`${dev?.location ?? ''}::${devId}`);
    if (!entry?.content) entry = findStoreEntryByDeviceId(devId);
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

    // Значения из окна-источника (Новое устройство или Обновление ПО)
    const callerMech = (document.getElementById(currentSource.mechInputId) as HTMLInputElement | null)?.value.trim() ?? '';
    const callerLoc = (document.getElementById(currentSource.locInputId) as HTMLInputElement | null)?.value.trim() ?? '';

    // ID= в новом файле — полная строка подключённого контроллера (как в окне "Новое устройство")
    const content = buildBackupContent(entry.content, bannerId, useLocation, useMech, callerLoc, callerMech);

    // Новый ID — для выделения узла в дереве: полная строка подключённого контроллера.
    const newIdValue = bannerId;

    // Имя нового файла: базовое имя шаблона + серийный номер нового устройства,
    // чтобы не столкнуться с уже существующим файлом шаблона.
    const templateBase = entry.file ? entry.file.name.replace(/\.ini$/i, '') : 'backup';
    const fileName = `${templateBase}_${newSerial}.ini`;
    const bytes = encodeToWindows1251(content);
    const file = new File([bytes], fileName, { type: 'text/plain' });

            // Сохраняем резерв в папку базы.
    // Приоритет 1: используем parentHandle из шаблона (если файл был открыт через папку).
    // Приоритет 2: fallback на ensureDbFolder() (если parentHandle нет).
    let fileHandle: FileSystemFileHandle | undefined;
    let dbFolder: DbDirectoryHandleLike | null = null;

    // Пытаемся получить родительскую папку из записи шаблона
    if (entry && entry.parentHandle) {
        dbFolder = entry.parentHandle;
        console.log(`[backup] Используем parentHandle из шаблона: ${entry.file.name}`);
    } else {
        // Fallback: запрашиваем папку базы через ensureDbFolder
        dbFolder = await ensureDbFolder();
        if (!dbFolder) {
            console.warn('[backup] Папка базы не выбрана или недоступна.');
            showIdModal('Не удалось определить папку для сохранения резерва. Откройте файлы через "Открыть папку".');
            return;
        }
    }

    if (dbFolder) {
        const result = await saveFileToDbFolder(dbFolder, fileName, bytes);
        
        if (result.status === 'saved' || result.status === 'exists') {
            let savedHandle = result.fileHandle ?? undefined;
            
            // Страховка: если saveFileToDbFolder сохранил файл, но не вернул handle,
            // получаем handle напрямую из папки базы.
            if (!savedHandle) {
                try {
                    savedHandle = await dbFolder.getFileHandle(fileName, { create: false });
                    console.log(`[backup] Handle для ${fileName} получен напрямую из папки базы.`);
                } catch (err) {
                    console.error(`[backup] Файл ${fileName} сохранён, но handle получить не удалось:`, err);
                }
            }
            
            fileHandle = savedHandle;
            
            if (result.status === 'saved') {
                console.log(`[backup] Файл ${fileName} сохранён в папку базы.`);
            } else {
                console.warn(`[backup] Файл ${fileName} уже есть в папке базы и НЕ перезаписан.`);
            }
        } else {
            console.warn('[backup] Сохранить в папку базы не удалось.');
            showIdModal('Ошибка сохранения файла резерва.');
        }
    }

    if (loadFn) {
        await loadFn(content, fileName, file, fileHandle);
        selectBackupDeviceInTree(newIdValue);
    } else {
        console.warn('[backup] Связка с конвейером загрузки не установлена.');
    }

    // Закрываем окно резерва и окно-источник.
    hideBackupWindow();
    document.getElementById(currentSource.callerOverlayId)?.classList.add('hidden');
}

/** Ищет запись хранилища по ID устройства из секции [DEVICE]. */
function findStoreEntryByDeviceId(devId: string) {
    const store = getFileStore();
    for (const [, e] of store) {
        if (!e.content) continue;
        const m = e.content.match(/^\s*ID\s*=\s*(.+)$/m);
        if (m && (m[1] ?? '').trim() === devId) return e;
    }
    return undefined;
}

/**
 * Сборка контента резерва: в [DEVICE] строки ID= заменяем серийный номер,
 * Location=/Description= оставляем только при соответствующих галочках,
 * иначе удаляем эти строки.
 */
/**
 * Сборка контента резерва:
 *  - ID= : серийный номер заменяется на номер подключённого блока;
 *  - галочка стоит   → Location=/Description= берутся ИЗ ШАБЛОНА (строка как есть);
 *  - галочки нет     → Location=/Description= берутся ИЗ ОКНА-ИСТОЧНИКА
 *                       (если там пусто — строка отсутствует);
 */
function buildBackupContent(
    templateText: string,
    newIdText: string,
    useLocation: boolean,
    useMech: boolean,
    callerLocation: string,
    callerMech: string,
): string {
    const lines = templateText.split(/\r?\n/);
    const out: string[] = [];
    let inDevice = false;
    let deviceSeen = false;
    let idDone = false;
    let locDone = false;
    let descDone = false;

    const locLine = callerLocation ? `Location=${callerLocation}` : '';
    const descLine = callerMech ? `Description=${callerMech}` : '';

    const flushMissing = (): void => {
        if (!idDone) out.push(`ID=${newIdText}`);
        if (!useLocation && locLine && !locDone) out.push(locLine);
        if (!useMech && descLine && !descDone) out.push(descLine);
    };

    for (const line of lines) {
        const trimmed = line.trim();
        const sec = trimmed.match(/^\[(.*)\]$/);
        if (sec) {
            if (inDevice) flushMissing();
            inDevice = ((sec[1] ?? '').trim().toUpperCase() === 'DEVICE');
            if (inDevice) deviceSeen = true;
            out.push(line);
            continue;
        }
        if (inDevice && trimmed.includes('=')) {
            const key = trimmed.split('=')[0].trim().toLowerCase();
                       if (key === 'id') {
                out.push(`ID=${newIdText}`);
                idDone = true;
                continue;
            }
            if (key === 'location') {
                locDone = true;
                if (useLocation) out.push(line);          // из шаблона
                else if (locLine) out.push(locLine);       // из окна-источника
                // иначе строка удаляется
                continue;
            }
            if (key === 'description') {
                descDone = true;
                if (useMech) out.push(line);               // из шаблона
                else if (descLine) out.push(descLine);     // из окна-источника
                continue;
            }
        }
        out.push(line);
    }
    if (inDevice) flushMissing();
    if (!deviceSeen) {
        out.unshift(
            '[DEVICE]',
            `ID=${newIdText}`,
            ...(!useLocation && locLine ? [locLine] : []),
            ...(!useMech && descLine ? [descLine] : []),
            '',
        );
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