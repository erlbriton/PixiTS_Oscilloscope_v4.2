// src/ui/manager/communication-settings.ts

/**
 * Модуль настроек связи и глобальных событий (браузерная версия).
 * Отвечает за:
 * - Baud Rate (запоминание для следующего подключения)
 * - Переключение видимости RTU/TCP-контролов
 * - Адрес Modbus
 * - app:* события и beforeunload
 *
 * Отличие от Tauri: busSelect только показывает/скрывает UI, а физическое
 * TCP-соединение создаётся в connectBtn (device-management.ts) через
 * WebSocketConnection.
 */

import type { ISerialPort } from '../../serial/ISerialPort.js';
import type { AppState } from '../../core/app-state.js';
import type { IOscilloscopeApi } from '../../core/osc-api.js';
import type { ModbusParser } from '../../serial/modbus.js';
import type { ChannelBuffer } from '../uiManager.js';
import type { SerialRef } from './serial-port.js';

import { showCompactError } from '../ui.js';
import { showAddressDialog } from '../confirm-dialog.js';
import { hasAnyDirty } from '../../ini-manager/dirty-tracker.js';

export interface CommunicationSettingsUIDeps {
  serialRef: SerialRef;
  appState: AppState;
  parser: ModbusParser;
  view: IOscilloscopeApi;
  buffers: ChannelBuffer[];
  baudSelect: HTMLSelectElement | null;
  busSelect: HTMLSelectElement | null;
  rtuControls: HTMLElement | null;
  tcpControls: HTMLElement | null;
  addrBtn: HTMLButtonElement | null;
  readLoop: (
    serial: ISerialPort,
    parser: unknown,
    view: IOscilloscopeApi | null,
    buffers: ChannelBuffer[] | null,
    state: AppState,
  ) => void;
}

export function initCommunicationSettingsUI(deps: CommunicationSettingsUIDeps): void {
  const {
    serialRef, appState, parser, view, buffers,
    baudSelect, busSelect, rtuControls, tcpControls, addrBtn,
    readLoop,
  } = deps;

  // ── Baud Rate ─────────────────────────────────────────────────────────
  if (baudSelect) {
    baudSelect.addEventListener('change', () => {
      const newBaudRate = parseInt(baudSelect.value, 10) || 115200;
      if (serialRef.current.isConnected) {
        console.log(`[UI] Скорость изменена на ${newBaudRate}. Для применения необходимо переподключиться (кнопка "Подключить").`);
      } else {
        console.log(`[UI] Скорость установлена на ${newBaudRate} (будет использована при подключении).`);
      }
    });
  }

  // ── Переключение BUS: MODBUS RTU <-> MODBUS TCP/IP ────────────────────
  const applyBusMode = (): void => {
    const isTcp = busSelect?.value === 'TCP';
    if (rtuControls) rtuControls.style.display = isTcp ? 'none' : '';
    if (tcpControls) tcpControls.style.display = isTcp ? '' : 'none';
    console.log(`[UI] Режим связи: ${isTcp ? 'MODBUS TCP/IP' : 'MODBUS RTU'}`);
  };

  if (busSelect) {
    busSelect.addEventListener('change', applyBusMode);
    applyBusMode();
  }

  // ── Кнопка адреса Modbus ──────────────────────────────────────────────
  if (addrBtn) {
    const updateAddrLabel = (): void => {
      addrBtn.textContent = 'Адрес: x'
        + appState.slaveAddress.toString(16).toUpperCase().padStart(2, '0');
    };
    updateAddrLabel();

    addrBtn.addEventListener('click', async () => {
      const newAddr = await showAddressDialog(appState.slaveAddress);
      if (newAddr !== null && newAddr !== appState.slaveAddress) {
        appState.slaveAddress = newAddr;
        updateAddrLabel();
        console.log(`[UI] Адрес Modbus изменён на ${newAddr} (0x${newAddr.toString(16).toUpperCase().padStart(2, '0')})`);

        const osc = window.osc;
        if (osc && typeof osc.setSlaveAddress === 'function') {
          osc.setSlaveAddress(newAddr);
          console.log(`[UI] Осциллограф уведомлён о новом адресе: ${newAddr}`);
        }
      }
    });
  }

  // ── Глобальные события ────────────────────────────────────────────────

  window.addEventListener('app:controller-not-responding', (e: Event) => {
    const detail = (e as CustomEvent).detail as { consecutiveTimeouts?: number } | undefined;
    const count = detail?.consecutiveTimeouts ?? 0;
    console.log(`[UI] Получено событие "контроллер не отвечает" (подряд ошибок: ${count})`);

    showCompactError('Контроллер не отвечает. Проверьте адрес и подключение.');

    const osc = window.osc;
    if (osc && typeof (osc as unknown as { showFrozenState?: (s: string) => void }).showFrozenState === 'function') {
      (osc as unknown as { showFrozenState: (s: string) => void }).showFrozenState('');
    }
  });

  window.addEventListener('app:controller-responding', () => {
    console.log('[UI] Получено событие "контроллер отвечает"');
    const osc = window.osc;
    if (osc && typeof (osc as unknown as { resumeFromFrozen?: () => void }).resumeFromFrozen === 'function') {
      (osc as unknown as { resumeFromFrozen: () => void }).resumeFromFrozen();
    }
  });

  window.addEventListener('app:request-polling-restart', () => {
    const port = serialRef.current;
    if (port && port.isConnected && appState.isPolling && !appState.isLoopRunning) {
      console.log('[UI] Перезапуск readLoop по запросу после записи...');
      appState.isLoopRunning = false;
      void readLoop(port, parser, view, buffers, appState);
    }
  });

  window.addEventListener('beforeunload', (e: BeforeUnloadEvent) => {
    if (hasAnyDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  console.log('[CommunicationSettingsUI] Инициализирован.');
}