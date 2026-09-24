// src/main.ts

import { SerialConnection } from './serial/serial.js';
import { WebSocketConnection } from './serial/ws-transport.js';
import type { ISerialPort } from './serial/ISerialPort.js';
import { initUI } from './ui/uiManager.js';
import { ModbusParser } from './serial/modbus.js';
import { Oscilloscope } from './oscilloscope';
import './ui/layout.js';

import { showIdModal } from './ui/ui.js';
import { initFwUpdateModal } from './ui/fw-update-modal.js';
import { updateDeviceRegisters } from './serial/device_updater.js';
import { setupFileHandling, openIniFile } from './ini-manager/file-loader.js';
import { initDropZone } from './ini-manager/drop-loader.js';
import {
    updateComInterfaceName,
    executeDeviceIdentification,
    readLoop
} from './serial/serial-actions.js';
import type { AppState } from './core/app-state.js';

declare global {
    interface Window {
        osc?: Oscilloscope;
    }
}

const appState: AppState = {
  isIdentifying: false,
  isPolling: false,
  isRefreshing: false,
  isLoopRunning: false,
  slaveAddress: 0x01,
  currentIniContent: null,
  currentIniConfig: null,
  currentIniFileHandle: null,
  pollDelayMs: 20,
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const oscContainer = document.getElementById('osc-container');

                        const osc = new Oscilloscope();
        osc.setAppState(appState);
        window.osc = osc;
        await osc.initialize(oscContainer ?? undefined);

        let serial: ISerialPort = new SerialConnection();
        const parser = new ModbusParser();

        // Связываем кнопку Стоп/Пуск осциллографа с глобальным состоянием опроса
        osc.setOnPollingStateChange((isPolling: boolean) => {
            appState.isPolling = isPolling;
            console.log("[Main] appState.isPolling изменён на:", isPolling);
            
            if (isPolling) {
                // Перезапускаем цикл опроса, так как при остановке он полностью завершился
                readLoop(serial, parser, osc, buffers, appState).catch(err => 
                    console.error("Ошибка перезапуска readLoop:", err)
                );
            }
        });

        const buffers: import('./ui/uiManager.js').ChannelBuffer[] = Array.from({ length: 70 }, () => {
         const data: number[] = [];
         return {
                push: (v: number) => {
                    data.push(v);
                    if (data.length > 200) data.shift();
                },
                get: (idx: number) => data[idx],
                get length() { return data.length; },
                get data() { return data; },
                clear: () => { data.length = 0; },
                toArray: () => [...data]
            };
        });

                       // Слушаем событие успешного переподключения WebSocket и перезапускаем readLoop
        window.addEventListener('ws:reconnected', () => {
            console.log('[Main] WebSocket переподключён. Перезапуск readLoop и осциллографа...');
            appState.isLoopRunning = false; // Сбрасываем флаг
            appState.isPolling = true; // Убеждаемся, что опрос включён
            
            // Размораживаем осциллограф (после controller-not-responding)
            if (osc && typeof osc.resumeFromFrozen === 'function') {
                osc.resumeFromFrozen();
                console.log('[Main] Осциллограф разморожен.');
            }
            
            // Возобновляем цикл отрисовки осциллографа
            if (osc && typeof osc.setConnectionStatus === 'function') {
                osc.setConnectionStatus(true);
                console.log('[Main] Цикл отрисовки осциллографа возобновлён.');
            }
            
            readLoop(serial, parser, osc, buffers, appState).catch(err =>
                console.error("Ошибка перезапуска readLoop после переподключения:", err)
            );
        });

        initUI({
    serial, appState, parser, view: osc, buffers,
    setupFileHandling,
    updateComInterfaceName,
    executeDeviceIdentification,
    readLoop,
    showIdModal,
    updateDeviceRegisters,
    setSerial: (newSerial: ISerialPort) => { serial = newSerial; }
});

        // Инициализация drag-and-drop для INI-файлов
        initDropZone(appState);

        initFwUpdateModal();

        console.log("Приложение запущено. Модуль осциллографа интегрирован.");
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Критическая ошибка:", message);
    }
});