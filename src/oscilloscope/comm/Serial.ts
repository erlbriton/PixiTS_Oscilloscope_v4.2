// src/comm/Serial.ts

import { Channel } from '../core/Channel';
import { Archive } from '../core/Archive';
import { Modbus } from './Modbus';

export type SerialState = 'disconnected' | 'connecting' | 'connected' | 'error';

export class Serial {
    private state: SerialState = 'disconnected';
    private port: any = null;
    private reader: any = null;
    private baudRate: number = 115200;
    private archive: Archive;
    private channels: Channel[] = [];
    private frameChannels: Channel[] = [];
    private stateChangeCallbacks: ((state: SerialState, msg?: string) => void)[] = [];
    private frameSizeDetectedCallbacks: ((size: number) => void)[] = [];
    private rxBuffer: number[] = [];
    private asciiTextBuffer: string = '';
    private pollIntervalId: number | null = null;
    private lastResponseTime: number = 0;
    private hasReceivedData: boolean = false;
    private readonly TIMEOUT_MS: number = 2000;

    constructor(archive: Archive) {
        this.archive = archive;
    }

    public setChannels(channels: Channel[]): void {
        this.channels = channels;
        this.resetCommunication();
    }

    public setFrameChannels(channels: Channel[]): void {
        this.frameChannels = channels;
        this.resetCommunication();
    }

    public resetCommunication(): void {
        this.asciiTextBuffer = '';
        this.rxBuffer = [];
        this.hasReceivedData = false;
        this.lastResponseTime = Date.now();
        console.log(`[Serial] Communication reset. Channels: ${this.channels.length}, FrameChannels: ${this.frameChannels.length}`);
    }

    public getFrameChannels(): Channel[] {
        return this.frameChannels;
    }

    public onStateChange(cb: (state: SerialState, msg?: string) => void): void {
        this.stateChangeCallbacks.push(cb);
    }

    public onFrameSizeDetected(cb: (size: number) => void): void {
        this.frameSizeDetectedCallbacks.push(cb);
    }

    private setState(state: SerialState, msg?: string): void {
        this.state = state;
        this.stateChangeCallbacks.forEach(cb => cb(state, msg));
    }

    public getState(): SerialState {
        return this.state;
    }

    public isWebSerialSupported(): boolean {
        return 'serial' in navigator;
    }

    /**
     * Attaches an externally opened SerialPort to the oscilloscope.
     * @param externalPort The SerialPort object from navigator.serial (must be open)
     */
    public async attachPort(externalPort: any): Promise<void> {
        this.port = externalPort;
        this.setState('connected', 'External COM-port attached');
        this.lastResponseTime = Date.now();
        this.hasReceivedData = false;
        
        // If the port is not open, we should try to open it if requested, 
        // but typically the main project should open it.
        // We'll assume it's either open or we need to start the reader loop.
        
        this.startReading();
        this.startModbusPolling();
    }

    public async connect(baudRate: number = 115200): Promise<boolean> {
        this.baudRate = baudRate;
        if (!this.isWebSerialSupported()) {
            this.setState('disconnected', 'Web Serial API не поддерживается вашим браузером.');
            return false;
        }

        try {
            this.setState('connecting', 'Выбор COM-порта в системе...');
            const navSerial = (navigator as any).serial;
            this.port = await navSerial.requestPort();
            await this.port.open({ baudRate: this.baudRate });

            this.setState('connected', `Подключено к COM-порту @ ${this.baudRate} baud`);
            this.lastResponseTime = Date.now();
            this.hasReceivedData = false;
            this.startReading();
            this.startModbusPolling();
            return true;
        } catch (err: any) {
            const errMsg = err.message || 'Отменено пользователем';
            this.setState('disconnected', `COM-порт не подключен (${errMsg}).`);
            return false;
        }
    }

    public async disconnect(): Promise<void> {
        this.stopModbusPolling();
        try {
            if (this.reader) {
                await this.reader.cancel();
                this.reader.releaseLock();
                this.reader = null;
            }
            if (this.port) {
                await this.port.close();
                this.port = null;
            }
        } catch (e) {
            console.error('Error closing serial port:', e);
        }
        this.setState('disconnected', 'Serial port disconnected.');
        this.hasReceivedData = false;
    }

