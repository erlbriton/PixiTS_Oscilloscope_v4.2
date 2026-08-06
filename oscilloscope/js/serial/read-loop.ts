// oscilloscope/js/serial/read-loop.ts

import { serialManager, calculateCRC } from './serial-manager.js';
import { parseRegisterAddress, hexToFloat32, float32ToHex } from '../ini-manager/tree-core.js';
import { updateRowValues } from '../ini-manager/tree-ui.js';

export interface RegisterBatch {
    start: number;
    count: number;
}

/**
 * Оптимизация Modbus запросов: группировка адресов регистров в батчи.
 * Разбивает запросы при дырах между адресами > maxGap или при превышении maxRegisters (125 регистров Modbus).
 */
export function getOptimizedBatches(
    deviceConfig: any, 
    sectionName: string = 'RAM', 
    maxGap: number = 10, 
    maxRegistersPerBatch: number = 125
): RegisterBatch[] {
    const section = deviceConfig ? deviceConfig[sectionName] : null;
    if (!section) return [];

    const addresses: number[] = [];
    for (const key in section) {
        const parts = section[key];
        if (!Array.isArray(parts)) continue;

        const dataType = String(parts[2] || '').toUpperCase();
        const regAddrString = String(dataType === 'TBIT' ? (parts[5] ?? '') : (parts[4] ?? ''));
        const match = regAddrString.match(/(?:x|0x)?([0-9A-Fa-f]+)/i);

        if (match) {
            const reg = parseInt(match[1], 16);
            if (!isNaN(reg)) {
                addresses.push(reg);
                const is32Bit = dataType.includes('FLOAT') || dataType.includes('DWORD') || 
                                dataType.includes('LONG') || dataType.includes('INT32');
                if (is32Bit) {
                    addresses.push(reg + 1);
                }
            }
        }
    }

    if (addresses.length === 0) return [];

    const sorted = Array.from(new Set(addresses)).sort((a, b) => a - b);
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
                count: currentEnd - currentStart + 1
            });
            currentStart = addr;
            currentEnd = addr;
        } else {
            currentEnd = addr;
        }
    }

    batches.push({
        start: currentStart,
        count: currentEnd - currentStart + 1
    });

    return batches;
}

