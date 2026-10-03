// src/serial/modbus-crc.ts

import { IniConfig } from '../core/ini/index.js';

/** Описание непрерывного диапазона регистров для опроса одним запросом. */
export interface RegisterBatch {
    start: number;
    count: number;
}

/**
 * Вычисление Modbus RTU CRC16.
 */
export function calculateCRC(buffer: Uint8Array): number {
    let crc = 0xFFFF;
    for (let pos = 0; pos < buffer.length; pos++) {
        crc ^= buffer[pos];
        for (let i = 8; i !== 0; i--) {
            if ((crc & 0x0001) !== 0) {
                crc >>= 1;
                crc ^= 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }
    return crc;
}

/**
 * Оптимизация Modbus запросов: группировка адресов регистров в батчи.
 * Разбивает запросы при дырах между адресами > maxGap или при превышении
 * maxRegisters (125 регистров Modbus).
 */
export function getOptimizedBatches(
    config: IniConfig,
    sectionName: string = 'RAM',
    maxGap: number = 10,
    maxRegistersPerBatch: number = 125
): RegisterBatch[] {
    const sorted = config.getUniqueRegisterAddresses(sectionName);
    if (sorted.length === 0) return [];

    const batches: RegisterBatch[] = [];
    let currentStart = sorted[0];
    let currentEnd = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
        const addr = sorted[i];
        const gap = addr - currentEnd - 1;
        const newCount = (addr - currentStart + 1);
        if (gap > maxGap || newCount > maxRegistersPerBatch) {
            batches.push({
                start: currentStart,
                count: currentEnd - currentStart + 1,
            });
            currentStart = addr;
            currentEnd = addr;
        } else {
            currentEnd = addr;
        }
    }
    batches.push({
        start: currentStart,
        count: currentEnd - currentStart + 1,
    });
    return batches;
}

/**
 * Собирает Modbus-пакет FC03 (Read Holding Registers).
 *
 * Возвращает 8-байтовый Uint8Array:
 *   [slave, 0x03, addrHi, addrLo, cntHi, cntLo, crcLo, crcHi]
 *
 * Используется и в read-loop.ts (живой опрос), и в device_updater.ts
 * (обновление таблицы по кнопке) — чтобы сборка пакета была в одном месте.
 *
 * @param slaveAddr Адрес устройства Modbus (1–247).
 * @param startReg  Начальный адрес регистра.
 * @param count     Количество регистров для чтения (1–125).
 */
export function buildReadHoldingRegistersPacket(
    slaveAddr: number,
    startReg: number,
    count: number,
): Uint8Array {
    const body = new Uint8Array([
        slaveAddr & 0xFF,
        0x03,
        (startReg >> 8) & 0xFF,
        startReg & 0xFF,
        (count >> 8) & 0xFF,
        count & 0xFF,
    ]);
    const crc = calculateCRC(body);
    const packet = new Uint8Array(8);
    packet.set(body, 0);
    packet[6] = crc & 0xFF;
    packet[7] = (crc >> 8) & 0xFF;
    return packet;
}