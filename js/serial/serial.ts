import { currentDeviceConfig } from '../ini-manager/tree-core.js';

// Расширяем глобальный объект navigator для поддержки Web Serial API, если типы отсутствуют в окружении
declare global {
    interface Navigator {
        serial?: {
            requestPort(options?: any): Promise<any>;
        };
    }
}

export function calculateRamRange(variables: any): {
    startAddress: number;
    count: number;
    minAddress: number;
    maxAddress: number;
    length: number;
} {
    return {
        startAddress: 0,
        count: 0,
        minAddress: 0,
        maxAddress: 0,
        length: 0
    };
}

export class SerialConnection {
    public port: any;
    public reader: ReadableStreamDefaultReader<Uint8Array> | null;
    public readableStream: ReadableStream<Uint8Array> | null;
    public isConnected: boolean;

    constructor() {
        this.port = null;
        this.reader = null;
        this.readableStream = null;
        this.isConnected = false;
    }

    /**
     * Запрос разрешения у пользователя и открытие физического COM-порта.
     * @param baudRate - Скорость подключения (по умолчанию 115200 для STM32)
     */
    public async connect(baudRate: number = 115200): Promise<void> {
        if (!(navigator as any).serial) {
            throw new Error("Ваш браузер не поддерживает Web Serial API. Используйте Chrome или Edge.");
        }

        try {
            // Браузер запрашивает у операционной системы список доступных портов
            this.port = await (navigator as any).serial.requestPort();
            
            if (!this.port) {
                throw new Error("Порт не выбран.");
            }

            // Открываем порт на заданной скорости
            await this.port.open({ baudRate: baudRate });
            
            this.readableStream = this.port.readable;
            if (this.readableStream) {
                this.reader = this.readableStream.getReader();
            }
            this.isConnected = true;
            
            console.log(`[Serial] Порт успешно открыт на скорости ${baudRate} бод.`);
        } catch (error: any) {
            this.isConnected = false;
            this.port = null;
            this.reader = null;
            throw new Error(`Ошибка подключения к порту: ${error.message}`);
        }
    }

    /**
     * Асинхронное чтение очередной порции сырых байт из буфера
     * @returns Массив считанных байт или null, если чтение завершено
     */
    public async readChunk(): Promise<Uint8Array | null> {
        if (!this.isConnected || !this.reader) return null;
        try {
            const { value, done } = await this.reader.read();
            if (done) {
                this.release();
                return null;
            }
            return value || null; // Возвращаем Uint8Array со свежими байтами
        } catch (error: any) {
            console.error("[Serial] Ошибка критического чтения из порта:", error.message);
            this.release();
            throw error;
        }
    }

    /**
     * Отправка массива байт (запроса Мастера) в сторону устройства (Slave)
     * @param data - Массив байт запроса Modbus RTU
     */
    public async write(data: Uint8Array): Promise<void> {
        if (!this.isConnected || !this.port || !this.port.writable) return;
        
        const writer = this.port.writable.getWriter();
        await writer.write(data);
        writer.releaseLock(); // Мгновенно освобождаем поток записи для следующих циклов опроса
    }

    /**
     * Освобождает замок (reader) без закрытия порта, чтобы другой компонент (осциллограф) мог его использовать.
     */
    public async unlockReader(): Promise<void> {
        if (this.reader) {
            try {
                await this.reader.cancel();
                this.reader.releaseLock();
            } catch (e) {}
            this.reader = null;
        }
    }

    /**
     * Возвращает замок (reader) себе.
     */
    public async lockReader(): Promise<void> {
        if (this.port && this.port.readable) {
            this.readableStream = this.port.readable;
            this.reader = this.readableStream.getReader();
        }
    }

    /**
     * Корректное освобождение ресурсов при закрытии порта или отключении кабеля
     */
    public release(): void {
        this.isConnected = false;
        try { 
            if (this.reader) {
                this.reader.releaseLock(); 
            }
        } catch (e) {}
        this.reader = null;
        this.port = null;
    }
}