export async function readLoop(serial: any, parser: any, view: any, buffers: any, stateObj: any): Promise<void> {
    if (stateObj.isLoopRunning) return;
    stateObj.isLoopRunning = true;
    
    console.log("DEBUG: Единый батчевый readLoop запущен");
    
    try {
        while (serial && serial.isConnected && stateObj.isPolling) {
            const deviceConfig = stateObj.currentDeviceConfig;
            if (!deviceConfig || !deviceConfig['RAM']) {
                await new Promise(r => setTimeout(r, 500));
                continue; 
            }
            
            // 1. Формируем оптимальные батчи запросов Modbus
            const batches = getOptimizedBatches(deviceConfig, 'RAM', 10, 125);
            if (batches.length === 0) {
                await new Promise(r => setTimeout(r, 500));
                continue;
            }

            serialManager.init(serial);
            const mergedDataMap = new Map<number, number>();

            // 2. Последовательный опрос батчей
            for (const batch of batches) {
                if (!serial.isConnected || !stateObj.isPolling) break;

                const { start: startAddr, count: regCount } = batch;
                const body = new Uint8Array([
                    stateObj.slaveAddress || 0x01, 
                    0x03, 
                    (startAddr >> 8) & 0xFF, 
                    startAddr & 0xFF, 
                    (regCount >> 8) & 0xFF, 
                    regCount & 0xFF
                ]);

                const crc = calculateCRC(body);
                const finalPacket = new Uint8Array(8);
                finalPacket.set(body, 0);
                finalPacket[6] = crc & 0xFF;
                finalPacket[7] = (crc >> 8) & 0xFF;

                const checkComplete = (buf: Uint8Array) => buf.length >= 3 + (regCount * 2) + 2;

                try {
                    const reply = await serialManager.executeTransaction(finalPacket, checkComplete, 500);
                    if (reply && reply.length >= 3 + (regCount * 2)) {
                        for (let i = 0; i < regCount; i++) {
                            const val = (reply[3 + i * 2] << 8) | reply[4 + i * 2];
                            mergedDataMap.set(startAddr + i, val);
                        }
                    }
                } catch (err) {
                    console.error(`Read error for batch start ${startAddr}:`, err);
                }
            }

            if (mergedDataMap.size > 0) {
                // --- 3. СИНХРОНИЗАЦИЯ С ОСЦИЛЛОГРАФОМ ---
                const ram = deviceConfig['RAM'];
                const oscData: Record<string, number> = {};
                
                for (const key in ram) {
                    const parts = ram[key];
                    if (!Array.isArray(parts)) continue;
                    
                    const dataType = String(parts[2] || '').toUpperCase();
                    const regAddrString = String(dataType === 'TBIT' ? (parts[5] ?? '') : (parts[4] ?? ''));
                    const { reg } = parseRegisterAddress(regAddrString);
                    
                    if (reg !== null && mergedDataMap.has(reg)) {
                        const low = mergedDataMap.get(reg)!;
                        let val = 0;
                        const is32Bit = dataType.includes('FLOAT') || dataType.includes('DWORD') || 
                                        dataType.includes('LONG') || dataType.includes('INT32');
                        
                        if (is32Bit && mergedDataMap.has(reg + 1)) {
                            const high = mergedDataMap.get(reg + 1)!;

                            if (dataType.includes('FLOAT')) {
                                const buf = new ArrayBuffer(4);
                                const dv = new DataView(buf);
                                dv.setUint16(0, high, false);
                                dv.setUint16(2, low, false);
                                val = dv.getFloat32(0, false);
                            } else if (dataType.includes('LONG') || dataType.includes('INT32')) {
                                val = ((high << 16) | low) | 0;
                            } else {
                                val = ((high << 16) | low) >>> 0;
                            }
                        } else {
                            val = low;
                            if (dataType === 'TSHORT' || dataType === 'TINT') {
                                val = val & 0x8000 ? val - 0x10000 : val;
                            } else if (dataType === 'TBIT') {
                                const bitNum = parseInt(parts[6] || '0', 10);
                                val = (val >> bitNum) & 0x01;
                            }
                        }

                        const scaleRaw = parseFloat(parts[3]);
                        const scale = isNaN(scaleRaw) ? 1.0 : scaleRaw;
                        val = val * scale;
                        
                        oscData[key] = val;

                        if (buffers) {
                            if (buffers instanceof Map && buffers.has(key)) {
                                buffers.get(key).push(val);
                            } else if (buffers[key] && typeof buffers[key].push === 'function') {
                                buffers[key].push(val);
                            }
                        }
                    }
                }
                
                const activeOsc = (window as any).osc || view;
                if (activeOsc && typeof activeOsc.updateValues === 'function') {
                    activeOsc.updateValues(oscData);
                } else if (activeOsc && typeof activeOsc.draw === 'function') {
                    activeOsc.draw(oscData);
                }

                // --- 4. СИНХРОНИЗАЦИЯ С ТАБЛИЦЕЙ MODBUS ---
                const tableRows = document.querySelectorAll<HTMLTableRowElement>('#grid-data-rows tr');
                if (tableRows.length > 0) {
                    tableRows.forEach(tr => {
                        const addrStr = tr.getAttribute('data-reg');
                        if (!addrStr) return;
                        const { reg } = parseRegisterAddress(addrStr);
                        if (reg === null || !mergedDataMap.has(reg)) return;

                        const word = mergedDataMap.get(reg)!;
                        const dataType = tr.getAttribute('data-type') || '';
                        const sub = tr.getAttribute('data-sub') || '';
                        const hIdx = parseInt(tr.getAttribute('data-hex-index') || '0', 10);

                        let parts: string[] = [];
                        try { parts = JSON.parse(tr.dataset.parts || '[]'); } catch (e) { return; }

                        let originalHexLen = 4;
                        if (parts[hIdx] && parts[hIdx].startsWith('x')) {
                            originalHexLen = parts[hIdx].slice(1).length;
                        }

                        let scale = 1.0;
                        if (parts[6]) {
                            const parsedScale = parseFloat(parts[6].replace(',', '.'));
                            if (!isNaN(parsedScale)) scale = parsedScale;
                        }

                        const prmListOptions: Record<string, string> = {};
                        for (let j = parts.length - 1; j >= 3; j--) {
                            const part = parts[j] ? parts[j].trim() : '';
                            if (part.includes('#')) {
                                const [h, t] = part.split('#');
                                if (h && t) prmListOptions[h.toLowerCase()] = t;
                            }
                        }

                        let hexValue = '';

                        if (dataType === 'TByte' || dataType === 'TPrmList') {
                            const byteVal = (sub === 'H') ? ((word >> 8) & 0xFF) : (word & 0xFF);
                            hexValue = 'x' + byteVal.toString(16).toUpperCase().padStart(originalHexLen, '0');
                        } else if (dataType === 'TBit') {
                            const bitIndex = parseInt(sub, 16);
                            const bitVal = (word >> (isNaN(bitIndex) ? 0 : bitIndex)) & 1;
                            hexValue = 'x' + bitVal.toString(16).toUpperCase().padStart(originalHexLen, '0');
                        } else if (dataType.includes('FLOAT') || dataType.includes('DWORD') || dataType.includes('LONG') || dataType.includes('INT32')) {
                            if (mergedDataMap.has(reg + 1)) {
                                const nextWord = mergedDataMap.get(reg + 1)!;
                                hexValue = 'x' + nextWord.toString(16).toUpperCase().padStart(4, '0') + word.toString(16).toUpperCase().padStart(4, '0');
                            }
                        } else {
                            hexValue = 'x' + word.toString(16).toUpperCase().padStart(originalHexLen, '0');
                        }

                        if (hexValue && hIdx !== -1 && hIdx < parts.length) {
                            parts[hIdx] = hexValue;
                            tr.dataset.parts = JSON.stringify(parts);
                            updateRowValues(tr, parts, dataType, scale, hIdx, originalHexLen, prmListOptions, hexToFloat32, float32ToHex, 4);
                        }
                    });
                }
            }
            
            await new Promise((res) => setTimeout(res, 50));
        }
    } finally {
        stateObj.isLoopRunning = false;
        console.log("DEBUG: Единый батчевый readLoop остановлен");
    }
}
