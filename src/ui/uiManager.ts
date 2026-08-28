// src/ui/uiManager.ts

import { initTableEditor } from '../ini-manager/table-editor.js';
import { setupSaveButton } from '../ini-manager/save-ini.js';
import { openIniFile, openIniFolder } from '../ini-manager/file-loader.js';
import type { ISerialPort } from '../serial/ISerialPort.js';
import type { AppState } from '../core/app-state.js';
import type { IOscilloscopeApi } from '../core/osc-api.js';
import type { ModbusParser } from '../serial/modbus.js';
import { IniParser as CoreIniParser, IniConfig } from '../core/ini/index.js';
//import { RecFileReader } from '../oscilloscope/core/RecFileReader.js';
//import { updateIdBanner } from './ui.js';
import { updateIdBanner, showCompactError } from './ui.js';
import { reloadIniFilesFromDisk } from '../ini-manager/file-loader.js';
import { isLinux } from '../core/platform.js';
import { initModbusScanUI } from './modbus-scan-ui.js';
import { initReportUI } from './report-ui.js';
import { initCmdlineUI } from './cmdline-ui.js';
import { getFileStore } from '../ini-manager/file-loader.js';
import { setTreeGroupMode } from '../ini-manager/tree-core.js';
import { renderDeviceTree } from '../ini-manager/tree-ui.js';
import type { TreeGroupMode } from '../ini-manager/tree-core.js';
import { showAddressDialog } from './confirm-dialog.js';

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
  const addrBtn = document.getElementById("addrBtn") as HTMLButtonElement | null;
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
      // Выполняем обновление таблицы и проверяем результат
      const success = await updateDeviceRegisters(serial, appState.slaveAddress, appState);

      if (success) {
        // Успешно: восстанавливаем опрос, если он был активен до обновления
        if (wasPolling) {
          console.log('[UI] Восстанавливаем опрос после обновления');
          appState.isLoopRunning = false;
          appState.isPolling = true;
          readLoop(serial, parser, view, buffers, appState);
        }
      } else {
        // Неудача (контроллер не отвечает или ошибки связи):
        // показываем компактное окно ошибки независимо от осциллографа
        console.warn('[UI] updateDeviceRegisters вернул false — связь не удалась');
        showCompactError('Контроллер не отвечает. Проверьте адрес.');
      }
    } catch (err) {
      console.error("Ошибка при обновлении:", err);
      // На случай исключительной ситуации тоже показываем окно
      showCompactError('Ошибка при обновлении таблицы. Проверьте связь.');
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

  // ==========================================================================
  // Первая кнопка шапки: список устройств (основная кнопка + выпадающий список)
  // ==========================================================================
  const deviceListActionBtn = document.getElementById('deviceListActionBtn') as HTMLButtonElement | null;
  const deviceListArrowBtn = document.getElementById('deviceListArrowBtn') as HTMLButtonElement | null;
  const deviceListDropdown = document.getElementById('deviceListDropdown') as HTMLElement | null;

  // Текущий режим кнопки (по умолчанию — "Обновить")
  let deviceListMode = 'refresh';

  // Соответствие режимов кнопки — режимам группировки дерева
  const treeModeByButtonMode: Record<string, TreeGroupMode> = {
    refresh: 'location',
    serials: 'serial',
    place: 'location',
    mechType: 'mechType',
    serviceDate: 'serviceDate',
    deviceType: 'deviceType',
  };

  const deviceListMenu: Array<{ id: string; mode: string }> = [
    { id: 'menuDeviceRefresh', mode: 'refresh' },
    { id: 'menuDeviceSerials', mode: 'serials' },
    { id: 'menuDevicePlace', mode: 'place' },
    { id: 'menuDeviceMechType', mode: 'mechType' },
    { id: 'menuDeviceServiceDate', mode: 'serviceDate' },
    { id: 'menuDeviceType', mode: 'deviceType' },
  ];

  // Пометка выбранного пункта маркером "•" (как на скриншоте), без правки CSS
  const markSelectedDeviceItem = (): void => {
    for (const item of deviceListMenu) {
      const el = document.getElementById(item.id);
      if (!el) continue;
      const label = el.dataset.label ?? (el.textContent || '').replace(/^•\s*/, '');
      el.dataset.label = label;
      el.textContent = item.mode === deviceListMode ? '• ' + label : label;
    }
  };

  if (deviceListArrowBtn && deviceListDropdown) {
    // Раскрытие/закрытие списка по клику на треугольничек
    deviceListArrowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = deviceListDropdown.style.display === 'block';
      deviceListDropdown.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) markSelectedDeviceItem();
    });

    // Закрытие по клику вне списка
    document.addEventListener('click', (e) => {
      if (!deviceListDropdown.contains(e.target as Node) && e.target !== deviceListArrowBtn) {
        deviceListDropdown.style.display = 'none';
      }
    });

    // Закрытие по Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') deviceListDropdown.style.display = 'none';
    });

    // Выбор пункта меню: запоминаем режим и сразу перестраиваем дерево
    for (const item of deviceListMenu) {
      const el = document.getElementById(item.id);
      if (el) {
        el.addEventListener('click', () => {
          deviceListMode = item.mode;
          deviceListDropdown.style.display = 'none';
          markSelectedDeviceItem();
          setTreeGroupMode(treeModeByButtonMode[item.mode] ?? 'location');
          renderDeviceTree();
          console.log(`[UI] Выбрана функция кнопки списка устройств: ${item.mode}`);
        });
      }
    }
  }

  // Основная кнопка: выполняет текущую выбранную функцию
  if (deviceListActionBtn) {
    deviceListActionBtn.addEventListener('click', async () => {
      // Следующим этапом здесь появятся функции всех пунктов меню.
      // Пока реализована только функция по умолчанию — "Обновить список устройств".
      if (deviceListMode === 'refresh') {
        const results = await reloadIniFilesFromDisk();
        if (results.updated === 0 && results.removed === 0 && results.errors.length === 0) {
          showCompactError('Изменений в INI-файлах не обнаружено.');
        } else {
          const parts: string[] = [];
          if (results.updated > 0) parts.push(`обновлено: ${results.updated}`);
          if (results.removed > 0) parts.push(`удалено из списка: ${results.removed}`);
          showCompactError(`Список устройств обновлён. ${parts.join(', ')}.`);
        }
        if (results.errors.length > 0) {
          console.warn('[UI] reloadIniFilesFromDisk — ошибки:', results.errors);
        }
      } else {
        // Режимы группировки: основная кнопка перестраивает дерево
        setTreeGroupMode(treeModeByButtonMode[deviceListMode] ?? 'location');
        renderDeviceTree();
      }
    });
  }

  // Автообновление после загрузки/смены INI-файла: тихо, только если порт открыт
  window.addEventListener('app:ini-file-loaded', () => {
    void performRefresh(false);
  });

  // ---------------------------------------------------------------------------
  // Командная строка (кнопка терминала)
  // ---------------------------------------------------------------------------
  initCmdlineUI();

  // ---------------------------------------------------------------------------
  // Отчёты (кнопка 📋)
  // ---------------------------------------------------------------------------
  initReportUI({
    getAppState: () => appState,
    getFileStore: () => getFileStore(),
  });

  // ---------------------------------------------------------------------------
  // Поиск устройств в сети Modbus (кнопка 🔍)
  // ---------------------------------------------------------------------------
  let scanWasPolling = false;

  initModbusScanUI({
    isPortOpen: () => serial.isConnected,
    pausePolling: () => {
      // Запоминаем, шёл ли опрос, и останавливаем его на время поиска
      scanWasPolling = appState.isPolling;
      appState.isPolling = false;
    },
    resumePolling: () => {
      // Возобновляем опрос только если он шёл до поиска
      if (scanWasPolling) {
        appState.isPolling = true;
        void readLoop(serial, parser, window.osc ?? null, buffers, appState);
      }
    },
    connectToDevice: (addr: number) => {
      // Переключаем адрес опроса — readLoop подхватит его на следующем запросе
      appState.slaveAddress = addr;
      console.log(`[UI] Опрос переключён на адрес ${addr}`);
    },
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
  if (menuOpenFolder) menuOpenFolder.addEventListener('click', async () => {
    await openIniFolder(appState);
    folderDropdown?.classList.remove('show');
  });

  // Windows: открытие папки недоступно — физически скрываем стрелочку,
  // разделитель и пункт "Открыть папку". Кнопка становится обычной
  // одиночной "Открыть файл". В Linux всё остаётся как есть.
  if (!isLinux()) {
    if (menuOpenFolder) menuOpenFolder.style.display = 'none';
    if (folderArrowBtn) {
      folderArrowBtn.style.display = 'none';
      const divider = folderArrowBtn.previousElementSibling as HTMLElement | null;
      if (divider && divider.classList.contains('split-btn-divider')) {
        divider.style.display = 'none';
      }
    }
  }
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

  // Кнопка адреса Modbus: окно ввода, новый адрес применяется ко всему обмену
  if (addrBtn) {
    const updateAddrLabel = (): void => {
      addrBtn.textContent = 'Адрес: x' + appState.slaveAddress.toString(16).toUpperCase().padStart(2, '0');
    };
    updateAddrLabel();
    addrBtn.addEventListener('click', async () => {
      const newAddr = await showAddressDialog(appState.slaveAddress);
      if (newAddr !== null && newAddr !== appState.slaveAddress) {
        appState.slaveAddress = newAddr;
        updateAddrLabel();
        console.log(`[UI] Адрес Modbus изменён на ${newAddr} (0x${newAddr.toString(16).toUpperCase().padStart(2, '0')})`);
        
        // Уведомляем осциллограф о смене адреса
        const osc = window.osc;
        if (osc && typeof osc.setSlaveAddress === 'function') {
          osc.setSlaveAddress(newAddr);
          console.log(`[UI] Осциллограф уведомлён о новом адресе: ${newAddr}`);
        }
      }
    });
  }

  initTableEditor('grid-data-rows', appState);
  setupSaveButton(appState);

      // ============================================================================
  // Обработчики событий бизнес-логики (готово к Tauri)
  // В нативном приложении тело этих функций будет заменено на вызовы Tauri API.
  // ============================================================================

    // Событие: Контроллер перестал отвечать (серия таймаутов)
  window.addEventListener('app:controller-not-responding', (e: Event) => {
    const detail = (e as CustomEvent).detail as { consecutiveTimeouts?: number } | undefined;
    const count = detail?.consecutiveTimeouts ?? 0;
    console.log(`[UI] Получено событие "контроллер не отвечает" (подряд ошибок: ${count})`);

    // 1. Показываем компактное окно ВСЕГДА (независимо от осциллографа)
    showCompactError('Контроллер не отвечает. Проверьте адрес.');

    // 2. Если осциллограф открыт — замораживаем его рендер (без своего окна)
    const osc = window.osc;
    if (osc && typeof (osc as any).showFrozenState === 'function') {
      (osc as any).showFrozenState('');
    }
  });

  // Событие: Контроллер снова начал отвечать
  window.addEventListener('app:controller-responding', () => {
    console.log('[UI] Получено событие "контроллер отвечает"');
    const osc = window.osc;
    if (osc && typeof (osc as any).resumeFromFrozen === 'function') {
      (osc as any).resumeFromFrozen();
    }
  });

  // Конец обработчиков событий
  // ============================================================================

  console.log("UI Manager: Интерфейс и обработчики инициализированы.");
}