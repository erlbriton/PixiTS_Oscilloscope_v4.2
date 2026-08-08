// src/graphics/WaveformRenderer.ts
import { Channel } from '../core/Channel';
import { Archive, Sample } from '../core/Archive';
import { Settings } from '../config/Settings';
import { PixiView } from './PixiView';

export class WaveformRenderer {
    public static renderAnalogWaveform(
        channel: Channel,
        samples: Sample[],
        view: PixiView,
        width: number,
        height: number,
        currentTime: number,
        duration: number,
        settings: Settings,
        archive: Archive
    ): void {
        const g = view.waveGraphics;
        g.clear();

        if (samples.length < 1) return;

                let min = channel.min;
        let max = channel.autoScale ? channel.max : channel.customMax;

        if (channel.autoScale) {
            const range = archive.getMinMax(channel.id, duration, currentTime);
            if (range.min !== range.max) {
                const margin = (range.max - range.min) * 0.1 || 1;
                const targetMin = range.min - margin;
                const targetMax = range.max + margin;

                // Плавное приближение отображаемого диапазона к целевому.
                // Читаем в локальные переменные: так TypeScript корректно
                // сужает тип (number | undefined), и ошибки ts(18048)/ts(2322) исчезают.
                const prevMin = channel.currentDisplayMin;
                const prevMax = channel.currentDisplayMax;

                if (prevMin === undefined || prevMax === undefined || isNaN(prevMin) || isNaN(prevMax)) {
                    channel.currentDisplayMin = targetMin;
                    channel.currentDisplayMax = targetMax;
                } else {
                    channel.currentDisplayMin = prevMin + (targetMin - prevMin) * 0.1;
                    channel.currentDisplayMax = prevMax + (targetMax - prevMax) * 0.1;
                }

                // Гарантируем number: если по какой-то причине undefined — берём целевое значение.
                min = channel.currentDisplayMin ?? targetMin;
                max = channel.currentDisplayMax ?? targetMax;
            }
        } else {
            channel.currentDisplayMin = undefined;
            channel.currentDisplayMax = undefined;
        }

        const vRange = max - min || 1;
        const startTime = currentTime - duration;
        const waveColor = channel.color;
        const getX = (t: number) => ((t - startTime) / duration) * width;
        const getY = (val: number) => {
            const y = height - ((val - min) / vRange) * height;
            return Math.max(0, Math.min(height, y));
        };

        const startX = getX(samples[0].time);
        const startY = getY(samples[0].value);
        g.moveTo(Math.max(0, Math.min(width, startX)), startY);

        if (startX > 0) {
            g.moveTo(0, startY);
            g.lineTo(startX, startY);
        }

        for (let i = 1; i < samples.length; i++) {
            const x = getX(samples[i].time);
            const y = getY(samples[i].value);
            g.lineTo(x, y);
        }

        const lastSample = samples[samples.length - 1];
        const lastX = getX(lastSample.time);
        if (lastX < width) {
            const lastY = getY(lastSample.value);
            g.lineTo(width, lastY);
        }

        g.stroke({ width: 2, color: waveColor, alpha: 0.95 });
    }

    public static renderDigitalWaveform(
        channel: Channel,
        samples: Sample[],
        view: PixiView,
        width: number,
        height: number,
        currentTime: number,
        duration: number
    ): void {
        const g = view.waveGraphics;
        g.clear();

        if (samples.length < 1) return;

        const startTime = currentTime - duration;
        const waveColor = channel.color;
        const getX = (t: number) => ((t - startTime) / duration) * width;

        const margin = 2; 
        const barHeight = height - (margin * 2);
        const lineY = height - margin - 1;

        let lastValue = samples[0].value;
        let segmentStartX = Math.max(0, getX(samples[0].time));

        for (let i = 1; i <= samples.length; i++) {
            const currentT = i < samples.length ? samples[i].time : currentTime;
            const currentValue = i < samples.length ? samples[i].value : lastValue;
            const currentX = getX(currentT);

            if (currentValue !== lastValue || i === samples.length) {
                const endX = Math.min(width, currentX);
                if (endX > segmentStartX) {
                    if (lastValue >= 0.5) {
                        g.rect(segmentStartX, margin, endX - segmentStartX, barHeight);
                    }
                }
                segmentStartX = Math.max(0, currentX);
                lastValue = currentValue;
            }
        }

        g.fill({ color: waveColor, alpha: 0.7 });

        lastValue = samples[0].value;
        segmentStartX = Math.max(0, getX(samples[0].time));

        for (let i = 1; i <= samples.length; i++) {
            const currentT = i < samples.length ? samples[i].time : currentTime;
            const currentValue = i < samples.length ? samples[i].value : lastValue;
            const currentX = getX(currentT);

            if (currentValue !== lastValue || i === samples.length) {
                const endX = Math.min(width, currentX);
                if (endX > segmentStartX) {
                    if (lastValue < 0.5) {
                        g.moveTo(segmentStartX, lineY);
                        g.lineTo(endX, lineY);
                    }
                }
                segmentStartX = Math.max(0, currentX);
                lastValue = currentValue;
            }
        }

        g.stroke({ width: 2, color: waveColor, alpha: 0.9 });
    }
}