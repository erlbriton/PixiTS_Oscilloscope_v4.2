// oscilloscope/js/serial/serial-manager.ts

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
