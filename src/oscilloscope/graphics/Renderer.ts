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

        // Используем замороженное время из настроек, а не Date.now()
        const now = this.settings.getCurrentViewTime();
        const spacing = 40 * this.settings.timeScale;
        const duration = (width / spacing) * 1000;

        this.renderGrid(view, width, height);
        this.renderMarkers(view, width, height, now, spacing);

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

        if (this.settings.enableCursors) {
            this.renderCursors(view, width, height);
        } else {
            view.cursorGraphics.clear();
        }

        view.present();
    }

    private renderGrid(view: PixiView, width: number, height: number): void {
        view.gridGraphics.clear();
    }

    private renderCursors(view: PixiView, width: number, height: number): void {
        const g = view.cursorGraphics;
        g.clear();

        const x1 = (this.settings.cursorX1Percent / 100) * width;
        const x2 = (this.settings.cursorX2Percent / 100) * width;

        g.moveTo(x1, 0);
        g.lineTo(x1, height);
        g.stroke({ width: 1.5, color: 0x06b6d4, alpha: 0.9 });

        g.moveTo(x2, 0);
        g.lineTo(x2, height);
        g.stroke({ width: 1.5, color: 0xf59e0b, alpha: 0.9 });
    }

    private renderMarkers(view: PixiView, width: number, height: number, now: number, spacing: number): void {
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
    }
}
