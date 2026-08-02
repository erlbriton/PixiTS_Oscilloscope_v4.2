// src/core/Archive.ts

export interface Sample {
    time: number; // timestamp in ms
    value: number;
}

export class ChannelRingBuffer {
    public timestamps: Float64Array;
    public values: Float32Array;
    public capacity: number;
    public head: number = 0; // write index
    public size: number = 0; // current count

    constructor(capacity: number = 50000) {
        this.capacity = capacity;
        this.timestamps = new Float64Array(capacity);
        this.values = new Float32Array(capacity);
    }

    public push(time: number, value: number): void {
        this.timestamps[this.head] = time;
        this.values[this.head] = value;
        this.head = (this.head + 1) % this.capacity;
        if (this.size < this.capacity) {
            this.size++;
        }
    }

    public clear(): void {
        this.head = 0;
        this.size = 0;
    }

    /**
     * Gets samples sorted chronologically
     */
    public getRecentSamples(durationMs: number, currentTime?: number): Sample[] {
        if (this.size === 0) return [];

        const now = currentTime !== undefined ? currentTime : this.timestamps[(this.head - 1 + this.capacity) % this.capacity];
        const minTime = now - durationMs;

        const result: Sample[] = [];
        const startIndex = (this.head - this.size + this.capacity) % this.capacity;
        let addedPrevious = false;

        for (let i = 0; i < this.size; i++) {
            const idx = (startIndex + i) % this.capacity;
            const t = this.timestamps[idx];
            if (t >= minTime) {
                if (!addedPrevious) {
                    if (i > 0) {
                        const prevIdx = (startIndex + i - 1 + this.capacity) % this.capacity;
                        result.push({ time: this.timestamps[prevIdx], value: this.values[prevIdx] });
                    }
                    addedPrevious = true;
                }
                result.push({ time: t, value: this.values[idx] });
            }
        }

        if (result.length === 0 && this.size > 0) {
            const lastIdx = (this.head - 1 + this.capacity) % this.capacity;
            result.push({ time: this.timestamps[lastIdx], value: this.values[lastIdx] });
        }

        return result;
    }

    public getAllSamples(): Sample[] {
        if (this.size === 0) return [];
        const result: Sample[] = [];
        const startIndex = (this.head - this.size + this.capacity) % this.capacity;
        for (let i = 0; i < this.size; i++) {
            const idx = (startIndex + i) % this.capacity;
            result.push({ time: this.timestamps[idx], value: this.values[idx] });
        }
        return result;
    }

    public getMinMax(durationMs?: number, currentTime?: number): { min: number; max: number } {
        if (this.size === 0) return { min: -10, max: 10 };

        const now = currentTime !== undefined ? currentTime : this.timestamps[(this.head - 1 + this.capacity) % this.capacity];
        const minTime = durationMs ? now - durationMs : -Infinity;

        let min = Infinity;
        let max = -Infinity;
        let found = false;

        const startIndex = (this.head - this.size + this.capacity) % this.capacity;
        for (let i = 0; i < this.size; i++) {
            const idx = (startIndex + i) % this.capacity;
            const t = this.timestamps[idx];
            if (t >= minTime) {
                const v = this.values[idx];
                if (v < min) min = v;
                if (v > max) max = v;
                found = true;
            }
        }

        if (!found || min === max) {
            return { min: min === Infinity ? -10 : min - 10, max: max === -Infinity ? 10 : max + 10 };
        }

        return { min, max };
    }
}

export class Archive {
    private buffers: Map<string, ChannelRingBuffer> = new Map();
    private capacityPerChannel: number;

    constructor(capacityPerChannel: number = 50000) {
        this.capacityPerChannel = capacityPerChannel;
    }

    public getOrCreateBuffer(channelId: string): ChannelRingBuffer {
        let buffer = this.buffers.get(channelId);
        if (!buffer) {
            buffer = new ChannelRingBuffer(this.capacityPerChannel);
            this.buffers.set(channelId, buffer);
        }
        return buffer;
    }

    public addSample(channelId: string, time: number, value: number): void {
        const buffer = this.getOrCreateBuffer(channelId);
        buffer.push(time, value);
    }

    public getRecentSamples(channelId: string, durationMs: number, currentTime?: number): Sample[] {
        const buffer = this.buffers.get(channelId);
        if (!buffer) return [];
        return buffer.getRecentSamples(durationMs, currentTime);
    }

    public getAllSamples(channelId: string): Sample[] {
        const buffer = this.buffers.get(channelId);
        if (!buffer) return [];
        return buffer.getAllSamples();
    }

    public getMinMax(channelId: string, durationMs?: number, currentTime?: number): { min: number; max: number } {
        const buffer = this.buffers.get(channelId);
        if (!buffer) return { min: -10, max: 10 };
        return buffer.getMinMax(durationMs, currentTime);
    }

    public clear(): void {
        this.buffers.forEach(b => b.clear());
    }
}
