// src/ui/manager/communication-settings.ts

/**
 * Модуль настроек связи и глобальных событий (браузерная версия).
 * Отвечает за:
 * - Baud Rate (выбор и запоминание скорости порта)
 * - Переключение видимости RTU / TCP контролов
 * - Управление TCP-соединением через выделенную кнопку (tcpConnectBtn) и WebSocketConnection
 * - Индикацию статуса соединения ('0' - отключено, '1' - подключено, 'E' - ошибка)
 * - Изменение сетевого адреса Modbus
 * - Глобальные события приложения (app:*) и защиту от закрытия вкладки при несохраненных данных
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
import { resetConnectionErrorFlag } from '../../ui/ui.js';
import { WebSocketConnection } from '../../serial/ws-transport.js';

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
  tcpConnectBtn: HTMLButtonElement | null;
  tcpIpInput: HTMLInputElement | null;
  addrBtn: HTMLButtonElement | null;
  setSerial?: (port: ISerialPort) => void;
  readLoop: (
    serial: ISerialPort,
    parser: unknown,
    view: IOscilloscopeApi | null,
    buffers: ChannelBuffer[] | null,
    state: AppState,
  ) => void;
}

export function initCommunicationSettingsUI(deps: CommunicationSettingsUIDeps): void {
  // Корректно достаем все элементы управления из deps, включая tcpConnectBtn и tcpIpInput
  const {
    serialRef, appState, parser, view, buffers,
    baudSelect, busSelect, rtuControls, tcpControls,
    tcpConnectBtn, tcpIpInput, addrBtn,
    setSerial, readLoop,
  } = deps;

  console.log('DEBUG tcpConnectBtn element:', tcpConnectBtn);

  // ── Baud Rate ─────────────────────────────────────────────────────────
  if (baudSelect) {
    baudSelect.addEventListener('change', () => {
      const newBaudRate = parseInt(baudSelect.value, 10) || 115200;
      if (serialRef.current.isConnected) {
        console.log(`[UI] Скорость изменена на ${newBaudRate}. Для применения необходимо переподключиться.`);
      } else {
        console.log(`[UI] Скорость установлена на ${newBaudRate} (будет использована при подключении).`);
      }
    });
  }

  // ── Переключение BUS: MODBUS RTU <-> MODBUS TCP/IP ────────────────────
  const applyBusMode = (): void => {
    const isTcp = busSelect?.value === 'TCP';
    
    console.log('[DEBUG] busSelect.value =', busSelect?.value);
    console.log('[DEBUG] tcpControls element =', tcpControls);
    console.log('[DEBUG] tcpConnectBtn element =', tcpConnectBtn);

    if (rtuControls) rtuControls.style.display = isTcp ? 'none' : '';
    if (tcpControls) tcpControls.style.display = isTcp ? '' : 'none';

    if (isTcp && tcpConnectBtn) {
      const isConnected = serialRef.current?.isConnected ?? false;
      tcpConnectBtn.textContent = isConnected ? '1' : '0';
    }

    console.log(`[UI] Режим связи: ${isTcp ? 'MODBUS TCP/IP' : 'MODBUS RTU'}`);
  };

  if (busSelect) {
    busSelect.addEventListener('change', () => {
      applyBusMode();
    });
    applyBusMode();
  }

  // ── Кнопка подключения/отключения TCP (tcpConnectBtn) ────────────────
  tcpConnectBtn?.addEventListener('click', async () => {
    if (busSelect?.value !== 'TCP') return;

    let port = serialRef.current;
    if (!port) return;

    if (port.isConnected) {
      try {
        appState.isPolling = false;
        port.release();
      } catch (err) {
        console.error('[UI] Ошибка отключения TCP:', err);
      }
      tcpConnectBtn.textContent = '0';
      console.log('[UI] TCP-соединение закрыто пользователем');

      const osc = window.osc;
      if (osc && typeof (osc as unknown as { showFrozenState?: (s: string) => void }).showFrozenState === 'function') {
        (osc as unknown as { showFrozenState: (s: string) => void }).showFrozenState('');
      }
      return;
    }

    const ip = tcpIpInput?.value.trim() || '127.0.0.1';

    if (!(port instanceof WebSocketConnection)) {
      port = new WebSocketConnection(ip);
      serialRef.current = port;
      if (typeof setSerial === 'function') {
        setSerial(port);
      }
    } else {
      port = new WebSocketConnection(ip);
      serialRef.current = port;
      if (typeof setSerial === 'function') {
        setSerial(port);
      }
    }

    tcpConnectBtn.disabled = true;

    try {
      console.log('[UI] Подключение к TCP IP:', ip);
      await port.connect();
      
      tcpConnectBtn.textContent = '1';
      console.log('[UI] TCP-соединение успешно установлено');

      const osc = window.osc;
      if (osc && typeof (osc as unknown as { resumeFromFrozen?: () => void }).resumeFromFrozen === 'function') {
        (osc as unknown as { resumeFromFrozen: () => void }).resumeFromFrozen();
      }

      const oscContainerEl = document.getElementById('osc-container');
      const isOscVisible = oscContainerEl &&
        !oscContainerEl.classList.contains('hidden') &&
        oscContainerEl.style.display !== 'none';
      if (isOscVisible) {
        appState.isLoopRunning = false;
        appState.isPolling = true;
        void readLoop(port, parser, view, buffers, appState);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[UI] Ошибка подключения TCP:', msg);
      tcpConnectBtn.textContent = 'E';
    } finally {
      tcpConnectBtn.disabled = false;
    }
  });

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
    resetConnectionErrorFlag();

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

    const serialPort = serialRef.current;
    if (serialPort) {
      try {
        serialPort.release();
      } catch (err) {
        console.error('[beforeunload] Ошибка закрытия порта:', err);
      }
    }
  });

  console.log('[CommunicationSettingsUI] Инициализирован.');
}