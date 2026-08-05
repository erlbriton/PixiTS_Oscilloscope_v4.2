import { identifyUsbChip } from './usb.js';
import { showIdModal, updateIdBanner, closeIdModal } from './ui.js';

let currentLoopId = 0; 

type ChunkHandler = (chunk: Uint8Array) => void;
type CheckCompleteFn = (buffer: Uint8Array) => boolean;

// === ЦЕНТРАЛЬНЫЙ МЕНЕДЖЕР ПОРТА (АРХИТЕКТУРА «ЕДИНЫЙ ЧИТАТЕЛЬ») ===
class SerialManager {
    public serial: any;
    public readerPromise: Promise<void> | null;
    public currentHandler: ChunkHandler | null;
    private lock: Promise<void>;

    constructor() {
        this.serial = null;
        this.readerPromise = null;
        this.currentHandler = null;
        this.lock = Promise.resolve();
    }

    public init(serial: any): void {
        this.serial = serial;
        this.startReader();
    }

    public startReader(): void {
        if (this.readerPromise || !this.serial || !this.serial.isConnected) return;
        
        this.readerPromise = (async () => {
            console.log("[SerialManager] Центральный единый ридер успешно запущен.");
            while (this.serial && this.serial.isConnected) {
                try {
                    const chunk: Uint8Array | null = await this.serial.readChunk();
                    if (chunk && chunk.length > 0) {
                        if (this.currentHandler) {
                            this.currentHandler(chunk);
                        }
                    } else {
                        // Кратковременная пауза при пустом чанке, чтобы не перегружать CPU
                        await new Promise((r) => setTimeout(r, 5));
                    }
                } catch (e) {
                    console.error("[SerialManager] Критическая ошибка в едином ридере:", e);
                    break;
                }
            }
            this.readerPromise = null;
            console.log("[SerialManager] Центральный единый ридер остановлен.");
        })();
    }

    public async executeTransaction(
        packet: Uint8Array,
        checkCompleteFn: CheckCompleteFn,
        timeoutMs: number = 1000
    ): Promise<Uint8Array> {
        // Строгая атомарная очередь запросов через Промис-Лок (Мьютекс)
        const oldLock = this.lock;
        let release: () => void = () => {};
        this.lock = new Promise((r) => { release = r; });
        await oldLock;

        try {
            this.startReader(); // Гарантируем работу ридера перед отправкой

            await this.serial.write(packet);

            return await new Promise<Uint8Array>((resolve) => {
                let buffer = new Uint8Array(0);
                let timeoutId: any = null;

                const cleanUp = () => {
                    if (timeoutId) clearTimeout(timeoutId);
                    if (this.currentHandler === handleChunk) {
                        this.currentHandler = null;
                    }
                };

                const handleChunk: ChunkHandler = (chunk: Uint8Array) => {
                    let newBuffer = new Uint8Array(buffer.length + chunk.length);
                    newBuffer.set(buffer);
                    newBuffer.set(chunk, buffer.length);
                    buffer = newBuffer;

                    if (checkCompleteFn(buffer)) {
                        cleanUp();
                        resolve(buffer);
                    }
                };

                this.currentHandler = handleChunk;

                timeoutId = setTimeout(() => {
                    cleanUp();
                    resolve(buffer); // Возвращаем накопленное по таймауту, если устройство не успело
                }, timeoutMs);
            });
        } catch (err) {
            console.error("[SerialManager] Ошибка транзакции:", err);
            throw err;
        } finally {
            release();
        }
    }
}

export const serialManager = new SerialManager();

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

export async function readLoop(serial: any, parser: any, view: any, buffers: any[], stateObj: any): Promise<void> {
    if (stateObj.isLoopRunning) return;
    stateObj.isLoopRunning = true;
    
    console.log("DEBUG: readLoop запущен");
    
    const { getSectionRange, parseRegisterAddress } = await import('./ini-manager/tree-core.js');
    
    try {
        while (serial.isConnected && stateObj.isPolling) {
            const deviceConfig = stateObj.currentDeviceConfig;
            if (!deviceConfig || !deviceConfig['RAM']) {
                await new Promise(r => setTimeout(r, 500));
                continue; 
            }
            
            const { start: startAddr, count: regCount } = getSectionRange(deviceConfig, 'RAM');
            if (regCount <= 0) {
                await new Promise(r => setTimeout(r, 500));
                continue;
            }
            serialManager.init(serial);
            
            const body = new Uint8Array([
                stateObj.slaveAddress, 
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
            
            const checkComplete: CheckCompleteFn = (buf: Uint8Array) => buf.length >= 3 + (regCount * 2) + 2;
            
            try {
                const reply = await serialManager.executeTransaction(finalPacket, checkComplete, 500);
                
                if (reply && reply.length >= 3 + (regCount * 2)) {
                    const data = new Uint16Array(regCount);
                    for (let i = 0; i < regCount; i++) {
                        data[i] = (reply[3 + i * 2] << 8) | reply[4 + i * 2];
                    }
                    
                    // Parse values according to RAM config
                    const ram = deviceConfig['RAM'];
                    const oscData: Record<string, number> = {};
                    
                    for (const key in ram) {
                        const parts = ram[key];
                        if (!Array.isArray(parts)) continue;
                        
                        const dataType = String(parts[2] || '').toUpperCase();
                        const regAddrString = String(dataType === 'TBIT' ? (parts[5] ?? '') : (parts[4] ?? ''));
                        const { reg } = parseRegisterAddress(regAddrString);
                        
                        if (reg !== null && reg >= startAddr && reg < startAddr + regCount) {
                            const offset = reg - startAddr;
                            let val = 0;
                            
                            const is32Bit = dataType.includes('FLOAT') || dataType.includes('DWORD') || dataType.includes('LONG') || dataType.includes('INT32');
                            
                            if (is32Bit && offset + 1 < regCount) {
                                const high = data[offset];
                                const low = data[offset + 1];
                                if (dataType.includes('FLOAT')) {
                                    const buf = new ArrayBuffer(4);
                                    const dv = new DataView(buf);
                                    dv.setUint16(0, high, false);
                                    dv.setUint16(2, low, false);
                                    val = dv.getFloat32(0, false);
                                } else {
                                    val = (high << 16) | low;
                                }
                            } else {
                                val = data[offset];
                                if (dataType === 'TBIT') {
                                    const bitNum = parseInt(parts[6] || '0');
                                    val = (val >> bitNum) & 0x01;
                                }
                            }
                            
                            oscData[key] = val;
                        }
                    }
                    
                    if (view && typeof (view as any).draw === 'function') {
                        (view as any).draw(oscData);
                    }
                }
            } catch (err) { 
                console.error("Read error:", err);
            }
            
            await new Promise((res) => setTimeout(res, 50));
        }
    } finally {
        stateObj.isLoopRunning = false;
        console.log("DEBUG: readLoop остановлен");
    }
}
