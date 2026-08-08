// src/serial/serial.ts

import type { ISerialPort, SerialPortInfo } from './ISerialPort.js';

declare global {
    interface Navigator {
        serial?: {
            requestPort(options?: any): Promise<any>;
        };
    }
}

export class SerialConnection implements ISerialPort {
    public port: any;
    public reader: ReadableStreamDefaultReader<Uint8Array> | null;
    public readableStream: ReadableStream<Uint8Array> | null;
    public isConnected: boolean;
    private onDisconnectCallback?: () => void;

    constructor() {
        this.port = null;
        this.reader = null;
        this.readableStream = null;
        this.isConnected = false;
    }

    /**
     * Подписка на событие обрыва связи (вызывается при release()).
     */
    public onDisconnect(cb: () => void): void {
        this.onDisconnectCallback = cb;
    }

    /**
     * Информация об устройстве (VID/PID) для определения чипа.
     */
    public getPortInfo(): SerialPortInfo {
        if (this.port && typeof this.port.getInfo === 'function') {
            return this.port.getInfo();
        }
        return {};
    }

    /**
     * Запрос разрешения у пользователя и открытие физического COM-порта.
     */
    public async connect(baudRate: number = 115200): Promise<void> {
        if (!(navigator as any).serial) {
            throw new Error(
                "Ваш браузер не поддерживает Web Serial API. Используйте Chrome или Edge."
            );
        }

        try {
            const port = await (navigator as any).serial.requestPort();

            if (!port) {
                throw new Error("Порт не выбран.");
            }

            await port.open({ baudRate });

            const readable = port.readable as ReadableStream<Uint8Array> | null;

            if (readable) {
                this.readableStream = readable;
                this.reader = readable.getReader();
            } else {
                this.readableStream = null;
                this.reader = null;
            }

            this.port = port;
            this.isConnected = true;

            console.log(`[Serial] Порт успешно открыт на скорости ${baudRate} бод.`);
        } catch (error: any) {
            this.isConnected = false;
            this.port = null;
            this.reader = null;
            this.readableStream = null;

            throw new Error(`Ошибка подключения к порту: ${error.message}`);
        }
    }

    /**
     * Асинхронное чтение очередной порции сырых байт из буфера.
     */
    public async readChunk(): Promise<Uint8Array | null> {
        const reader = this.reader;

        if (!this.isConnected || !reader) {
            return null;
        }

        try {
            const { value, done } = await reader.read();

            if (done) {
                this.release();
                return null;
            }

            return value ?? null;
        } catch (error: any) {
            console.error("[Serial] Ошибка критического чтения из порта:", error.message);
            this.release();
            throw error;
        }
    }

    /**
     * Отправка массива байт в устройство.
     */
    public async write(data: Uint8Array): Promise<void> {
        const port = this.port;

        if (!this.isConnected || !port || !port.writable) {
            return;
        }

        const writer = port.writable.getWriter();
        await writer.write(data);
        writer.releaseLock();
    }

    /**
     * Освобождает reader без закрытия порта.
     */
    public async unlockReader(): Promise<void> {
        const reader = this.reader;

        if (!reader) {
            return;
        }

        try {
            await reader.cancel();
            reader.releaseLock();
        } catch {
            // ignore
        }

        this.reader = null;
    }

    /**
     * Возвращает reader себе.
     */
    public async lockReader(): Promise<void> {
        const port = this.port;

        if (!port || !port.readable) {
            this.readableStream = null;
            this.reader = null;
            return;
        }

        const readable = port.readable as ReadableStream<Uint8Array> | null;

        if (!readable) {
            this.readableStream = null;
            this.reader = null;
            return;
        }

        this.readableStream = readable;
        this.reader = readable.getReader();
    }

    /**
     * Корректное освобождение ресурсов.
     */
    public release(): void {
        const wasConnected = this.isConnected;
        this.isConnected = false;

        const reader = this.reader;

        if (reader) {
            try {
                reader.releaseLock();
            } catch {
                // ignore
            }
        }

        this.reader = null;
        this.readableStream = null;
        this.port = null;

        // Уведомляем подписчиков об обрыве связи (только если были подключены)
        if (wasConnected && this.onDisconnectCallback) {
            this.onDisconnectCallback();
        }
    }
}