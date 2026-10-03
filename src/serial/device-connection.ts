// src/serial/device-connection.ts

import { identifyUsbChip } from './usb.js';
import { showIdModal, updateIdBanner, closeIdModal } from '../ui/ui.js';
import type { ISerialPort } from './ISerialPort.js';
import type { AppState } from '../core/app-state.js';
import { serialManager, type CheckCompleteFn } from './serial-manager.js';
import { calculateCRC } from './modbus-crc.js';

export function updateComInterfaceName(
    serial: ISerialPort,
    comSelect: HTMLSelectElement | null
): string {
    if (!comSelect) return '';
    const portInfo = serial.getPortInfo();
    const chipName = identifyUsbChip(portInfo);
    comSelect.innerHTML = `<option value="active">${chipName}</option>`;
    comSelect.className = 'select-blue';
    return chipName;
}

export async function executeDeviceIdentification(
    serial: ISerialPort,
    comSelect: HTMLSelectElement | null,
    stateObj: AppState,
    baudSelect: HTMLSelectElement | null = null
): Promise<void> {
    try {
        stateObj.isIdentifying = true;
        const baudRate = baudSelect ? parseInt(baudSelect.value, 10) || 115200 : 115200;

        // Если порт уже открыт — не открываем повторно: Web Serial
        // бросает ошибку повторного open() и снова показывает выбор порта.
        if (!serial.isConnected) {
            await serial.connect(baudRate);
            serialManager.init(serial);
            updateComInterfaceName(serial, comSelect);
            await new Promise((r) => setTimeout(r, 500));
        }

        showIdModal('Запрос ID устройства...');

        const body = new Uint8Array([stateObj.slaveAddress & 0xFF, 0x11]);
        const crc = calculateCRC(body);
        const packet = new Uint8Array([body[0], body[1], crc & 0xFF, (crc >> 8) & 0xFF]);

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
            let idText = '';
            for (let i = 3; i < Math.min(3 + dataLength, reply.length - 2); i++) {
                if (reply[i] >= 32) idText += String.fromCharCode(reply[i]);
            }
            updateIdBanner(idText.trim());
            closeIdModal();
        } else {
            showIdModal('Ошибка: Нет ответа от устройства');
        }
    } catch (error: unknown) {
        // Пользователь закрыл окно выбора порта, не выбрав порт —
        // штатная ситуация: молча выходим, без окна ошибки.
        if (error instanceof Error && error.name === 'PortCancelledError') {
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        showIdModal('Ошибка: ' + message);
    } finally {
        stateObj.isIdentifying = false;
    }
}