import { initTableEditor } from '../ini-manager/table-editor.js';

export interface UiManagerDeps {
    serial: any;
    appState: any;
    parser: any;
    view: any;
    buffers: any;
    setupFileHandling: (picker: HTMLInputElement, state: any) => void;
    setupFolderHandling?: (picker: HTMLInputElement) => void;
    updateComInterfaceName: (serial: any, select: HTMLSelectElement | null) => string;
    executeDeviceIdentification: (serial: any, select: HTMLSelectElement | null, state: any) => Promise<void>;
    readLoop: (serial: any, parser: any, view: any, buffers: any, state: any) => void;
    showIdModal: (text: string) => void;
    updateDeviceRegisters: (serial: any, slaveAddr: number, state: any) => Promise<boolean>; 
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

    // 2. Инициализация логики файлов
    // 2. Инициализация логики файлов
if (filePicker) setupFileHandling(filePicker, appState);
if (folderPicker && typeof setupFolderHandling === 'function') setupFolderHandling(folderPicker);

// Синхронизация внешнего readLoop с любым INI, который загружает осциллограф.
// Без этого при переключении INI через панель/дерево readLoop может остаться
// на старом appState.currentDeviceConfig, и графики перестают получать данные.
if (view && typeof view.loadIniContent === 'function') {
    const originalLoadIniContent = view.loadIniContent.bind(view);

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
                }
            }
        } catch (err) {
            console.warn('[uiManager] Failed to sync appState from INI content:', err);
        }

        return originalLoadIniContent(iniContent);
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
            } catch (err: any) { showIdModal("Ошибка: " + err.message); }
        });
    }

    if (idBtn) {
        idBtn.addEventListener("click", async () => {
            if (serial.isConnected) { showIdModal("Порт уже открыт!"); return; }
            await executeDeviceIdentification(serial, comSelect, appState);
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

