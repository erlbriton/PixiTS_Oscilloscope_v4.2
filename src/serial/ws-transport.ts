// src/serial/ws-transport.ts

import type { ISerialPort, SerialPortInfo } from './ISerialPort.js';

/**
 * WebSocket-реализация ISerialPort для связи с платой через сеть.
 * Одно WS-сообщение = один кадр Modbus RTU (с CRC).
 */
export class WebSocketConnection implements ISerialPort {
  private ws: WebSocket | null = null;
  public isConnected: boolean = false;
  private onDisconnectCallback?: () => void;
  private readQueue: Uint8Array[] = [];
  private readResolvers: ((chunk: Uint8Array | null) => void)[] = [];

  constructor(private ip: string = '192.168.1.234') {}

  public async connect(baudRate?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`ws://${this.ip}:8080`);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          console.log('[WebSocket] Соединение открыто');
          this.isConnected = true;
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          const data = new Uint8Array(event.data as ArrayBuffer);
          console.log('[WebSocket] RX:', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
          if (this.readResolvers.length > 0) {
            const resolver = this.readResolvers.shift()!;
            resolver(data);
          } else {
            this.readQueue.push(data);
          }
        };

        this.ws.onclose = () => {
          console.log('[WebSocket] Соединение закрыто');
          this.isConnected = false;
          if (this.onDisconnectCallback) {
            this.onDisconnectCallback();
          }
          // Резолвим ожидающие readChunk вызовы с null
          while (this.readResolvers.length > 0) {
            const resolver = this.readResolvers.shift()!;
            resolver(null);
          }
        };

        this.ws.onerror = (error: Event) => {
          console.error('[WebSocket] Ошибка:', error);
          reject(new Error('WebSocket connection failed'));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  public async readChunk(): Promise<Uint8Array | null> {
    if (!this.isConnected) return null;

    if (this.readQueue.length > 0) {
      return this.readQueue.shift()!;
    }

    return new Promise((resolve) => {
      this.readResolvers.push(resolve);
    });
  }

  public async write(data: Uint8Array): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    console.log('[WebSocket] TX:', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
    // Копия поверх чистого ArrayBuffer: WebSocket.send не принимает SharedArrayBuffer
    const buf = new ArrayBuffer(data.byteLength);
    new Uint8Array(buf).set(data);
    this.ws.send(buf);
  }

  public getPortInfo(): SerialPortInfo {
    return {}; // У сетевого устройства нет VID/PID
  }

  public onDisconnect(cb: () => void): void {
    this.onDisconnectCallback = cb;
  }

  public release(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
}