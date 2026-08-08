import { updateRowValues } from "../ini-manager/tree-ui.js";
import { hexToFloat32, float32ToHex } from "../ini-manager/tree-core.js";
import { calculateCRC, serialManager } from "./serial-actions.js";
import type { ISerialPort } from "./ISerialPort.js";

declare global {
    interface Window {
        resetUpdateState?: () => void;
    }
}

/**
 * Вспомогательная функция для получения готового множителя из кэша.
 * Теперь множители уже разрешены на этапе парсинга INI-файла.
 */
function getScaleFromCache(appState: any, section: string, key: string): number {
    const cache = appState?.parser?.multiplierCache;
    if (!cache) {
        return 1.0;
    }
    if (cache[section] && cache[section][key] !== undefined) {
        const val = parseFloat(cache[section][key].replace(",", "."));
        return val;
    }
    return 1.0;
}

let isUpdating = false;

export async function updateDeviceRegisters(
    serial: ISerialPort,
    slaveAddress: number = 0x01,
    appState: any = null,
): Promise<boolean> {
    if (isUpdating) return false;
    isUpdating = true;

    document.body.classList.add("loading-state");

    const wasPolling = appState ? appState.isPolling : false;

    if (wasPolling) {
        appState.isPolling = false;
        await new Promise((r) => setTimeout(r, 20));
    }

    try {
        const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>("#grid-data-rows tr"));
        const registerMap = new Map<number, HTMLTableRowElement[]>();
        const addresses: number[] = [];

        for (const tr of rows) {
            const addrStr = tr.getAttribute("data-reg");
            if (!addrStr) continue;
            const addr = parseInt(addrStr, 16);
            if (!registerMap.has(addr)) {
                registerMap.set(addr, []);
            }
            registerMap.get(addr)?.push(tr);

            const dataType = tr.getAttribute("data-type");
            if (dataType === "TFloat" || dataType === "TDWORD" || dataType === "FLOAT" || dataType === "TFLOAT32") {
                addresses.push(addr);
                addresses.push(addr + 1);
            } else {
                addresses.push(addr);
            }
        }

        const uniqueAddresses = [...new Set(addresses)].sort((a, b) => a - b);

        interface Batch {
            start: number;
            end: number;
            regs: number[];
        }

        const batches: Batch[] = [];

        if (uniqueAddresses.length > 0) {
            let currentBatch: Batch = {
                start: uniqueAddresses[0],
                end: uniqueAddresses[0],
                regs: [uniqueAddresses[0]],
            };

            for (let i = 1; i < uniqueAddresses.length; i++) {
                const nextAddr = uniqueAddresses[i];
                const gap = nextAddr - currentBatch.end - 1;

                if (gap <= 3 && nextAddr - currentBatch.start + 1 <= 125) {
                    currentBatch.end = nextAddr;
                    currentBatch.regs.push(nextAddr);
                } else {
                    batches.push(currentBatch);
                    currentBatch = { start: nextAddr, end: nextAddr, regs: [nextAddr] };
                }
            }
            batches.push(currentBatch);
        }

        for (const batch of batches) {
            const count = batch.end - batch.start + 1;
            const body = new Uint8Array([
                slaveAddress,
                0x03,
                (batch.start >> 8) & 0xff,
                batch.start & 0xff,
                (count >> 8) & 0xff,
                count & 0xff,
            ]);

            const crc = calculateCRC(body);
            const finalPacket = new Uint8Array(8);
            finalPacket.set(body, 0);
            finalPacket[6] = crc & 0xff;
            finalPacket[7] = (crc >> 8) & 0xff;

            try {
                const checkComplete = (buf: Uint8Array): boolean => {
                    if (buf.length >= 3 && buf[1] === 0x03) {
                        const byteCount = buf[2];
                        return buf.length >= 3 + byteCount + 2;
                    }
                    if (buf.length >= 5 && (buf[1] & 0x80)) {
                        return true;
                    }
                    return false;
                };

                const reply: Uint8Array | null = await serialManager.executeTransaction(
                    finalPacket,
                    checkComplete,
                    300,
                );

                if (reply && reply.length >= 3 && reply[1] === 0x03) {
                    const byteCount = reply[2];
                    const expectedTotal = 3 + byteCount + 2;

                    if (reply.length >= expectedTotal) {
                        for (let i = 0; i < count; i++) {
                            const regAddr = batch.start + i;
                            if (registerMap.has(regAddr)) {
                                const trList = registerMap.get(regAddr);
                                if (!trList) continue;

                                for (const tr of trList) {
                                    try {
                                        let parts: string[] = JSON.parse(tr.dataset.parts || "[]");
                                        const dataType = tr.getAttribute("data-type") || "";
                                        const sub = tr.getAttribute("data-sub") || "";
                                        const hIdx = parseInt(
                                            tr.getAttribute("data-hex-index") || "0",
                                        );
                                        const section = tr.getAttribute("data-section") || "";
                                        const key = tr.getAttribute("data-key") || "";

                                        let originalHexLen = 4;
                                        if (parts[hIdx] && parts[hIdx].startsWith("x")) {
                                            originalHexLen = parts[hIdx].slice(1).length;
                                        }

                                        const scale = getScaleFromCache(appState, section, key);
                                        const scaleStr = scale.toString().replace(".", ",");

                                        const prmListOptions: Record<string, string> = {};
                                        for (let j = parts.length - 1; j >= 3; j--) {
                                            const part = parts[j] ? parts[j].trim() : "";
                                            if (part.includes("#")) {
                                                const [h, t] = part.split("#");
                                                if (h && t) {
                                                    prmListOptions[h.toLowerCase()] = t;
                                                }
                                            }
                                        }

                                        const valH = reply[3 + i * 2];
                                        const valL = reply[4 + i * 2];
                                        const word = (valH << 8) | valL;

                                        let hexValue = "";

                                        if (dataType === "TByte" || dataType === "TPrmList") {
                                            if (sub === "H") {
                                                const byteVal = (word >> 8) & 0xff;
                                                hexValue = "x" + byteVal.toString(16).padStart(originalHexLen, "0");
                                            } else {
                                                const byteVal = word & 0xff;
                                                hexValue = "x" + byteVal.toString(16).padStart(originalHexLen, "0");
                                            }
                                        } else if (dataType === "TBit") {
                                            const bitIndex = parseInt(sub, 16);
                                            const bitVal = (word >> bitIndex) & 1;
                                            hexValue = "x" + bitVal.toString(16).padStart(originalHexLen, "0");
                                        } else if (dataType === "TFloat" || dataType === "TDWORD" || dataType === "FLOAT" || dataType === "TFLOAT32") {
                                            if (i + 1 < count) {
                                                const nextValH = reply[3 + (i + 1) * 2];
                                                const nextValL = reply[4 + (i + 1) * 2];
                                                const nextWord = (nextValH << 8) | nextValL;
                                                hexValue = "x" + nextWord.toString(16).padStart(4, "0") + word.toString(16).padStart(4, "0");
                                            } else {
                                                continue;
                                            }
                                        } else {
                                            hexValue = "x" + word.toString(16).padStart(originalHexLen, "0");
                                        }

                                        if (hexValue) {
                                            parts[hIdx] = hexValue;
                                            parts[6] = scaleStr;
                                            tr.dataset.parts = JSON.stringify(parts);
                                            updateRowValues(tr, parts, dataType, scale, hIdx, originalHexLen, prmListOptions, hexToFloat32, float32ToHex, 6);
                                            tr.classList.add("updated");
                                        }
                                    } catch (e) {
                                        console.error(`Error processing row:`, e);
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.error(`Batch error:`, err);
            }
        }
    } finally {
        isUpdating = false;
        document.body.classList.remove("loading-state");
    }

    return wasPolling;
}

export function resetUpdateState(): void {
    isUpdating = false;
    document.body.classList.remove("loading-state");
}

window.resetUpdateState = resetUpdateState;