    private startModbusPolling(): void {
        this.stopModbusPolling();
        // Send Modbus FC 0x03 poll request every 100ms
        this.pollIntervalId = window.setInterval(() => {
            if (this.state === 'connected') {
                if (this.hasReceivedData && (Date.now() - this.lastResponseTime > this.TIMEOUT_MS)) {
                    this.setState('error', 'Связь потеряна: тайм-аут ответа от устройства.');
                    this.disconnect();
                    return;
                }

                if (this.channels.length > 0) {
                    this.sendModbus03Request();
                }
            }
        }, 100);
    }

    private stopModbusPolling(): void {
        if (this.pollIntervalId !== null) {
            clearInterval(this.pollIntervalId);
            this.pollIntervalId = null;
        }
    }

    private lastPollStartAddr: number = 0;

    private async sendModbus03Request(slaveAddr: number = 1): Promise<void> {
        if (!this.port || !this.port.writable || this.state !== 'connected') return;

        const addrs: number[] = [];
        this.channels.forEach(ch => {
            if (ch.modbusReg) {
                const match = ch.modbusReg.match(/r([0-9a-fA-F]+)/i);
                if (match) {
                    const regIdx = parseInt(match[1], 16);
                    addrs.push(regIdx);
                    const typeUpper = (ch.dataType || '').toUpperCase();
                    const is32Bit = typeUpper === 'TFLOAT' || typeUpper === 'TFLOAT32' || typeUpper === 'FLOAT' ||
                                    typeUpper === 'TDWORD' || typeUpper === 'TLONG' || typeUpper === 'TINT32';
                    if (is32Bit) addrs.push(regIdx + 1);
                }
            }
        });

        if (addrs.length === 0) return;

        const minAddr = Math.min(...addrs);
        const maxAddr = Math.max(...addrs);
        const count = Math.min(125, maxAddr - minAddr + 1);
        this.lastPollStartAddr = minAddr;

        try {
            const writer = this.port.writable.getWriter();
            const frame = Modbus.createReadRequest(slaveAddr, 0x03, minAddr, count);
            await writer.write(frame);
            writer.releaseLock();
        } catch (err) {
            console.error('Failed to send Modbus 0x03 request frame:', err);
        }
    }

    private async startReading(): Promise<void> {
        if (!this.port || !this.port.readable) return;
        try {
            while (this.port.readable && this.state === 'connected') {
                this.reader = this.port.readable.getReader();
                
                try {
                    while (true) {
                        const { value, done } = await this.reader.read();
                        if (done) break;
                        if (value) this.processIncomingBytes(value);
                    }
                } catch (readErr) {
                    console.error('Serial stream read error:', readErr);
                } finally {
                    this.reader.releaseLock();
                }
            }
        } catch (err) {
            console.error('Port reading loop failed:', err);
            this.setState('error', 'Serial communication error');
        }
    }

    private processIncomingBytes(data: Uint8Array): void {
        const now = Date.now();
        this.lastResponseTime = now;
        this.hasReceivedData = true;

        // 1. Try ASCII Frame Parsing
        const textChunk = new TextDecoder().decode(data);
        this.asciiTextBuffer += textChunk;
        if (this.asciiTextBuffer.length > 5000) this.asciiTextBuffer = this.asciiTextBuffer.slice(-2500);

        if (this.asciiTextBuffer.includes('\n')) {
            const lines = this.asciiTextBuffer.split('\n');
            this.asciiTextBuffer = lines.pop() || '';
            const targetChannels = this.frameChannels.length > 0 ? this.frameChannels : this.channels;
            
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                const matches = trimmedLine.match(/-?\d+(?:\.\d+)?/g);
                if (matches && matches.length > 0) {
                    this.frameSizeDetectedCallbacks.forEach(cb => cb(matches.length));

                    matches.forEach((strVal, idx) => {
                        const val = parseFloat(strVal);
                        if (!isNaN(val) && idx < targetChannels.length) {
                            const ch = targetChannels[idx];
                            ch.updateRawValue(val);
                            this.archive.addSample(ch.id, now, ch.scaledValue);
                        }
                    });
                }
            }
        }

