// src/serial/serial.ts
import type { ISerialPort, SerialPortInfo } from './ISerialPort.js';
import type { WebSerialPort } from './web-serial-types.js';
// ↑ Убрали declare global — типы теперь в web-serial-types.ts

export class SerialConnection implements ISerialPort {
  public port: WebSerialPort | null;          // ← был any
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

  public onDisconnect(cb: () => void): void {
    this.onDisconnectCallback = cb;
  }

  public getPortInfo(): SerialPortInfo {
    if (this.port) {
      return this.port.getInfo();             // ← без проверки typeof, тип гарантирует метод
    }
    return {};
  }

  public async connect(baudRate: number = 115200): Promise<void> {
    if (!navigator.serial) {
      throw new Error(
        'Ваш браузер не поддерживает Web Serial API. Используйте Chrome или Edge.',
      );
    }
    try {
      const port = await navigator.serial.requestPort();
      if (!port) {
        throw new Error('Порт не выбран.');
      }
      await port.open({ baudRate });
      const readable = port.readable;
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
    } catch (error: unknown) {
      this.isConnected = false;
      this.port = null;
      this.reader = null;
      this.readableStream = null;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Ошибка подключения к порту: ${message}`);
    }
  }

  public async readChunk(): Promise<Uint8Array | null> {
    const reader = this.reader;
    if (!this.isConnected || !reader) return null;
    try {
      const { value, done } = await reader.read();
      if (done) {
        this.release();
        return null;
      }
      return value ?? null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Serial] Ошибка критического чтения из порта:', message);
      this.release();
      throw error;
    }
  }

  public async write(data: Uint8Array): Promise<void> {
    const port = this.port;
    if (!this.isConnected || !port || !port.writable) return;
    const writer = port.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  public release(): void {
    const wasConnected = this.isConnected;
    this.isConnected = false;
    const reader = this.reader;
    if (reader) {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
    this.reader = null;
    this.readableStream = null;
    this.port = null;
    if (wasConnected && this.onDisconnectCallback) {
      this.onDisconnectCallback();
    }
  }
}