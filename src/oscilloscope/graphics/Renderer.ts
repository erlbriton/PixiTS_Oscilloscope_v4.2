// src/oscilloscope/graphics/Renderer.ts

import { Channel } from '../core/Channel';
import { Archive } from '../core/Archive';
import { Settings } from '../config/Settings';
import { PixiView } from './PixiView';
import { WaveformRenderer } from './WaveformRenderer';

export class Renderer {
    private settings: Settings;
    private archive: Archive;

    constructor(settings: Settings, archive: Archive) {
        this.settings = settings;
        this.archive = archive;
    }

    public renderChannelGraph(channel: Channel, view: PixiView): void {
        const { width, height } = view.bounds;
        if (width <= 0 || height <= 0) return;

        const now = this.settings.getCurrentViewTime();
        const spacing = 40 * this.settings.timeScale;
        const duration = (width / spacing) * 1000;

        this.renderGrid(view, width, height);
        this.renderMarkers(view, width, height, now, spacing, duration);

        const samples = this.archive.getRecentSamples(channel.id, duration, now);

        if (samples.length > 0) {
            if (channel.type === 'digital') {
                WaveformRenderer.renderDigitalWaveform(channel, samples, view, width, height, now, duration);
            } else {
                WaveformRenderer.renderAnalogWaveform(channel, samples, view, width, height, now, duration, this.settings, this.archive);
            }
        } else {
            view.waveGraphics.clear();
        }

        view.present();
    }

    private renderGrid(view: PixiView, width: number, height: number): void {
        view.gridGraphics.clear();
    }

    private renderMarkers(view: PixiView, width: number, height: number, now: number, spacing: number, duration: number): void {
        const g = view.markerGraphics;
        g.clear();

        const secPx = (now / 1000) * spacing;
        const offset = (spacing - (secPx % spacing)) % spacing;

        for (let x = offset; x <= width; x += spacing) {
            if (x >= 0) {
                const roundedX = Math.round(x);
                g.moveTo(roundedX, 0);
                g.lineTo(roundedX, height);
                g.stroke({ width: 1, color: '#94a3b8', alpha: 0.5 });
            }
        }

        const startTime = now - duration;

        if (this.settings.isAmplitudeMode && this.settings.amplitudeMarkerTime !== null) {
            const markerTime = this.settings.amplitudeMarkerTime;
            if (markerTime >= startTime && markerTime <= now) {
                const x = ((markerTime - startTime) / duration) * width;
                const roundedX = Math.round(x);
                g.moveTo(roundedX, 0);
                g.lineTo(roundedX, height);
                g.stroke({ width: 2, color: '#ffffff', alpha: 0.9 });
            }
        }

        if (this.settings.isIntervalMode) {
            if (this.settings.intervalMarker1Time !== null) {
                const marker1Time = this.settings.intervalMarker1Time;
                if (marker1Time >= startTime && marker1Time <= now) {
                    const x1 = ((marker1Time - startTime) / duration) * width;
                    const roundedX1 = Math.round(x1);
                    g.moveTo(roundedX1, 0);
                    g.lineTo(roundedX1, height);
                    g.stroke({ width: 2, color: '#dc2626', alpha: 1.0 });
                }
            }

            if (this.settings.intervalMarker2Time !== null) {
                const marker2Time = this.settings.intervalMarker2Time;
                if (marker2Time >= startTime && marker2Time <= now) {
                    const x2 = ((marker2Time - startTime) / duration) * width;
                    const roundedX2 = Math.round(x2);
                    g.moveTo(roundedX2, 0);
                    g.lineTo(roundedX2, height);
                    g.stroke({ width: 2, color: '#dc2626', alpha: 1.0 });
                }
            }
        }
    }
}