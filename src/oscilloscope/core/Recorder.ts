// src/oscilloscope/core/Recorder.ts
import { Archive } from './Archive';
import { Channel } from './Channel';
import type { IFileSaver } from '../../core/platform/fs.js';

export type RecordState = 'idle' | 'recording' | 'paused';
export class Recorder {
    private state: RecordState = 'idle';
    private startTime: number = 0;
    private pauseTime: number = 0;
    private totalPausedDuration: number = 0;
    private archive: Archive;
    private fileSaver: IFileSaver;

    constructor(archive: Archive, fileSaver: IFileSaver) {
        this.archive = archive;
        this.fileSaver = fileSaver;
    }

    public start(): void {
        this.state = 'recording';
        this.startTime = Date.now();
        this.totalPausedDuration = 0;
    }

    public pause(): void {
        if (this.state === 'recording') {
            this.state = 'paused';
            this.pauseTime = Date.now();
        }
    }

    public resume(): void {
        if (this.state === 'paused') {
            this.totalPausedDuration += (Date.now() - this.pauseTime);
            this.state = 'recording';
        }
    }

    public stop(): void {
        this.state = 'idle';
    }

    public getState(): RecordState {
        return this.state;
    }

    public getElapsedMs(): number {
        if (this.state === 'idle') return 0;
        if (this.state === 'paused') {
            return this.pauseTime - this.startTime - this.totalPausedDuration;
        }
        return Date.now() - this.startTime - this.totalPausedDuration;
    }

    public exportCSV(channels: Channel[]): string {
        const lines: string[] = [];

        // Header
        const header = ['Time_ms', ...channels.map(c => `"${c.name} (${c.unit})"` )].join(',');
        lines.push(header);

        if (channels.length === 0) return lines.join('\n');

        // Extract all samples per channel
        const samplesMap = new Map<string, { time: number; value: number }[]>();
        let maxLen = 0;
        channels.forEach(ch => {
            const samples = this.archive.getAllSamples(ch.id);
            samplesMap.set(ch.id, samples);
            if (samples.length > maxLen) maxLen = samples.length;
        });

        // Combine into rows
        const firstChSamples = samplesMap.get(channels[0].id) || [];
        for (let i = 0; i < firstChSamples.length; i++) {
            const rowTime = firstChSamples[i].time;
            const rowValues = channels.map(ch => {
                const sList = samplesMap.get(ch.id) || [];
                const item = sList[i];
                return item !== undefined ? item.value.toFixed(4) : '';
            });
            lines.push([rowTime.toFixed(0), ...rowValues].join(','));
        }

        return lines.join('\n');
    }

    // ИСПРАВЛЕНО: Убрана прямая работа с DOM. Делегировано в IFileSaver.
    public async downloadCSV(channels: Channel[], filename: string = 'oscilloscope_record.csv'): Promise<void> {
        const csvContent = this.exportCSV(channels);
        await this.fileSaver.saveTextFile(filename, csvContent, 'text/csv;charset=utf-8');
    }
}