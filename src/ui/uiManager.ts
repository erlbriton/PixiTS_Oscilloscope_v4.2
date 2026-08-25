// src/ui/uiManager.ts
import { initTableEditor } from '../ini-manager/table-editor.js';
import { setupSaveButton } from '../ini-manager/save-ini.js';
import { openIniFile } from '../ini-manager/file-loader.js';
import type { ISerialPort } from '../serial/ISerialPort.js';
import type { AppState } from '../core/app-state.js';
import type { IOscilloscopeApi } from '../core/osc-api.js';
import type { ModbusParser } from '../serial/modbus.js';
import { IniParser as CoreIniParser, IniConfig } from '../core/ini/index.js';
import { RecFileReader } from '../oscilloscope/core/RecFileReader.js';
import { updateIdBanner } from './ui.js';

/** Буфер данных канала (типизирован явно, без any) */
export interface ChannelBuffer {
  push(v: number): void;
  get(idx: number): number;
  readonly length: number;
  readonly data: number[];
  clear(): void;
  toArray(): number[];
}

export interface UiManagerDeps {
  serial: ISerialPort;
  appState: AppState;                    // было any
  parser: ModbusParser;                  // было any
  view: IOscilloscopeApi;                // было any
  buffers: ChannelBuffer[];              // было any
  setupFileHandling: (picker: HTMLInputElement, state: AppState) => void;
  setupFolderHandling?: (picker: HTMLInputElement) => void;
  updateComInterfaceName: (serial: ISerialPort, select: HTMLSelectElement | null) => string;
  executeDeviceIdentification: (
    serial: ISerialPort,
    select: HTMLSelectElement | null,
    state: AppState,
    baudSelect?: HTMLSelectElement | null
  ) => Promise<void>;
  readLoop: (
    serial: ISerialPort,
    parser: unknown,
    view: IOscilloscopeApi | null,
    buffers: ChannelBuffer[] | null,
    state: AppState
  ) => void;
  showIdModal: (text: string) => void;
  updateDeviceRegisters: (
    serial: ISerialPort,
    slaveAddr: number,
    state: AppState
  ) => Promise<boolean>;
}

