export class ModbusParser {
    private buffer: Uint8Array;

    constructor() {
        this.buffer = new Uint8Array(0);
    }

    public appendData(chunk: Uint8Array): void {
        if (!chunk || chunk.length === 0) return;
        const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
        newBuffer.set(this.buffer, 0);
        newBuffer.set(chunk, this.buffer.length);
        this.buffer = newBuffer;
    }

    public parsePacket(): number[] | null {
        const MIN_PACKET_LENGTH = 5;
        while (this.buffer.length >= MIN_PACKET_LENGTH) {
            if (this.buffer[0] === 0x01 && this.buffer[1] === 0x03) {
                const bytesOfData = this.buffer[2]; 
                const fullPacketLength = 3 + bytesOfData + 2; 
                if (this.buffer.length < fullPacketLength) return null;
                const packet = this.buffer.subarray(0, fullPacketLength);
                const calculatedCrc = this.calculateCRC(packet.subarray(0, fullPacketLength - 2));
                const receivedCrc = (packet[fullPacketLength - 1] << 8) | packet[fullPacketLength - 2];
                if (calculatedCrc === receivedCrc) {
                    const results: number[] = [];
                    for (let i = 0; i < bytesOfData; i += 2) {
                        results.push((packet[3 + i] << 8) | packet[4 + i]);
                    }
                    this.buffer = this.buffer.subarray(fullPacketLength);
                    return results; 
                } else {
                    this.buffer = this.buffer.subarray(1);
                }
            } else {
                this.buffer = this.buffer.subarray(1);
            }
        }
        return null;
    }

    private calculateCRC(buffer: Uint8Array): number {
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
}
