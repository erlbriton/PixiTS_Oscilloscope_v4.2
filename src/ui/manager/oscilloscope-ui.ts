// src/ui/manager/oscilloscope-ui.ts

/**
 * Модуль управления интерфейсом осциллографа.
 * Отвечает за переключение видимости и ресайзер.
 */

import type { ISerialPort } from '../../serial/ISerialPort.js';
import type { AppState } from '../../core/app-state.js';
import type { IOscilloscopeApi } from '../../core/osc-api.js';
import type { ModbusParser } from '../../serial/modbus.js';
import type { ChannelBuffer } from '../uiManager.js';
import type { SerialRef } from './serial-port.js';

export interface OscilloscopeUIDeps {
  serialRef: SerialRef;
  appState: AppState;
  parser: ModbusParser;
  view: IOscilloscopeApi;
  buffers: ChannelBuffer[];
  readLoop: (
    serial: ISerialPort,
    parser: unknown,
    view: IOscilloscopeApi | null,
    buffers: ChannelBuffer[] | null,
    state: AppState,
  ) => void;
  toggleOscMainBtn: HTMLButtonElement | null;
  toggleOscArrowBtn: HTMLButtonElement | null;
  toggleOscDropdown: HTMLElement | null;
  menuToggleOsc: HTMLElement | null;
  menuViewRec: HTMLElement | null;
  oscResizer: HTMLElement | null;
  oscContainer: HTMLElement | null;
}

export function initOscilloscopeUI(deps: OscilloscopeUIDeps): void {
  const {
    serialRef, appState, parser, view, buffers, readLoop,
    toggleOscMainBtn, toggleOscArrowBtn, toggleOscDropdown,
    menuToggleOsc, menuViewRec,
    oscResizer, oscContainer,
  } = deps;

  // Видимость ресайзера в зависимости от состояния контейнера
  const updateResizerVisibility = (): void => {
    if (!oscContainer || !oscResizer) return;
    if (oscContainer.classList.contains('hidden') || oscContainer.style.display === 'none') {
      oscResizer.classList.add('hidden');
    } else {
      oscResizer.classList.remove('hidden');
    }
  };

  const toggleOscilloscope = async (): Promise<void> => {
    if (!oscContainer) return;
    const isHidden = oscContainer.classList.contains('hidden')
      || oscContainer.style.display === 'none';

    if (isHidden) {
      oscContainer.classList.remove('hidden');
      oscContainer.style.display = 'block';
      appState.isPolling = true;

      const osc = window.osc;
      if (osc) {
        try {
          await osc.initialize(oscContainer);

          if (appState.currentIniContent) {
            await osc.loadIniContent(appState.currentIniContent);
          }

          if (typeof osc.setConnectionStatus === 'function') {
            osc.setConnectionStatus(
              serialRef.current.isConnected,
              serialRef.current.isConnected ? undefined : 'Нет связи с устройством.',
            );
          }

          readLoop(serialRef.current, parser, osc, buffers, appState);
        } catch (err) {
          console.error('[OscilloscopeUI] Ошибка инициализации осциллографа:', err);
        }
      }
    } else {
      oscContainer.classList.add('hidden');
      oscContainer.style.display = 'none';
      appState.isPolling = false;
    }

    updateResizerVisibility();
  };

  if (toggleOscMainBtn) {
    toggleOscMainBtn.addEventListener('click', async () => { await toggleOscilloscope(); });
  }

  if (toggleOscArrowBtn) {
    toggleOscArrowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleOscDropdown?.classList.toggle('show');
    });
  }

  if (menuToggleOsc) {
    menuToggleOsc.addEventListener('click', async () => {
      await toggleOscilloscope();
      toggleOscDropdown?.classList.remove('show');
    });
  }

  // Пункт меню «Просмотр осциллограммы» — открывает новую вкладку браузера
  if (menuViewRec) {
    menuViewRec.addEventListener('click', () => {
      toggleOscDropdown?.classList.remove('show');
      window.open(import.meta.env.BASE_URL + 'rec-viewer.html', '_blank');
    });
  }

  // ── Ресайзер ──────────────────────────────────────────────────────────
  if (oscResizer && oscContainer) {
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    oscResizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = oscContainer.offsetWidth;
      oscResizer.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    // Ширина не меняется в реальном времени — применяется на mouseup
    document.addEventListener('mousemove', () => { /* no-op */ });

    document.addEventListener('mouseup', (e) => {
      if (!isResizing) return;
      isResizing = false;
      oscResizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const deltaX = e.clientX - startX;
      const newWidth = Math.max(200, startWidth + deltaX);
      oscContainer.style.width = `${newWidth}px`;

      const oscInstance = window.osc;
      if (oscInstance && typeof oscInstance.syncCanvasLayout === 'function') {
        requestAnimationFrame(() => { oscInstance.syncCanvasLayout(); });
      }
    });

    updateResizerVisibility();

    const observer = new MutationObserver(updateResizerVisibility);
    observer.observe(oscContainer, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  console.log('[OscilloscopeUI] Инициализирован.');
}