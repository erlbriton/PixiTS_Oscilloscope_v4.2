// src/ui/manager/device-management.ts

/**
 * Модуль управления устройствами и INI-файлами.
 * Отвечает за:
 * - Кнопку «Подключиться» (WebSocket-ветка для TCP + поиск родного INI + fwUpdateModal)
 * - Обновление таблицы Modbus (performRefresh)
 * - Кнопку списка устройств (группировка дерева)
 * - Автообновление после загрузки INI
 */

import type { ISerialPort } from '../../serial/ISerialPort.js';
import type { AppState } from '../../core/app-state.js';
import type { IOscilloscopeApi } from '../../core/osc-api.js';
import type { ModbusParser } from '../../serial/modbus.js';
import type { ChannelBuffer } from '../uiManager.js';
import type { SerialRef } from './serial-port.js';

import { showIdModal, showCompactError } from '../ui.js';
import { parseDeviceIdString, parseDeviceIdFull } from '../../core/report-data.js';
import type { FwUpdateInfo } from '../fw-update-modal.js';
import { showFwUpdateModal } from '../fw-update-modal.js';
import { getAllDevices } from '../../ini-manager/tree-core.js';
import { setTreeGroupMode, type TreeGroupMode } from '../../ini-manager/tree-core.js';
import { renderDeviceTree } from '../../ini-manager/tree-ui.js';
import { getFileStore } from '../../ini-manager/file-loader.js';
import { reloadIniFilesFromDisk } from '../../ini-manager/file-loader.js';
import { showNewDeviceModal } from '../new-device-ui.js';
import { PortCancelledError } from '../../serial/serial.js';
import { WebSocketConnection } from '../../serial/ws-transport.js';

export interface DeviceManagementUIDeps {
  serialRef: SerialRef;
  appState: AppState;
  parser: ModbusParser;
  view: IOscilloscopeApi;
  buffers: ChannelBuffer[];
  connectBtn: HTMLButtonElement | null;
  refreshBtn: HTMLButtonElement | null;
  deviceListActionBtn: HTMLButtonElement | null;
  deviceListArrowBtn: HTMLButtonElement | null;
  deviceListDropdown: HTMLElement | null;
  comSelect: HTMLSelectElement | null;
  baudSelect: HTMLSelectElement | null;
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
  updateDeviceRegisters: (
    serial: ISerialPort,
    slaveAddr: number,
    state: AppState,
  ) => Promise<boolean>;
  setSerial?: (newSerial: ISerialPort) => void;
  showIdModal: (text: string) => void;
}

