// src/serial/serial-manager.ts

import type { ISerialPort } from './ISerialPort.js';
import { calculateCRC } from './modbus-crc.js';

/** Колбэк для накопления и проверки готовности ответа. */
export type ChunkHandler = (chunk: Uint8Array) => void;
export type CheckCompleteFn = (buffer: Uint8Array) => boolean;

/**
 * Структурированный результат транзакции. Используется там, где нужно
 * различать ситуации «устройство молчит» и «устройство ответило мусором».
 */
export type TransactionResult =
    | { kind: 'ok'; bytes: Uint8Array }
    | { kind: 'bad_crc'; bytes: Uint8Array; expected: number; actual: number }
    | { kind: 'too_short'; bytes: Uint8Array }
    | { kind: 'timeout' }
    | { kind: 'error'; message: string };

// === ЦЕНТРАЛЬНЫЙ МЕНЕДЖЕР ПОРТА (АРХИТЕКТУРА «ЕДИНЫЙ ЧИТАТЕЛЬ») ===
class SerialManager {
    public serial: ISerialPort | null;
    public readerPromise: Promise<void> | null;
    public currentHandler: ChunkHandler | null;
    private lock: Promise<void>;

    constructor() {
        this.serial = null;
        this.readerPromise = null;
        this.currentHandler = null;
        this.lock = Promise.resolve();
    }

    public init(serial: ISerialPort): void {
        this.serial = serial;
        this.startReader();
    }

    public startReader(): void {
        if (this.readerPromise || !this.serial || !this.serial.isConnected) return;
        this.readerPromise = (async () => {
            console.log('[SerialManager] Центральный единый ридер успешно запущен.');
            while (this.serial && this.serial.isConnected) {
                try {
                    const chunk: Uint8Array | null = await this.serial.readChunk();
                    if (chunk && chunk.length > 0) {
                        if (this.currentHandler) {
                            this.currentHandler(chunk);
                        }
                    } else {
                        await new Promise((r) => setTimeout(r, 5));
                    }
                } catch (e) {
                    console.error('[SerialManager] Критическая ошибка в едином ридере:', e);
                    break;
                }
            }
            this.readerPromise = null;
            console.log('[SerialManager] Центральный единый ридер остановлен.');
        })();
    }

    public async executeTransaction(
        packet: Uint8Array,
        checkCompleteFn: CheckCompleteFn,
        timeoutMs: number = 1000
    ): Promise<Uint8Array> {
        const oldLock = this.lock;
        let release: () => void = () => { };
        this.lock = new Promise((r) => { release = r; });
        await oldLock;
        try {
            this.startReader();
            const port = this.serial;
            if (!port) {
                throw new Error('[SerialManager] Порт не инициализирован для транзакции.');
            }
            await port.write(packet);
            return await new Promise<Uint8Array>((resolve) => {
                let buffer = new Uint8Array(0);
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                const cleanUp = () => {
                    if (timeoutId) clearTimeout(timeoutId);
                    if (this.currentHandler === handleChunk) {
                        this.currentHandler = null;
                    }
                };
                const handleChunk: ChunkHandler = (chunk: Uint8Array) => {
                    const newBuffer = new Uint8Array(buffer.length + chunk.length);
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
                    resolve(buffer);
                }, timeoutMs);
            });
        } catch (err) {
            console.error('[SerialManager] Ошибка транзакции:', err);
            throw err;
        } finally {
            release();
        }
    }

    /**
     * Транзакция с диагностикой. Отличается от обычной executeTransaction
     * тем, что НЕ бросает исключение при ошибке транспорта, а возвращает
     * структурированный результат. Используется в окне «Командная строка».
     */
    public async executeTransactionVerbose(
        packet: Uint8Array,
        timeoutMs: number = 1000
    ): Promise<TransactionResult> {
        let bytes: Uint8Array;
        try {
            const neverComplete: CheckCompleteFn = () => false;
            bytes = await this.executeTransaction(packet, neverComplete, timeoutMs);
        } catch (err) {
            return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
        }

        if (bytes.length === 0) {
            return { kind: 'timeout' };
        }

        if (bytes.length < 4) {
            return { kind: 'too_short', bytes };
        }

        const payload = bytes.slice(0, bytes.length - 2);
        const expected = calculateCRC(payload);
        const actual = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);

        if (expected !== actual) {
            return { kind: 'bad_crc', bytes, expected, actual };
        }

        return { kind: 'ok', bytes };
    }
}

export const serialManager = new SerialManager();