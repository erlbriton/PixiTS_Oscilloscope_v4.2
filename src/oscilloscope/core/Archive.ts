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

    constructor(capacity: number = 100000) { // 30 минут при 50 Гц
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

        /**
     * Возвращает значение сэмпла, ближайшего по времени к указанному моменту.
     * Бинарный поиск по хронологическому порядку кольцевого буфера — O(log N).
     * Возвращает null, если буфер пуст.
     */
    public getValueAtTime(timeMs: number): number | null {
        if (this.size === 0) return null;

        const startIndex = (this.head - this.size + this.capacity) % this.capacity;

        let lo = 0;
        let hi = this.size - 1;

        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            const midIdx = (startIndex + mid) % this.capacity;
            if (this.timestamps[midIdx] < timeMs) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }

        // lo — индекс первого сэмпла с time >= timeMs
        const idxAfter = (startIndex + lo) % this.capacity;
        const tAfter = this.timestamps[idxAfter];

        // Сравниваем с предыдущим сэмплом и выбираем ближайший по времени
        if (lo > 0) {
            const idxBefore = (startIndex + lo - 1) % this.capacity;
            const tBefore = this.timestamps[idxBefore];
            if (timeMs - tBefore <= tAfter - timeMs) {
                return this.values[idxBefore];
            }
        }

        return this.values[idxAfter];
    }

    /**
     * Возвращает значение ПОСЛЕДНЕГО сэмпла, записанного ДО или в момент timeMs
     * (семантика sample-and-hold для дискретных сигналов).
     * Возвращает null, если буфер пуст или время раньше первого сэмпла.
     */
    public getStepValueAtTime(timeMs: number): number | null {
        if (this.size === 0) return null;

        const startIndex = (this.head - this.size + this.capacity) % this.capacity;

        // Если время раньше первого сэмпла — данных ещё нет
        if (this.timestamps[startIndex] > timeMs) return null;

        let lo = 0;
        let hi = this.size - 1;

        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            const midIdx = (startIndex + mid) % this.capacity;
            if (this.timestamps[midIdx] <= timeMs) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }

        // lo — индекс последнего сэмпла с time <= timeMs
        const idx = (startIndex + lo) % this.capacity;
        return this.values[idx];
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

    constructor(capacityPerChannel: number = 100000) { // 30 минут при 50 Гц
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

        /**
     * Возвращает значение канала, ближайшее по времени к указанному моменту.
     * Возвращает null, если данных по каналу нет.
     */
    public getValueAtTime(channelId: string, timeMs: number): number | null {
        const buffer = this.buffers.get(channelId);
        if (!buffer) return null;
        return buffer.getValueAtTime(timeMs);
    }

    /**
     * Возвращает значение канала по семантике sample-and-hold:
     * последний сэмпл, записанный ДО или в момент timeMs.
     * Возвращает null, если данных по каналу нет.
     */
    public getStepValueAtTime(channelId: string, timeMs: number): number | null {
        const buffer = this.buffers.get(channelId);
        if (!buffer) return null;
        return buffer.getStepValueAtTime(timeMs);
    }

    public getMinMax(channelId: string, durationMs?: number, currentTime?: number): { min: number; max: number } {
        const buffer = this.buffers.get(channelId);
        if (!buffer) return { min: -10, max: 10 };
        return buffer.getMinMax(durationMs, currentTime);
    }

       public clear(): void {
        this.buffers.forEach(b => b.clear());
    }

    /**
     * Возвращает минимальное и максимальное время, доступное во всех буферах
     */
    public getTimeRange(): { min: number; max: number } {
        let min = Infinity;
        let max = -Infinity;
        let hasData = false;

        this.buffers.forEach(buffer => {
            if (buffer.size > 0) {
                hasData = true;
                const startIndex = (buffer.head - buffer.size + buffer.capacity) % buffer.capacity;
                const firstTime = buffer.timestamps[startIndex];
                const lastIdx = (buffer.head - 1 + buffer.capacity) % buffer.capacity;
                const lastTime = buffer.timestamps[lastIdx];

                if (firstTime < min) min = firstTime;
                if (lastTime > max) max = lastTime;
            }
        });

        if (!hasData) {
            const now = Date.now();
            return { min: now, max: now };
        }

        return { min, max };
    }
}
