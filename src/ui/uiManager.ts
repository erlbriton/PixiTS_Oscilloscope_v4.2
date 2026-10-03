// src/ui/uiManager.ts

import { initTableEditor } from '../ini-manager/table-editor.js';
import { setupSaveButton } from '../ini-manager/save-ini.js';
import { openIniFile, openIniFolder } from '../ini-manager/file-loader.js';
import type { ISerialPort } from '../serial/ISerialPort.js';
import type { AppState } from '../core/app-state.js';
import type { IOscilloscopeApi } from '../core/osc-api.js';
import type { ModbusParser } from '../serial/modbus.js';
import { IniParser as CoreIniParser, IniConfig } from '../core/ini/index.js';
import { showCompactError } from './ui.js';
import { initModbusScanUI } from './modbus-scan-ui.js';
import { initReportUI } from './report-ui.js';
import { initCmdlineUI } from './cmdline-ui.js';
import { getFileStore, processSingleFileContent } from '../ini-manager/file-loader.js';
import { parseDeviceIdString, parseDeviceIdFull } from '../core/report-data.js';
import { showFwUpdateModal, FwUpdateInfo } from './fw-update-modal.js';
import { getAllDevices } from '../ini-manager/tree-core.js';
import { showNewDeviceModal } from './new-device-ui.js';
import { isLinux } from '../core/platform.js';
import { showConfirmDialog } from './confirm-dialog.js';
import { forcePickParentFolder } from '../ini-manager/db-folder.js';

import { initSerialPortUI, type SerialRef } from './manager/serial-port.js';
import { initDeviceManagementUI } from './manager/device-management.js';
import { initOscilloscopeUI } from './manager/oscilloscope-ui.js';
import { initSearchNavigationUI } from './manager/search-navigation.js';
import { initCommunicationSettingsUI } from './manager/communication-settings.js';

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
  appState: AppState;
  parser: ModbusParser;
  view: IOscilloscopeApi;
  buffers: ChannelBuffer[];
  setupFileHandling: (picker: HTMLInputElement, state: AppState) => void;
  setupFolderHandling?: (picker: HTMLInputElement) => void;
  updateComInterfaceName: (serial: ISerialPort, select: HTMLSelectElement | null) => string;
  executeDeviceIdentification: (
    serial: ISerialPort,
    select: HTMLSelectElement | null,
    state: AppState,
    baudSelect?: HTMLSelectElement | null,
  ) => Promise<void>;
  readLoop: (
    serial: ISerialPort,
    parser: unknown,
    view: IOscilloscopeApi | null,
    buffers: ChannelBuffer[] | null,
    state: AppState,
  ) => void;
  showIdModal: (text: string) => void;
  updateDeviceRegisters: (
    serial: ISerialPort,
    slaveAddr: number,
    state: AppState,
  ) => Promise<boolean>;
  setSerial?: (newSerial: ISerialPort) => void;
}

