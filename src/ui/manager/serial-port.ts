// src/ui/manager/serial-port.ts

/**
 * Модуль управления последовательным портом (ID / Off).
 * В браузерной версии:
 * - кнопка ID работает как toggle: подключить через executeDeviceIdentification
 *   или отключить через release();
 * - serial может быть переназначен (WebSocket) — поэтому используем SerialRef.
 */

import type { ISerialPort } from '../../serial/ISerialPort.js';
import type { AppState } from '../../core/app-state.js';
import type { IOscilloscopeApi } from '../../core/osc-api.js';
import type { ModbusParser } from '../../serial/modbus.js';
import type { ChannelBuffer } from '../uiManager.js';
import { updateIdBanner } from '../ui.js';

/** Мутабельный контейнер порта — расшарен между модулями. */
export interface SerialRef {
  current: ISerialPort;
}

export interface SerialPortUIDeps {
  serialRef: SerialRef;
  appState: AppState;
  parser: ModbusParser;
  view: IOscilloscopeApi;
  buffers: ChannelBuffer[];
  comSelect: HTMLSelectElement | null;
  baudSelect: HTMLSelectElement | null;
  idBtn: HTMLButtonElement | null;
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
}

export function initSerialPortUI(deps: SerialPortUIDeps): void {
  const {
    serialRef, appState, parser, view, buffers,
    comSelect, baudSelect, idBtn,
    executeDeviceIdentification, readLoop,
  } = deps;

  // Флаг ручного отключения: подавляет предупреждение при release()
  let isManualDisconnect = false;

  // Восстановление опроса и статуса осциллографа после подключения
  const restoreConnection = (): void => {
    const serial = serialRef.current;
    if (!serial.isConnected) return;
    const osc = window.osc;
    if (osc && typeof osc.setConnectionStatus === 'function') {
      osc.setConnectionStatus(true);
    }
    const oscContainerEl = document.getElementById('osc-container');
    const isOscVisible = oscContainerEl
      && !oscContainerEl.classList.contains('hidden')
      && oscContainerEl.style.display !== 'none';
    if (isOscVisible) {
      console.log('[UI] Перезапускаем readLoop после восстановления связи');
      appState.isLoopRunning = false;
      appState.isPolling = true;
      readLoop(serial, parser, view, buffers, appState);
    }
  };

  // Синхронизирует текст и тултип кнопки ID с состоянием порта.
  const updateIdButtonState = (connected: boolean): void => {
    if (!idBtn) return;
    if (connected) {
      idBtn.textContent = 'Off';
      idBtn.title = 'Отключить com порт';
    } else {
      idBtn.textContent = 'ID';
      idBtn.title = 'Подключить com порт';
    }
  };
  updateIdButtonState(false);

  // onDisconnect навешиваем на исходный serial из deps (сохраняем текущее поведение).
  const initialSerial = serialRef.current;
  if (initialSerial && typeof initialSerial.onDisconnect === 'function') {
    initialSerial.onDisconnect(() => {
      const osc = window.osc;
      if (isManualDisconnect) {
        console.log('[UI] Порт отключён вручную пользователем (без предупреждения).');
        if (osc && typeof osc.setConnectionStatus === 'function') {
          osc.setConnectionStatus(false, '');
        }
      } else {
        console.log('[UI] Обрыв связи обнаружен (физический обрыв USB).');
        if (osc && typeof osc.setConnectionStatus === 'function') {
          osc.setConnectionStatus(false, 'Связь с устройством потеряна.');
        }
      }
      appState.isPolling = false;
      updateIdBanner('');
      updateIdButtonState(false);
    });
  }

  const disconnectPort = async (): Promise<void> => {
    try {
      isManualDisconnect = true;
      serialRef.current.release();
      console.log('[UI] Порт отключён вручную через serial.release().');
    } catch (err) {
      console.error('[UI] Ошибка при отключении порта:', err);
    } finally {
      isManualDisconnect = false;
    }
  };

  if (idBtn) {
    idBtn.addEventListener('click', async () => {
      const serial = serialRef.current;
      if (serial.isConnected) {
        await disconnectPort();
        updateIdButtonState(serial.isConnected);
        return;
      }
      await executeDeviceIdentification(serial, comSelect, appState, baudSelect);
      const osc = window.osc;
      if (osc && typeof osc.setSerialPort === 'function') {
        osc.setSerialPort(serial);
      }
      restoreConnection();
      updateIdButtonState(serial.isConnected);
    });
  }

  console.log('[SerialPortUI] Инициализирован.');
}