export function initUI(deps: UiManagerDeps): void {
  const {
    serial, appState, parser, view, buffers,
    setupFileHandling, setupFolderHandling, updateComInterfaceName,
    executeDeviceIdentification, readLoop, showIdModal, updateDeviceRegisters
  } = deps;

  const filePicker = document.getElementById('filePicker') as HTMLInputElement | null;
  const folderPicker = document.getElementById('folderPicker') as HTMLInputElement | null;
  const idBtn = document.getElementById("idBtn") as HTMLButtonElement | null;
  const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement | null;
  const comSelect = document.getElementById("comSelect") as HTMLSelectElement | null;
  const baudSelect = document.getElementById("baudSelect") as HTMLSelectElement | null;
  const toggleOscMainBtn = document.getElementById('toggleOscMainBtn') as HTMLButtonElement | null;
  const toggleOscArrowBtn = document.getElementById('toggleOscArrowBtn') as HTMLButtonElement | null;
  const toggleOscDropdown = document.getElementById('toggleOscDropdown') as HTMLElement | null;
  const menuToggleOsc = document.getElementById('menuToggleOsc') as HTMLElement | null;
  const menuViewRec = document.getElementById('menuViewRec') as HTMLElement | null;
  const refreshBtn = document.getElementById("refresh-btn") as HTMLButtonElement | null;
  const folderActionBtn = document.getElementById('folderActionBtn') as HTMLButtonElement | null;
  const folderArrowBtn = document.getElementById('folderArrowBtn') as HTMLButtonElement | null;
  const folderDropdown = document.getElementById('folderDropdown') as HTMLElement | null;
  const menuOpenFile = document.getElementById('menuOpenFile') as HTMLElement | null;
  const menuOpenFolder = document.getElementById('menuOpenFolder') as HTMLElement | null;

  const restoreConnection = (): void => {
    if (!serial.isConnected) return;
    // БЫЛО: const osc = (window as any).osc;
    // СТАЛО:
    const osc = window.osc;
    if (osc && typeof osc.setConnectionStatus === 'function') {
      osc.setConnectionStatus(true);
    }
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

  if (filePicker) setupFileHandling(filePicker, appState);
  if (folderPicker && typeof setupFolderHandling === 'function') setupFolderHandling(folderPicker);

  // Обёртка loadIniContent — типизирована через IOscilloscopeApi
  if (view && typeof view.loadIniContent === 'function' && !(view as unknown as Record<string, unknown>).__loadIniContentWrapped) {
    const originalLoadIniContent = view.loadIniContent.bind(view);
    (view as unknown as Record<string, unknown>).__loadIniContentWrapped = true;
    view.loadIniContent = async (iniContent: string) => {
      try {
                        if (typeof iniContent === 'string' && iniContent.trim().length > 0) {
                    appState.currentIniContent = iniContent;
          const coreParser = new CoreIniParser();
          const parseResult = coreParser.parse(iniContent);
          appState.currentIniConfig = new IniConfig(parseResult);
          console.log('[INI SYNC] currentIniConfig updated.');
        }
      } catch (err) {
        console.warn('[INI SYNC] Failed to sync appState:', err);
      }
      return originalLoadIniContent(iniContent);
    };
  }

    if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
      if (serial.isConnected) { 
          showIdModal("Порт уже открыт!"); 
          return; 
      }
      
      // Берем скорость из селектора
      const baudRate = baudSelect ? parseInt(baudSelect.value, 10) || 115200 : 115200;
      
      try {
        await serial.connect(baudRate);
        console.log(`[DEBUG] Подключено на скорости: ${baudRate}`);
        
        const chipName = updateComInterfaceName(serial, comSelect);
        console.log(`Успешно подключено к: ${chipName}`);
        
        const osc = window.osc;
        if (osc && typeof osc.setSerialPort === 'function') {
            osc.setSerialPort(serial);
        }
        
        restoreConnection();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showIdModal("Ошибка: " + msg);
      }
    });
  }

  if (serial && typeof serial.onDisconnect === 'function') {
    serial.onDisconnect(() => {
      console.log('[UI] Обрыв связи обнаружен');
      appState.isPolling = false;
      updateIdBanner('');
      const osc = window.osc;
      if (osc && typeof osc.setConnectionStatus === 'function') {
        osc.setConnectionStatus(false, 'Связь с устройством потеряна.');
      }
    });
  }

    if (idBtn) {
    idBtn.addEventListener("click", async () => {
      if (serial.isConnected) { 
          showIdModal("Порт уже открыт!"); 
          return; 
      }
      // Передаем baudSelect в функцию идентификации
      await executeDeviceIdentification(serial, comSelect, appState, baudSelect);
      
      const osc = window.osc;
      if (osc && typeof osc.setSerialPort === 'function') {
          osc.setSerialPort(serial);
      }
      
      restoreConnection();
    });
  }

  // Обновление таблицы (FC03). Используется и кнопкой "Обновить",
  // и автообновлением после загрузки INI-файла.
  const performRefresh = async (notifyIfDisconnected: boolean): Promise<void> => {
    if (!serial?.isConnected) {
      if (notifyIfDisconnected) showIdModal("Устройство не подключено!");
      return;
    }
    if (appState.isRefreshing) return;
    appState.isRefreshing = true;
    if (refreshBtn) refreshBtn.disabled = true;

    const wasPolling = appState.isPolling;

    try {
      // Выполняем обновление таблицы
      await updateDeviceRegisters(serial, appState.slaveAddress, appState);

      // Восстанавливаем опрос, если он был активен до обновления
      if (wasPolling) {
        console.log('[UI] Восстанавливаем опрос после обновления');
        appState.isLoopRunning = false;
        appState.isPolling = true;
        readLoop(serial, parser, view, buffers, appState);
      }
    } catch (err) {
      console.error("Ошибка при обновлении:", err);
    } finally {
      appState.isRefreshing = false;
      if (refreshBtn) refreshBtn.disabled = false;
    }
  };

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      await performRefresh(true);
    });
  }

  // Автообновление после загрузки/смены INI-файла: тихо, только если порт открыт
  window.addEventListener('app:ini-file-loaded', () => {
    void performRefresh(false);
  });

      // Функция переключения видимости осциллографа
  const toggleOscilloscope = async () => {
    const oscContainerEl = document.getElementById('osc-container');
    if (!oscContainerEl) return;
    const isHidden = oscContainerEl.classList.contains('hidden') || oscContainerEl.style.display === 'none';

    if (isHidden) {
      oscContainerEl.classList.remove('hidden');
      oscContainerEl.style.display = 'block';
      appState.isPolling = true;
      const osc = window.osc;
      if (osc) {
        await osc.initialize(oscContainerEl ?? undefined);
        if (appState.currentIniContent) {
          await osc.loadIniContent(appState.currentIniContent);
        }
        if (typeof osc.setConnectionStatus === 'function') {
          osc.setConnectionStatus(
            serial.isConnected,
            serial.isConnected ? undefined : 'Нет связи с устройством.'
          );
        }
        readLoop(serial, parser, osc, buffers, appState);
      }
    } else {
      oscContainerEl.classList.add('hidden');
      oscContainerEl.style.display = 'none';
      appState.isPolling = false;
    }
  };

  // 1. Клик по основной части кнопки (📈)
  if (toggleOscMainBtn) {
    toggleOscMainBtn.addEventListener('click', async () => {
      await toggleOscilloscope();
    });
  }

  // 2. Клик по стрелочке (открыть меню)
  if (toggleOscArrowBtn) {
    toggleOscArrowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleOscDropdown?.classList.toggle('show');
    });
  }

  // 3. Пункт меню "Осциллограф"
  if (menuToggleOsc) {
    menuToggleOsc.addEventListener('click', async () => {
      await toggleOscilloscope();
      toggleOscDropdown?.classList.remove('show');
    });
  }

      // 4. Пункт меню "Просмотр осциллограммы" — открывает новую вкладку
  if (menuViewRec) {
    menuViewRec.addEventListener('click', () => {
      toggleOscDropdown?.classList.remove('show');
      window.open('/rec-viewer.html', '_blank');
    });
  }

  if (folderActionBtn) folderActionBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await openIniFile(appState);
  });
  if (menuOpenFile) menuOpenFile.addEventListener('click', async () => {
    await openIniFile(appState);
    folderDropdown?.classList.remove('show');
  });
  if (menuOpenFolder) menuOpenFolder.addEventListener('click', () => { folderPicker?.click(); folderDropdown?.classList.remove('show'); });
  if (folderArrowBtn) folderArrowBtn.addEventListener('click', (e) => { e.stopPropagation(); folderDropdown?.classList.toggle('show'); });
    document.addEventListener('click', () => {
    folderDropdown?.classList.remove('show');
    toggleOscDropdown?.classList.remove('show');
  });

  // Обработчик смены скорости: ЖЕСТКИЙ сброс и переподключение
    // Обработчик смены скорости: просто запоминаем выбор для следующего подключения.
  // Переподключение "на лету" удалено из-за нестабильности Web Serial API.
  if (baudSelect) {
    baudSelect.addEventListener('change', () => {
      const newBaudRate = parseInt(baudSelect.value, 10) || 115200;
      
      if (serial.isConnected) {
        console.log(`[UI] Скорость изменена на ${newBaudRate}. Для применения необходимо переподключиться (кнопка "Подключить").`);
        // Опционально: можно показать подсказку пользователю, но пока оставим лог.
        // showIdModal(`Скорость изменена на ${newBaudRate}. Нажмите "Подключить", чтобы применить.`);
      } else {
        console.log(`[UI] Скорость установлена на ${newBaudRate} (будет использована при подключении).`);
      }
    });
  }

  initTableEditor('grid-data-rows', appState);
  setupSaveButton(appState);
  console.log("UI Manager: Интерфейс и обработчики инициализированы.");
}