export function initUI(deps: UiManagerDeps): void {
  // Стартовый диалог: доступ к родительской папке (Devices и BackUp)
  void (async () => {
    console.log('[startup] спрашиваю родительскую папку');
    const ok = await showConfirmDialog('Выберите папку с *.ini файлами');
    if (ok) await forcePickParentFolder();
  })();

  const {
    appState, parser, view, buffers,
    setupFolderHandling,
    executeDeviceIdentification, readLoop, showIdModal, updateDeviceRegisters,
    setSerial,
  } = deps;

  // Мутабельный контейнер порта: WebSocket-ветка перезапишет .current
  const serialRef: SerialRef = { current: deps.serial };

  // DOM-ссылки, нужные для передачи в модули
  const idBtn = document.getElementById('idBtn') as HTMLButtonElement | null;
  const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement | null;
  const comSelect = document.getElementById('comSelect') as HTMLSelectElement | null;
  const baudSelect = document.getElementById('baudSelect') as HTMLSelectElement | null;
  const addrBtn = document.getElementById('addrBtn') as HTMLButtonElement | null;
  const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement | null;
  const folderPicker = document.getElementById('folderPicker') as HTMLInputElement | null;
  const folderActionBtn = document.getElementById('folderActionBtn') as HTMLButtonElement | null;
  const folderArrowBtn = document.getElementById('folderArrowBtn') as HTMLButtonElement | null;
  const folderDropdown = document.getElementById('folderDropdown') as HTMLElement | null;
  const menuOpenFile = document.getElementById('menuOpenFile') as HTMLElement | null;
  const menuOpenFolder = document.getElementById('menuOpenFolder') as HTMLElement | null;
  const toggleOscDropdown = document.getElementById('toggleOscDropdown') as HTMLElement | null;
  const deviceListActionBtn = document.getElementById('deviceListActionBtn') as HTMLButtonElement | null;
  const deviceListArrowBtn = document.getElementById('deviceListArrowBtn') as HTMLButtonElement | null;
  const deviceListDropdown = document.getElementById('deviceListDropdown') as HTMLElement | null;
  const toggleOscMainBtn = document.getElementById('toggleOscMainBtn') as HTMLButtonElement | null;
  const toggleOscArrowBtn = document.getElementById('toggleOscArrowBtn') as HTMLButtonElement | null;
  const menuToggleOsc = document.getElementById('menuToggleOsc') as HTMLElement | null;
  const menuViewRec = document.getElementById('menuViewRec') as HTMLElement | null;
  const oscResizerEl = document.getElementById('oscResizer') as HTMLElement | null;
  const oscContainerEl = document.getElementById('osc-container') as HTMLElement | null;
  const busSelectEl = document.getElementById('busSelect') as HTMLSelectElement | null;
  const rtuControlsEl = document.getElementById('rtuControls') as HTMLElement | null;
  const tcpControlsEl = document.getElementById('tcpControls') as HTMLElement | null;

  // Дерево-поиск
  const treeSearchOverlayEl = document.getElementById('treeSearchOverlay') as HTMLElement | null;
  const treeSearchInputEl = document.getElementById('treeSearchInput') as HTMLInputElement | null;
  const treeSearchStatusEl = document.getElementById('treeSearchStatus') as HTMLElement | null;
  const treeSearchCloseBtnEl = document.getElementById('treeSearchCloseBtn') as HTMLElement | null;
  const treeSearchCancelBtnEl = document.getElementById('treeSearchCancelBtn') as HTMLElement | null;
  const treeSearchFindBtnEl = document.getElementById('treeSearchFindBtn') as HTMLElement | null;
  const treeSearchSplitEl = document.getElementById('treeSearchSplit') as HTMLElement | null;
  const treeSearchMainBtnEl = document.getElementById('treeSearchMainBtn') as HTMLElement | null;
  const treeSearchDropdownBtnEl = document.getElementById('treeSearchDropdownBtn') as HTMLElement | null;
  const treeSearchMenuEl = document.getElementById('treeSearchMenu') as HTMLElement | null;
  const todayBtnEl = document.getElementById('todayBtn') as HTMLElement | null;

  // Пробрасываем в модули обработку папки-приёмника
  if (folderPicker && typeof setupFolderHandling === 'function') {
    setupFolderHandling(folderPicker);
  }

  // Обёртка loadIniContent — синхронизирует currentIniConfig в appState
  if (view && typeof view.loadIniContent === 'function'
      && !(view as unknown as Record<string, unknown>).__loadIniContentWrapped) {
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

  // ── Модули ────────────────────────────────────────────────────────────
  initSerialPortUI({
    serialRef,
    appState,
    parser,
    view,
    buffers,
    comSelect,
    baudSelect,
    idBtn,
    executeDeviceIdentification,
    readLoop,
  });

  initDeviceManagementUI({
    serialRef,
    appState,
    parser,
    view,
    buffers,
    connectBtn,
    refreshBtn,
    deviceListActionBtn,
    deviceListArrowBtn,
    deviceListDropdown,
    comSelect,
    baudSelect,
    executeDeviceIdentification,
    readLoop,
    updateDeviceRegisters,
    setSerial,
    showIdModal,
  });

  initSearchNavigationUI({
    appState,
    treeSearchOverlay: treeSearchOverlayEl,
    treeSearchInput: treeSearchInputEl,
    treeSearchStatus: treeSearchStatusEl,
    treeSearchCloseBtn: treeSearchCloseBtnEl,
    treeSearchCancelBtn: treeSearchCancelBtnEl,
    treeSearchFindBtn: treeSearchFindBtnEl,
    treeSearchSplit: treeSearchSplitEl,
    treeSearchMainBtn: treeSearchMainBtnEl,
    treeSearchDropdownBtn: treeSearchDropdownBtnEl,
    treeSearchMenu: treeSearchMenuEl,
    todayBtn: todayBtnEl,
  });

  // Командная строка (остаётся здесь — одна строка)
  initCmdlineUI();

  // ── Отчёты ────────────────────────────────────────────────────────────
  initReportUI({
    getAppState: () => appState,
    getFileStore: () => getFileStore(),
    getOscilloscope: () => (window as { osc?: unknown }).osc as {
      settings: { amplitudeMarkerTime: number | null };
      archive: {
        getRawAtTime: (id: string, t: number) => number | null;
        getValueAtTime: (id: string, t: number) => number | null;
      };
      allChannels: Array<{ id: string; modbusReg?: string }>;
    } | null,
  });

  // ── Поиск устройств в сети Modbus ─────────────────────────────────────
  let scanWasPolling = false;
  initModbusScanUI({
    isPortOpen: () => serialRef.current.isConnected,
    pausePolling: () => {
      scanWasPolling = appState.isPolling;
      appState.isPolling = false;
    },
    resumePolling: () => {
      if (scanWasPolling) {
        appState.isPolling = true;
        void readLoop(serialRef.current, parser, window.osc ?? null, buffers, appState);
      }
    },
    connectToDevice: (addr: number, idText: string) => {
      appState.slaveAddress = addr;
      console.log(`[UI][Scan] Опрос переключён на адрес ${addr}`);

      if (!idText) {
        console.log('[UI][Scan] ID не получен — открываем "Новое устройство".');
        showNewDeviceModal('');
        return;
      }

      const target = parseDeviceIdString(idText);
      let matchedId: string | null = null;
      let fwUpdateCandidate: string | null = null;
      for (const device of getAllDevices()) {
        const candidate = device.iniConfig?.device?.id;
        if (!candidate) continue;
        const parsed = parseDeviceIdString(candidate);
        if (parsed.serial === target.serial
            && parsed.deviceType === target.deviceType
            && parsed.version === target.version) {
          matchedId = device.id;
          break;
        }
        if (parsed.serial === target.serial
            && parsed.deviceType === target.deviceType
            && parsed.version !== target.version) {
          fwUpdateCandidate = device.id;
        }
      }

      if (!matchedId && fwUpdateCandidate) {
        const fullInfo: FwUpdateInfo = parseDeviceIdFull(idText);
        const oldDevice = getAllDevices().find((d) => d.id === fwUpdateCandidate);
        if (oldDevice) {
          const oldDev = oldDevice.iniConfig.device;
          const oldDevId = oldDev ? oldDev.id : '';
          const oldLoc = oldDev?.location ?? '';
          const store = getFileStore();
          const entry = store.get(`${oldLoc}::${oldDevId}`);
          if (entry?.file) fullInfo.oldFileName = entry.file.name;
        }
        console.log(`[UI][Scan] Найдено устройство с другой версией ПО: ${fwUpdateCandidate}`);
        showFwUpdateModal(fullInfo);
        return;
      }

      if (matchedId !== null) {
        const leaf = document.querySelector<HTMLLIElement>(
          `.tree-id-item.is-leaf[data-device-id="${CSS.escape(matchedId)}"]`,
        );
        if (leaf) {
          const details = leaf.closest('details.tree-location');
          if (details) (details as HTMLDetailsElement).open = true;
          leaf.click();
          console.log(`[UI][Scan] Родной INI найден и выбран: ${matchedId}`);
        } else {
          console.warn(`[UI][Scan] Родной INI найден (${matchedId}), но узел дерева не отрендерен.`);
        }
      } else {
        console.log('[UI][Scan] Родной INI не найден — открываем "Новое устройство".');
        showNewDeviceModal(idText);
      }
    },
  });

  // ── Осциллограф ───────────────────────────────────────────────────────
  initOscilloscopeUI({
    serialRef,
    appState,
    parser,
    view,
    buffers,
    readLoop,
    toggleOscMainBtn,
    toggleOscArrowBtn,
    toggleOscDropdown,
    menuToggleOsc,
    menuViewRec,
    oscResizer: oscResizerEl,
    oscContainer: oscContainerEl,
  });

  // ── Кнопка папки и меню «Открыть файл/папку» ──────────────────────────
  if (folderActionBtn) {
    folderActionBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await openIniFile(appState);
    });
  }
  if (menuOpenFile) {
    menuOpenFile.addEventListener('click', async () => {
      await openIniFile(appState);
      folderDropdown?.classList.remove('show');
    });
  }
  if (menuOpenFolder) {
    menuOpenFolder.addEventListener('click', async () => {
      await openIniFolder(appState);
      folderDropdown?.classList.remove('show');
    });
  }

  // Windows: открытие папки недоступно — прячем стрелочку и пункт меню.
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

  if (folderArrowBtn) {
    folderArrowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      folderDropdown?.classList.toggle('show');
    });
  }

  // Закрытие обоих выпадающих меню по клику вне (сохраняем поведение браузерной версии)
  document.addEventListener('click', () => {
    folderDropdown?.classList.remove('show');
    toggleOscDropdown?.classList.remove('show');
  });

  // ── Настройки связи и глобальные события ──────────────────────────────
  initCommunicationSettingsUI({
    serialRef,
    appState,
    parser,
    view,
    buffers,
    baudSelect,
    busSelect: busSelectEl,
    rtuControls: rtuControlsEl,
    tcpControls: tcpControlsEl,
    addrBtn,
    readLoop,
  });

  // ── Таблица и сохранение ──────────────────────────────────────────────
  initTableEditor('grid-data-rows', appState);
  setupSaveButton(appState);

  console.log('UI Manager: Интерфейс и обработчики инициализированы.');
}