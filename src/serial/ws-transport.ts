// src/serial/ws-transport.ts

import type { ISerialPort, SerialPortInfo } from './ISerialPort.js';

/**
 * WebSocket-реализация ISerialPort для связи с платой через сеть.
 * Одно WS-сообщение = один кадр Modbus RTU (с CRC).
 * Добавлено автоматическое переподключение при обрыве связи.
 */
export class WebSocketConnection implements ISerialPort {
  private ws: WebSocket | null = null;
  public isConnected: boolean = false;
  private onDisconnectCallback?: () => void;
  private readQueue: Uint8Array[] = [];
  private readResolvers: ((chunk: Uint8Array | null) => void)[] = [];
  
  // Настройки переподключения
  private intentionalClose: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS: number = 5;
  private readonly RECONNECT_DELAY: number = 2000; // 2 секунды
  private reconnectTimer: any = null;

  constructor(private ip: string = '127.0.0.1') {}

  public async connect(baudRate?: number): Promise<void> {
    this.intentionalClose = false;
    
    return new Promise((resolve, reject) => {
      try {
        const deviceHost = '192.168.1.234';
        const devicePort = 502;
        this.ws = new WebSocket(`ws://${this.ip}:8080/proxy?host=${deviceHost}&port=${devicePort}`);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          console.log('[WebSocket] Соединение открыто');
          this.isConnected = true;
          this.reconnectAttempts = 0; // Сбрасываем счётчик при успешном подключении
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          const data = new Uint8Array(event.data as ArrayBuffer);
          // console.log('[WebSocket] RX:', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
          if (this.readResolvers.length > 0) {
            const resolver = this.readResolvers.shift()!;
            resolver(data);
          } else {
            this.readQueue.push(data);
          }
        };

        this.ws.onclose = () => {
          console.log('[WebSocket] onclose вызван, intentionalClose:', this.intentionalClose);
          console.log('[WebSocket] Соединение закрыто');
          this.isConnected = false;
          
          // Резолвим ожидающие readChunk вызовы с null
          while (this.readResolvers.length > 0) {
            const resolver = this.readResolvers.shift()!;
            resolver(null);
          }
          
          // Автоматическое переподключение, если закрытие не намеренное
          if (!this.intentionalClose) {
            console.log('[WebSocket] Запуск tryReconnect...');
            this.tryReconnect();
          }
          
          if (this.onDisconnectCallback) {
            this.onDisconnectCallback();
          }
        };

        this.ws.onerror = (error: Event) => {
          console.error('[WebSocket] Ошибка:', error);
          // При ошибке onclose вызовется автоматически, там будет переподключение
          // Если соединение ещё не было открыто (connect() не завершился) - отклоняем промис
          if (!this.isConnected) {
            reject(new Error('WebSocket connection failed'));
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

    private tryReconnect(): void {
    console.log('[WebSocket] tryReconnect вызван. Попытки:', this.reconnectAttempts);
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(`[WebSocket] Достигнут лимит попыток переподключения (${this.MAX_RECONNECT_ATTEMPTS}). Требуется повторное нажатие Connect.`);
      return;
    }

    this.reconnectAttempts++;
    console.log(`[WebSocket] Попытка переподключения ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} через ${this.RECONNECT_DELAY}мс...`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        console.log('[WebSocket] Вызов connect() из tryReconnect...');
        await this.connect();
        console.log('[WebSocket] connect() завершился успешно, dispatch ws:reconnected');
        window.dispatchEvent(new CustomEvent('ws:reconnected'));
      } catch (err) {
        console.error('[WebSocket] Ошибка переподключения:', err);
      }
    }, this.RECONNECT_DELAY);
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
    // console.log('[WebSocket] TX:', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
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
    this.intentionalClose = true; // Помечаем как намеренное закрытие
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
    this.reconnectAttempts = 0;
  }
}