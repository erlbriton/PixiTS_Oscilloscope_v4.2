// src/ui/new-device-ui.ts
/**
 * Окно "Новое устройство": появляется, когда для подключённого
 * контроллера не найден родной INI-файл среди загруженных.
 *
 * Сейчас: показ окна + заполнение верхней части из строки ID.
 * Поведение кнопок (резерв, добавление в базу, шаблоны) — следующие шаги.
 */
import { parseDeviceIdString } from '../core/report-data.js';
import { getAllDevices } from '../ini-manager/tree-core.js';
import { showIdModal } from './ui.js';
import { ensureDbFolder, saveFileToDbFolder, downloadFallback, changeDbFolder } from '../ini-manager/db-folder.js';
import { readFileWithEncoding, encodeToWindows1251 } from '../core/encoding.js';
import { showBackupWindow } from './backup-ui.js';

/** Выбранные шаблоны: имя → File */
const templateFiles = new Map<string, File>();

/** Функция-связка с конвейером загрузки (вставляет uiManager, у него есть appState) */
type AddToLoadedFn = (
    content: string,
    fileName: string,
    file: File,
    handle?: FileSystemFileHandle,
) => Promise<void>;
let addToLoadedFn: AddToLoadedFn | null = null;

export function setNewDeviceAddToLoaded(fn: AddToLoadedFn): void {
    addToLoadedFn = fn;
}

export function getTemplateFile(name: string): File | null {
    return templateFiles.get(name) ?? null;
}

export function initNewDeviceUI(): void {
    document.getElementById('newDeviceCloseBtn')?.addEventListener('click', () => {
        hideNewDeviceModal();
    });

    document.getElementById('newDeviceCancelBtn')?.addEventListener('click', () => {
        hideNewDeviceModal();
    });

           // "Создать резерв для блока": открывает окно выбора устройства-шаблона.
    document.getElementById('newDeviceBackupBtn')?.addEventListener('click', () => {
        showBackupWindow();
    });

    // "Сменить папку базы…": принудительно выбрать и запомнить новую папку.
    // Ближайшее нажатие "Добавить устройство в базу" запишет уже в неё.
    document.getElementById('newDeviceChangeFolderBtn')?.addEventListener('click', () => {
        void (async () => {
            const handle = await changeDbFolder();
            setNewDeviceStatus(handle ? 'Папка базы изменена.' : 'Папка не изменена (выбор отменён).');
        })();
    });
    // "Сменить папку базы…": принудительно выбрать и запомнить новую папку.
    // Ближайшее нажатие "Добавить устройство в базу" запишет уже в неё.
    document.getElementById('newDeviceChangeFolderBtn')?.addEventListener('click', () => {
        void (async () => {
            const handle = await changeDbFolder();
            setNewDeviceStatus(handle ? 'Папка базы изменена.' : 'Папка не изменена (выбор отменён).');
        })();
    });
    document.getElementById('newDeviceAddBtn')?.addEventListener('click', () => {
        void handleAddToBase();
    });

    // "Добавить шаблон": стандартный диалог множественного выбора файлов.
    // Шаблоны — ини-файлы без расширения, поэтому у templatePicker нет accept:
    // пользователь сам заходит в папку Template и выбирает нужное.
    document.getElementById('newDeviceAddTemplateBtn')?.addEventListener('click', () => {
        document.getElementById('templatePicker')?.click();
    });

    const templatePicker = document.getElementById('templatePicker') as HTMLInputElement | null;
    templatePicker?.addEventListener('change', () => {
        const files = Array.from(templatePicker.files ?? []);
        if (files.length === 0) return;
        const select = document.getElementById('newDeviceTemplateSelect') as HTMLSelectElement | null;
        if (!select) return;

        for (const file of files) {
            templateFiles.set(file.name, file);
            // Дубликаты в список не добавляем (повторный выбор обновляет File)
            const exists = Array.from(select.options).some((opt) => opt.value === file.name);
            if (!exists) {
                const option = document.createElement('option');
                option.value = file.name;
                option.textContent = file.name;
                select.appendChild(option);
            }
        }

        console.log(`[new-device] Добавлены шаблоны: ${files.map((f) => f.name).join(', ')}`);
        // Сбрасываем, чтобы повторный выбор того же набора тоже сработал
        templatePicker.value = '';
    });
}

