import { IniParser } from './iniParser.js';
import { SerialConnection } from './serial/serial.js';
import { initUI } from './ui/uiManager.js';
import { ModbusParser } from './serial/modbus.js';
import { Oscilloscope } from '../index';
import './ui/layout.js';

// Импорты логики
import { showIdModal } from './ui.js';
import { updateDeviceRegisters } from './serial/device_updater.js';
import { setupFileHandling } from './file-loader.js';
import { 
    updateComInterfaceName, 
    executeDeviceIdentification, 
    readLoop 
} from './serial-actions.js';

declare global {
    interface Window {
        osc?: Oscilloscope;
    }
}

// Удаляем локальные заглушки, используем реальный модуль
const iniParser = new IniParser();
const appState = { isIdentifying: false, isPolling: false, isRefreshing: false, slaveAddress: 0x01, parser: iniParser };

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const oscContainer = document.getElementById('osc-container');
        
        // Инициализируем реальный осциллограф
        const osc = new Oscilloscope();
        (window as any).osc = osc;
        await osc.initialize(oscContainer!);

        const serial = new SerialConnection();
        const parser = new ModbusParser();
        
        // Реальные буферы данных для передачи в осциллограф
        const buffers = Array.from({ length: 70 }, () => {
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

        initUI({
            serial, appState, parser, view: osc, buffers,
            setupFileHandling, 
            updateComInterfaceName, 
            executeDeviceIdentification, 
            readLoop, 
            showIdModal, 
            updateDeviceRegisters
        });

        console.log("Приложение запущено. Модуль осциллографа интегрирован.");
    } catch (error: any) {
        console.error("Критическая ошибка:", error.message);
    }
});
