// src/ui/uiManager.ts

// src/ui/uiManager.ts
import { initTableEditor } from '../ini-manager/table-editor.js';
import type { ISerialPort } from '../serial/ISerialPort.js';

export interface UiManagerDeps {
    serial: ISerialPort;
    appState: any;
    parser: any;
    view: any;
    buffers: any;
    setupFileHandling: (picker: HTMLInputElement, state: any) => void;
    setupFolderHandling?: (picker: HTMLInputElement) => void;
    updateComInterfaceName: (serial: ISerialPort, select: HTMLSelectElement | null) => string;
    executeDeviceIdentification: (serial: ISerialPort, select: HTMLSelectElement | null, state: any) => Promise<void>;
    readLoop: (serial: ISerialPort, parser: any, view: any, buffers: any, state: any) => void;
    showIdModal: (text: string) => void;
    updateDeviceRegisters: (serial: ISerialPort, slaveAddr: number, state: any) => Promise<boolean>;
}

export function initUI(deps: UiManagerDeps): void {
    const {
        serial, appState, parser, view, buffers,
        setupFileHandling, setupFolderHandling, updateComInterfaceName,
        executeDeviceIdentification, readLoop, showIdModal, updateDeviceRegisters
    } = deps;

    // 1. DOM Элементы
    const filePicker = document.getElementById('filePicker') as HTMLInputElement | null;
    const folderPicker = document.getElementById('folderPicker') as HTMLInputElement | null;
    const idBtn = document.getElementById("idBtn") as HTMLButtonElement | null;
    const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement | null;
    const comSelect = document.getElementById("comSelect") as HTMLSelectElement | null;
    const toggleOscBtn = document.getElementById('toggleOscBtn') as HTMLButtonElement | null;
    const refreshBtn = document.getElementById("refresh-btn") as HTMLButtonElement | null;
    const folderActionBtn = document.getElementById('folderActionBtn') as HTMLButtonElement | null;
    const folderArrowBtn = document.getElementById('folderArrowBtn') as HTMLButtonElement | null;
    const folderDropdown = document.getElementById('folderDropdown') as HTMLElement | null;
    const menuOpenFile = document.getElementById('menuOpenFile') as HTMLElement | null;
    const menuOpenFolder = document.getElementById('menuOpenFolder') as HTMLElement | null;

    // Единая точка восстановления связи: уведомляет осциллограф и перезапускает опрос.
    // Вызывается после любого успешного (пере)открытия порта: «подключиться», «ID».
    const restoreConnection = (): void => {
        if (!serial.isConnected) return;

        // Сообщаем осциллографу: окно «Нет связи» закрывается, маркеры оживают
        const osc = (window as any).osc;
        if (osc && typeof osc.setConnectionStatus === 'function') {
            osc.setConnectionStatus(true);
        }

        // Перезапускаем опрос контроллера, только если осциллограф открыт
        const oscContainerEl = document.getElementById('osc-container');
        const isOscVisible = oscContainerEl &&
            !oscContainerEl.classList.contains('hidden') &&
            oscContainerEl.style.display !== 'none';

        if (isOscVisible) {
            console.log('[UI] Перезапускаем readLoop после восстановления связи');
            appState.isLoopRunning = false;
            appState.isPolling = true;
            readLoop(serial, parser, view, buffers, appState);
        }
    };

    // 2. Инициализация логики файлов
    if (filePicker) setupFileHandling(filePicker, appState);
    if (folderPicker && typeof setupFolderHandling === 'function') setupFolderHandling(folderPicker);

    // Синхронизация внешнего readLoop с любым INI, который загружает осциллограф.
    // Перехватываем loadIniContent чтобы:
    // 1. Обновить appState.currentDeviceConfig для readLoop
    // 2. Обновить appState.currentIniContent
    // 3. Принудительно перезапустить readLoop, чтобы он подхватил новый конфиг
    if (view && typeof view.loadIniContent === 'function' && !(view as any).__loadIniContentWrapped) {
        const originalLoadIniContent = view.loadIniContent.bind(view);
        (view as any).__loadIniContentWrapped = true;

        view.loadIniContent = async (iniContent: string) => {
            try {
                if (typeof iniContent === 'string' && iniContent.trim().length > 0) {
                    appState.currentIniContent = iniContent;

                    const parsedConfig = appState?.parser?.parse?.(iniContent);

                    if (
                        parsedConfig &&
                        (parsedConfig['RAM'] ||
                         parsedConfig['DEVICE'] ||
                         parsedConfig['CD'] ||
                         parsedConfig['FLASH'])
                    ) {
                        appState.currentDeviceConfig = parsedConfig;

                        const ramKeys = parsedConfig['RAM']
                            ? Object.keys(parsedConfig['RAM']).length
                            : 0;

                        console.log(`[INI SYNC] currentDeviceConfig updated. RAM keys: ${ramKeys}`);
                    }
                }
            } catch (err) {
                console.warn('[INI SYNC] Failed to sync appState:', err);
            }

            const result = await originalLoadIniContent(iniContent);

            // Принудительно перезапускаем readLoop, чтобы он подхватил новый currentDeviceConfig.
            // Сбрасываем isLoopRunning, иначе readLoop() вернётся сразу.
            // ВАЖНО: запускаем readLoop ТОЛЬКО если осциллограф открыт и есть связь.
            setTimeout(() => {
                try {
                    const oscContainerEl = document.getElementById('osc-container');
                    const isOscVisible = oscContainerEl &&
                        !oscContainerEl.classList.contains('hidden') &&
                        oscContainerEl.style.display !== 'none';

                    if (isOscVisible && serial.isConnected) {
                        appState.isLoopRunning = false;
                        appState.isPolling = true;
                        readLoop(serial, parser, view, buffers, appState);
                    } else {
                        console.log('[uiManager] readLoop не запущен: осциллограф закрыт или нет связи');
                    }
                } catch (err) {
                    console.warn('[uiManager] Failed to restart readLoop:', err);
                }
            }, 100);

            return result;
        };
    }

    // 3. События кнопок
    if (connectBtn) {
        connectBtn.addEventListener("click", async () => {
            if (serial.isConnected) { showIdModal("Порт уже открыт!"); return; }
            try {
                await serial.connect(115200);
                const chipName = updateComInterfaceName(serial, comSelect);
                console.log(`Успешно подключено к: ${chipName}`);
                restoreConnection();
            } catch (err: any) { showIdModal("Ошибка: " + err.message); }
        });
    }

    // Подписка на обрыв связи (выдернули USB, критическая ошибка ридера)
    if (serial && typeof serial.onDisconnect === 'function') {
        serial.onDisconnect(() => {
            console.log('[UI] Обрыв связи обнаружен, останавливаем опрос и уведомляем осциллограф');

            // Останавливаем опрос контроллера
            appState.isPolling = false;

            // Уведомляем осциллограф
            const osc = (window as any).osc;
            if (osc && typeof osc.setConnectionStatus === 'function') {
                osc.setConnectionStatus(false, 'Связь с устройством потеряна.');
            }
        });
    }

    if (idBtn) {
        idBtn.addEventListener("click", async () => {
            if (serial.isConnected) { showIdModal("Порт уже открыт!"); return; }
            await executeDeviceIdentification(serial, comSelect, appState);
            // Если порт открылся (в т.ч. после обрыва) — восстанавливаем связь и опрос
            restoreConnection();
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            if (!serial?.isConnected) { showIdModal("Устройство не подключено!"); return; }
            if (appState.isRefreshing) return;

            appState.isRefreshing = true; // Блокируем всё остальное
            refreshBtn.disabled = true;

            try {
                // 1. Сначала выполняем тяжелое обновление
                await updateDeviceRegisters(serial, appState.slaveAddress, appState);
                appState.isPolling = true;
            } catch (err) {
                console.error("Ошибка при обновлении:", err);
            } finally {
                // 2. Сбрасываем флаг БЛОКИРОВКИ ДО запуска цикла
                appState.isRefreshing = false;
                refreshBtn.disabled = false;

                // 3. Запускаем цикл
                console.log("DEBUG: Запускаю readLoop после обновления");
                readLoop(serial, parser, view, buffers, appState);
            }
        });
    }

    if (toggleOscBtn) {
        toggleOscBtn.addEventListener('click', async () => {
            const oscContainerEl = document.getElementById('osc-container');
            if (!oscContainerEl) return;

            const isHidden = oscContainerEl.classList.contains('hidden') || oscContainerEl.style.display === 'none';

            if (isHidden) {
                oscContainerEl.classList.remove('hidden');
                oscContainerEl.style.display = 'block';

                appState.isPolling = true;

                if ((window as any).osc) {
                    const osc = (window as any).osc;
                    await osc.initialize(oscContainerEl);
                    if (appState.currentIniContent) {
                        osc.loadIniContent(appState.currentIniContent);
                    }

                    // Проверка связи при открытии осциллографа
                    if (typeof osc.setConnectionStatus === 'function') {
                        osc.setConnectionStatus(serial.isConnected, serial.isConnected ? undefined : 'Нет связи с устройством.');
                    }

                    readLoop(serial, parser, osc, buffers, appState);
                }
            } else {
                oscContainerEl.classList.add('hidden');
                oscContainerEl.style.display = 'none';
                appState.isPolling = false;
            }
        });
    }

    // 4. Логика выпадающего меню папок
    if (folderActionBtn) folderActionBtn.addEventListener('click', (e) => { e.stopPropagation(); filePicker?.click(); });
    if (menuOpenFile) menuOpenFile.addEventListener('click', () => { filePicker?.click(); folderDropdown?.classList.remove('show'); });
    if (menuOpenFolder) menuOpenFolder.addEventListener('click', () => { folderPicker?.click(); folderDropdown?.classList.remove('show'); });
    if (folderArrowBtn) folderArrowBtn.addEventListener('click', (e) => { e.stopPropagation(); folderDropdown?.classList.toggle('show'); });

    document.addEventListener('click', () => folderDropdown?.classList.remove('show'));

    // 5. Инициализация инлайн-редактора таблицы
    initTableEditor('grid-data-rows', appState);

    console.log("UI Manager: Интерфейс и обработчики инициализированы.");
}