/**
 * Показывает окно и заполняет верхнюю часть из строки ID,
 * например: "00048484 DExS.SMFCB v1.10.6.1 18.07.2022 www.intmash.ru".
 */
export function showNewDeviceModal(idText: string): void {
    const overlay = document.getElementById('newDeviceOverlay');
    if (!overlay) return;

    const idInput = document.getElementById('newDeviceIdInput') as HTMLInputElement | null;
    const typeInput = document.getElementById('newDeviceTypeInput') as HTMLInputElement | null;
    const verDevice = document.getElementById('newDeviceVerDevice');
    const verFw = document.getElementById('newDeviceVerFw');
    const fwDate = document.getElementById('newDeviceFwDate');

    const parsed = parseDeviceIdString(idText);
    if (idInput) idInput.value = idText;
    if (typeInput) typeInput.value = parsed.deviceType;

    // Версия вида "1.10.6.1": версия устройства — первые три компоненты,
    // версия прошивки — последняя (как в старом аджастере).
    const verParts = parsed.version.split('.');
    if (verDevice) verDevice.textContent = verParts.length >= 4 ? verParts.slice(0, 3).join('.') : parsed.version;
    if (verFw) verFw.textContent = verParts.length >= 4 ? verParts[verParts.length - 1] : '—';

    // Дата прошивки — четвёртый токен строки ID.
    const tokens = idText.trim().split(/\s+/);
    if (fwDate) fwDate.textContent = tokens[3] ?? '—';

    overlay.classList.remove('hidden');
}

function hideNewDeviceModal(): void {
    document.getElementById('newDeviceOverlay')?.classList.add('hidden');
}

/**
 * Кнопка "Добавить устройство в базу":
 *  1) собирает INI из шаблона (ID/Location/Description в [DEVICE]);
 *  2) добавляет устройство к загруженным и выделяет его в дереве;
 *  3) сохраняет файл в запомненную папку базы; при любом сбое —
 *     скачивает в "Загрузки", чтобы данные не потерялись.
 */
