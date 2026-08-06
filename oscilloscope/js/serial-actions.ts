// oscilloscope/js/serial-actions.ts

import { identifyUsbChip } from './usb.js';
import { showIdModal, updateIdBanner, closeIdModal } from './ui.js';
import { serialManager } from './serial/serial-manager.js';

export { serialManager, calculateCRC } from './serial/serial-manager.js';
export { readLoop, getOptimizedBatches, type RegisterBatch } from './serial/read-loop.js';

type CheckCompleteFn = (buffer: Uint8Array) => boolean;

/**
 * Определяет имя чипа и обновляет селект.
 */
export function updateComInterfaceName(serial: any, comSelect: HTMLSelectElement | null): string {
    if (!comSelect) return "";
    const portInfo = (serial.port && typeof serial.port.getInfo === 'function') 
        ? serial.port.getInfo() 
        : (typeof serial.getInfo === 'function' ? serial.getInfo() : {});
    const chipName = identifyUsbChip(portInfo);
    comSelect.innerHTML = `<option value="active">${chipName}</option>`;
    comSelect.className = 'select-blue';
    return chipName;
}

/**
 * Идентификация устройства.
 */
export async function executeDeviceIdentification(serial: any, comSelect: HTMLSelectElement | null, stateObj: any): Promise<void> {
    try {
        stateObj.isIdentifying = true; 
        await serial.connect(115200);
        serialManager.init(serial);
        
        updateComInterfaceName(serial, comSelect);
        await new Promise((r) => setTimeout(r, 500));
        showIdModal("Запрос ID устройства...");
        
        const packet = new Uint8Array([0x01, 0x11, 0xC0, 0x2C]);

        const checkComplete: CheckCompleteFn = (buf: Uint8Array) => {
            if (buf.length >= 3) {
                const dataLength = buf[2]; 
                return buf.length >= 3 + dataLength + 2 || buf.length >= 52;
            }
            return false;
        };

        const reply = await serialManager.executeTransaction(packet, checkComplete, 1500);

        if (reply && reply.length >= 3) {
            const dataLength = reply[2];
            let idText = "";
            for (let i = 3; i < Math.min(3 + dataLength, reply.length - 2); i++) {
                if (reply[i] >= 32) idText += String.fromCharCode(reply[i]);
            }
            updateIdBanner(idText.trim());
            closeIdModal();
        } else {
            showIdModal("Ошибка: Нет ответа от устройства");
        }
    } catch (error: any) {
        showIdModal("Ошибка: " + error.message);
    } finally {
        stateObj.isIdentifying = false; 
    }
}