        // 2. Modbus Binary Parsing
        for (let i = 0; i < data.length; i++) this.rxBuffer.push(data[i]);
        if (this.rxBuffer.length > 2048) this.rxBuffer = this.rxBuffer.slice(-1024);

        while (this.rxBuffer.length >= 5) {
            const modbusRes = Modbus.parseReadResponse(new Uint8Array(this.rxBuffer));
            if (modbusRes && (modbusRes.functionCode === 0x03 || modbusRes.functionCode === 0x04)) {
                this.channels.forEach((ch, idx) => {
                    let val: number | undefined;
                    if (ch.modbusReg) {
                        const bitMatch = ch.modbusReg.match(/r([0-9a-fA-F]+)\.([0-9a-fA-F]+)/i);
                        const regMatch = ch.modbusReg.match(/r([0-9a-fA-F]+)/i);
                        if (bitMatch) {
                            const regAddr = parseInt(bitMatch[1], 16);
                            const bitIdx = parseInt(bitMatch[2], 16);
                            const relativeIdx = regAddr - this.lastPollStartAddr;
                            if (relativeIdx >= 0 && relativeIdx < modbusRes.registers.length) {
                                val = (modbusRes.registers[relativeIdx] >>> bitIdx) & 1;
                            }
                        } else if (regMatch) {
                            const regAddr = parseInt(regMatch[1], 16);
                            const relativeIdx = regAddr - this.lastPollStartAddr;
                            const typeUpper = (ch.dataType || '').toUpperCase();

                            if (typeUpper === 'TFLOAT' || typeUpper === 'TFLOAT32' || typeUpper === 'FLOAT' || typeUpper === 'REAL') {
                                if (relativeIdx >= 0 && relativeIdx + 1 < modbusRes.registers.length) {
                                    const w1 = modbusRes.registers[relativeIdx] & 0xFFFF;
                                    const w2 = modbusRes.registers[relativeIdx + 1] & 0xFFFF;
                                    const buf = new ArrayBuffer(4);
                                    const view = new DataView(buf);
                                    view.setUint16(0, w1, false);
                                    view.setUint16(2, w2, false);
                                    const fVal = view.getFloat32(0, false);
                                    val = isNaN(fVal) || !isFinite(fVal) ? 0 : fVal;
                                }
                            } else if (typeUpper === 'TDWORD' || typeUpper === 'TLONG' || typeUpper === 'TINT32') {
                                if (relativeIdx >= 0 && relativeIdx + 1 < modbusRes.registers.length) {
                                    const w1 = modbusRes.registers[relativeIdx] & 0xFFFF;
                                    const w2 = modbusRes.registers[relativeIdx + 1] & 0xFFFF;
                                    val = (w1 << 16) | w2;
                                }
                            } else if (typeUpper === 'TSHORT' || typeUpper === 'TINT16' || typeUpper === 'TINTEGER' || typeUpper === 'INT') {
                                if (relativeIdx >= 0 && relativeIdx < modbusRes.registers.length) {
                                    let s16 = modbusRes.registers[relativeIdx] & 0xFFFF;
                                    if (s16 & 0x8000) s16 -= 0x10000;
                                    val = s16;
                                }
                            } else {
                                if (relativeIdx >= 0 && relativeIdx < modbusRes.registers.length) {
                                    val = modbusRes.registers[relativeIdx] & 0xFFFF;
                                }
                            }
                        }
                    } else if (idx < modbusRes.registers.length) {
                        // Fallback mapping by index if no Modbus register defined
                        val = modbusRes.registers[idx] & 0xFFFF;
                    }

                    if (val !== undefined) {
                        ch.updateRawValue(val);
                        this.archive.addSample(ch.id, now, ch.scaledValue);
                    }
                });
                
                const consumedCount = 3 + (modbusRes.registers.length * 2) + 2;
                this.rxBuffer = this.rxBuffer.slice(consumedCount);
                this.asciiTextBuffer = '';
                continue; 
            }
            
            if (this.rxBuffer.length > 0 && this.rxBuffer[0] !== 1) {
                this.rxBuffer.shift();
            } else if (this.rxBuffer.length > 1024) {
                this.rxBuffer.shift();
            } else {
                break; 
            }
        }
    }
}