async function handleAddToBase(): Promise<void> {
    const select = document.getElementById('newDeviceTemplateSelect') as HTMLSelectElement | null;
    const templateName = (select?.value ?? '').trim();
    if (!templateName) {
        setNewDeviceStatus('Выберите шаблон из списка.');
        return;
    }
    const templateFile = getTemplateFile(templateName);
    if (!templateFile) {
        setNewDeviceStatus('Файл шаблона не найден — добавьте шаблоны ещё раз.');
        return;
    }

    const idText = (document.querySelector('.id-banner span')?.textContent ?? '').trim();
    if (!idText) {
        setNewDeviceStatus('ID устройства пуст — сначала подключите устройство.');
        return;
    }

    // ВАЖНО: запрашиваем папку в самом начале клика — браузер разрешает
    // диалоги/плашки только внутри пользовательского жеста.
    const folderPromise = ensureDbFolder();

    const locInput = document.getElementById('newDeviceLocInput') as HTMLInputElement | null;
    const mechInput = document.getElementById('newDeviceMechInput') as HTMLInputElement | null;
    const location = (locInput?.value ?? '').trim();
    const description = (mechInput?.value ?? '').trim();

    let templateText = '';
    try {
        templateText = await readFileWithEncoding(templateFile);
    } catch (err) {
        console.error('[new-device] Не удалось прочитать шаблон:', err);
        setNewDeviceStatus('Не удалось прочитать файл шаблона.');
        return;
    }

    const content = buildDeviceIniContent(templateText, idText, location, description);
    const fileName = templateName + '.ini';
    // Пишем в Windows-1251 — как вся база и как старый аджастер:
    // новый файл неотличим от старых.
    const bytes = encodeToWindows1251(content);
    // File-объект обязателен: без него конвейер пропустит fileStore.set(),
    // и файл будет "не найден в хранилище" при редактировании/сохранении.
    const file = new File([bytes], fileName, { type: 'text/plain' });

    // 1) Сохраняем на диск; заодно получаем ручку файла —
    //    с ней новый файл будет доступен для редактирования сразу.
    const handle = await folderPromise;
    let fileHandle: FileSystemFileHandle | undefined;
    let existed = false;
    let savedToDb = false;

    if (handle) {
        const res = await saveFileToDbFolder(handle, fileName, bytes);
        if (res.status === 'saved') {
            savedToDb = true;
            fileHandle = res.fileHandle ?? undefined;
            console.log(`[new-device] Файл ${fileName} сохранён в папку базы.`);
        } else if (res.status === 'exists') {
            savedToDb = true;
            existed = true;
            fileHandle = res.fileHandle ?? undefined;
            console.warn(`[new-device] Файл ${fileName} уже есть в папке базы и НЕ перезаписан.`);
        } else {
            console.warn('[new-device] Сохранить в папку базы не удалось — скачиваю в "Загрузки".');
        }
    }

    if (!savedToDb) {
        downloadFallback(fileName, bytes);
        console.log(`[new-device] Файл ${fileName} скачан в "Загрузки".`);
    }

    // 2) Добавляем к загруженным (передаём ручку — тогда редактирование
    //    доступно) и выделяем в дереве.
    if (addToLoadedFn) {
        await addToLoadedFn(content, fileName, file, fileHandle);
        selectNewDeviceInTree(idText);
    } else {
        console.warn('[new-device] Связка с конвейером загрузки не установлена.');
    }

    hideNewDeviceModal();
    if (existed) {
        showIdModal(`Файл ${fileName} уже есть в папке базы и НЕ перезаписан.`);
    }
}

/**
 * Вставляет/заменяет в секции [DEVICE] шаблона строки
 * ID=, Location=, Description= (последние две — если значения не пустые).
 */
function buildDeviceIniContent(
    templateText: string,
    idText: string,
    location: string,
    description: string,
): string {
    const lines = templateText.split(/\r?\n/);
    const out: string[] = [];
    let inDevice = false;
    let deviceSeen = false;
    let idDone = false;
    let locDone = false;
    let descDone = false;

    const flushMissing = (): void => {
        if (!idDone) out.push(`ID=${idText}`);
        if (location && !locDone) out.push(`Location=${location}`);
        if (description && !descDone) out.push(`Description=${description}`);
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
                out.push(`ID=${idText}`);
                idDone = true;
                continue;
            }
            if (key === 'location' && location) {
                out.push(`Location=${location}`);
                locDone = true;
                continue;
            }
            if (key === 'description' && description) {
                out.push(`Description=${description}`);
                descDone = true;
                continue;
            }
        }
        out.push(line);
    }
    if (inDevice) flushMissing();
    if (!deviceSeen) {
        out.unshift(
            '[DEVICE]',
            `ID=${idText}`,
            ...(location ? [`Location=${location}`] : []),
            ...(description ? [`Description=${description}`] : []),
            '',
        );
    }
    return out.join('\n');
}

/** Выделяет в дереве узел только что добавленного устройства. */
function selectNewDeviceInTree(idText: string): void {
    const found = getAllDevices().find((d) => (d.iniConfig.device ? d.iniConfig.device.id : '') === idText);
    if (!found) return;
    document.querySelectorAll('.tree-id-item.is-selected').forEach((el) => el.classList.remove('is-selected'));
    const leaf = document.querySelector(`.tree-id-item.is-leaf[data-device-id="${CSS.escape(found.id)}"]`);
    if (leaf) leaf.classList.add('is-selected');
}

/** Строка-статус внизу окна (для сообщений без модальных окон). */
function setNewDeviceStatus(text: string): void {
    const note = document.querySelector('.new-device-note');
    if (note) note.textContent = text;
}