export function initDeviceManagementUI(deps: DeviceManagementUIDeps): void {
  const {
    serialRef, appState, parser, view, buffers,
    connectBtn, refreshBtn,
    deviceListActionBtn, deviceListArrowBtn, deviceListDropdown,
    comSelect, baudSelect,
    executeDeviceIdentification, readLoop, updateDeviceRegisters,
    setSerial, showIdModal,
  } = deps;

  // ── КНОПКА «ПОДКЛЮЧИТЬСЯ» ─────────────────────────────────────────────
  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      const busSelect = document.getElementById('busSelect') as HTMLSelectElement | null;
      const isTcp = busSelect?.value === 'TCP';

      // TCP: сначала создаём/открываем WebSocket
      if (isTcp && !serialRef.current.isConnected) {
        const tcpIpInput = document.getElementById('tcpIpInput') as HTMLInputElement | null;
        const ip = tcpIpInput?.value.trim() || '127.0.0.1';
        console.log('[UI] Создаю WebSocket соединение с IP:', ip);
        serialRef.current = new WebSocketConnection(ip);
        await serialRef.current.connect();
        console.log('[UI] WebSocket создан, isConnected:', serialRef.current.isConnected);
        if (setSerial) setSerial(serialRef.current);
      }

      console.log('[UI] Тип активного порта:', serialRef.current.constructor.name);

      let idText: string;
      if (serialRef.current.isConnected) {
        const banner = document.querySelector('.id-banner span');
        idText = (banner?.textContent ?? '').trim();
      } else {
        try {
          await executeDeviceIdentification(
            serialRef.current,
            isTcp ? null : comSelect,
            appState,
            isTcp ? null : baudSelect,
          );
        } catch (err: unknown) {
          if (err instanceof PortCancelledError) return;
          const msg = err instanceof Error ? err.message : String(err);
          showIdModal('Ошибка: ' + msg);
          return;
        }
        const banner = document.querySelector('.id-banner span');
        idText = (banner?.textContent ?? '').trim();
      }

      if (!idText) {
        console.log('[Connect] Строка ID пустая — поиск пропущен.');
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
        console.log(`[Connect] Найдено устройство с другой версией ПО: ${fwUpdateCandidate}`);
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
          console.log(`[Connect] Родной INI найден и выбран: ${matchedId}`);
        } else {
          console.warn(`[Connect] Родной INI найден (${matchedId}), но узел дерева не отрендерен.`);
        }
      } else {
        console.log('[Connect] Родной INI не найден среди загруженных файлов.');
        showNewDeviceModal(idText);
      }
    });
  }

  // ── ОБНОВЛЕНИЕ ТАБЛИЦЫ (FC03) ─────────────────────────────────────────
  const performRefresh = async (notifyIfDisconnected: boolean): Promise<void> => {
    if (!serialRef.current?.isConnected) {
      if (notifyIfDisconnected) showIdModal('Устройство не подключено!');
      return;
    }
    if (appState.isRefreshing) return;
    appState.isRefreshing = true;
    if (refreshBtn) refreshBtn.disabled = true;

    const wasPolling = appState.isPolling;
    try {
      const success = await updateDeviceRegisters(
        serialRef.current,
        appState.slaveAddress,
        appState,
      );
      if (success) {
        if (wasPolling) {
          console.log('[UI] Восстанавливаем опрос после обновления');
          appState.isLoopRunning = false;
          appState.isPolling = true;
          readLoop(serialRef.current, parser, view, buffers, appState);
        }
      } else {
        console.warn('[UI] updateDeviceRegisters вернул false — связь не удалась');
        showCompactError('Контроллер не отвечает. Проверьте адрес и подключение.');
      }
    } catch (err) {
      console.error('Ошибка при обновлении:', err);
      showCompactError('Ошибка при обновлении таблицы. Проверьте связь.');
    } finally {
      appState.isRefreshing = false;
      if (refreshBtn) refreshBtn.disabled = false;
    }
  };

  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await performRefresh(true);
    });
  }

  // Автообновление после загрузки/смены INI-файла
  window.addEventListener('app:ini-file-loaded', () => {
    void performRefresh(false);
  });

  // ── КНОПКА СПИСКА УСТРОЙСТВ (группировка) ─────────────────────────────
  let deviceListMode = 'refresh';

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
    deviceListArrowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = deviceListDropdown.style.display === 'block';
      deviceListDropdown.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) markSelectedDeviceItem();
    });

    document.addEventListener('click', (e) => {
      if (!deviceListDropdown.contains(e.target as Node) && e.target !== deviceListArrowBtn) {
        deviceListDropdown.style.display = 'none';
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') deviceListDropdown.style.display = 'none';
    });

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

  if (deviceListActionBtn) {
    deviceListActionBtn.addEventListener('click', async () => {
      if (deviceListMode === 'refresh') {
        const results = await reloadIniFilesFromDisk();
        if (results.updated === 0 && results.removed === 0 && results.errors.length === 0) {
          showCompactError('Изменений в INI-файлах не обнаружено.');
        } else {
          const parts: string[] = [];
          if (results.updated > 0) parts.push(`Изменений в файлах: ${results.updated}`);
          if (results.removed > 0) parts.push(`удалено из списка: ${results.removed}`);
          showCompactError(`Содержимое  ini файлов обновлено. ${parts.join(', ')}.`);
        }
        if (results.errors.length > 0) {
          console.warn('[UI] reloadIniFilesFromDisk — ошибки:', results.errors);
        }
      } else {
        setTreeGroupMode(treeModeByButtonMode[deviceListMode] ?? 'location');
        renderDeviceTree();
      }
    });
  }

  console.log('[DeviceManagementUI] Инициализирован.');
}