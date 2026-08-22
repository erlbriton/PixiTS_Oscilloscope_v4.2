// src/graphics/PixiView.ts

export interface ViewportBounds {//////////////////////
    width: number;
    height: number;
}

export interface StrokeOptions {
    width?: number;
    color?: number | string;
    alpha?: number;
}

export class Canvas2DGraphics {//////////////////////////////////\
    private paths: Array<{
        commands: Array<{ 
            type: 'moveTo' | 'lineTo' | 'rect'; 
            x: number; y: number; 
            width?: number; height?: number; 
        }>;
        width: number;
        color: number | string;
        alpha: number;
        fill?: boolean;
    }> = [];

    private currentCommands: Array<{ 
        type: 'moveTo' | 'lineTo' | 'rect'; 
        x: number; y: number; 
        width?: number; height?: number; 
    }> = [];

    public clear(): void {
        this.paths = [];
        this.currentCommands = [];
    }

    public moveTo(x: number, y: number): void {
        this.currentCommands.push({ type: 'moveTo', x, y });
    }

    public lineTo(x: number, y: number): void {
        this.currentCommands.push({ type: 'lineTo', x, y });
    }

    public rect(x: number, y: number, width: number, height: number): void {
        this.currentCommands.push({ type: 'rect', x, y, width, height });
    }

    public stroke(options?: StrokeOptions): void {
        if (this.currentCommands.length === 0) return;
        const width = options?.width ?? 1;
        const alpha = options?.alpha ?? 1.0;
        const color = options?.color ?? '#38bdf8';

        this.paths.push({
            commands: [...this.currentCommands],
            width,
            color,
            alpha,
            fill: false
        });
        this.currentCommands = [];
    }

    public fill(options?: StrokeOptions): void {
        if (this.currentCommands.length === 0) return;
        const width = options?.width ?? 1;
        const alpha = options?.alpha ?? 1.0;
        const color = options?.color ?? '#38bdf8';

        this.paths.push({
            commands: [...this.currentCommands],
            width,
            color,
            alpha,
            fill: true
        });
        this.currentCommands = [];
    }

    public drawToContext(ctx: CanvasRenderingContext2D): void {
        for (const path of this.paths) {
            if (path.commands.length === 0) continue;
            ctx.save();
            
            let colorStr = '#38bdf8';
            if (typeof path.color === 'number') {
                const hex = path.color.toString(16).padStart(6, '0');
                const r = parseInt(hex.slice(0, 2), 16);
                const g = parseInt(hex.slice(2, 4), 16);
                const b = parseInt(hex.slice(4, 6), 16);
                colorStr = `rgba(${r}, ${g}, ${b}, ${path.alpha})`;
            } else {
                colorStr = path.color;
                ctx.globalAlpha = path.alpha;
            }

            if (path.fill) {
                ctx.fillStyle = colorStr;
                for (const cmd of path.commands) {
                    if (cmd.type === 'rect') {
                        ctx.fillRect(cmd.x, cmd.y, cmd.width || 0, cmd.height || 0);
                    }
                }
            } else {
                ctx.lineWidth = path.width;
                ctx.strokeStyle = colorStr;
                ctx.beginPath();

                for (const cmd of path.commands) {
                    if (cmd.type === 'moveTo') {
                        ctx.moveTo(cmd.x, cmd.y);
                    } else if (cmd.type === 'lineTo') {
                        ctx.lineTo(cmd.x, cmd.y);
                    } else if (cmd.type === 'rect') {
                        ctx.rect(cmd.x, cmd.y, cmd.width || 0, cmd.height || 0);
                    }
                }
                ctx.stroke();
            }
            ctx.restore();
        }
    }
}///////////////////////////\

export class PixiView {
    public canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D | null = null;
    public gridGraphics: Canvas2DGraphics;
    public waveGraphics: Canvas2DGraphics;
    public markerGraphics: Canvas2DGraphics;
    public cursorGraphics: Canvas2DGraphics;
    public containerElement: HTMLElement;
    public bounds: ViewportBounds = { width: 300, height: 120 };
    private resizeObserver: ResizeObserver | null = null;

    constructor(containerElement: HTMLElement) {
        this.containerElement = containerElement;
        this.canvas = document.createElement('canvas');
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.display = 'block';

        this.gridGraphics = new Canvas2DGraphics();
        this.waveGraphics = new Canvas2DGraphics();
        this.markerGraphics = new Canvas2DGraphics();
        this.cursorGraphics = new Canvas2DGraphics();
    }

    public async init(): Promise<void> {
        this.containerElement.innerHTML = '';
        this.containerElement.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        const rect = this.containerElement.getBoundingClientRect();
        const width = Math.max(50, Math.floor(rect.width || 400));
        const height = Math.max(10, Math.floor(rect.height || 20));
        this.resize(width, height);

        this.resizeObserver = new ResizeObserver((entries) => {
            for (let entry of entries) {
                const w = Math.max(50, Math.floor(entry.contentRect.width));
                const h = Math.max(10, Math.floor(entry.contentRect.height));
                if (w !== this.bounds.width || h !== this.bounds.height) {
                    this.resize(w, h);
                }
            }
        });
        this.resizeObserver.observe(this.containerElement);
    }

    public resize(width: number, height: number): void {
        this.bounds = { width, height };
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.floor(width * dpr);
        this.canvas.height = Math.floor(height * dpr);
    }

    public present(): void {
        if (!this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        this.ctx.save();
        this.ctx.scale(dpr, dpr);

        this.ctx.clearRect(0, 0, this.bounds.width, this.bounds.height);

        this.gridGraphics.drawToContext(this.ctx);
        this.waveGraphics.drawToContext(this.ctx);
        this.markerGraphics.drawToContext(this.ctx);
        this.cursorGraphics.drawToContext(this.ctx);

        this.ctx.restore();
    }

    // src/graphics/PixiView.ts

import { Container, Graphics, Application } from 'pixi.js';

export interface ViewportBounds {
    width: number;
    height: number;
}

export interface StrokeOptions {
    width?: number;
    color?: number | string;
    alpha?: number;
}

export class PixiView {
    public container: Container;
    public gridGraphics: Graphics;
    public waveGraphics: Graphics;
    public markerGraphics: Graphics;
    public cursorGraphics: Graphics;
    public containerElement: HTMLElement;
    public bounds: ViewportBounds = { width: 300, height: 120 };
    private resizeObserver: ResizeObserver | null = null;
    private app: Application;

    constructor(containerElement: HTMLElement, app: Application) {
        this.containerElement = containerElement;
        this.app = app;

        this.container = new Container();

        this.gridGraphics = new Graphics();
        this.waveGraphics = new Graphics();
        this.markerGraphics = new Graphics();
        this.cursorGraphics = new Graphics();

        this.container.addChild(this.gridGraphics);
        this.container.addChild(this.waveGraphics);
        this.container.addChild(this.markerGraphics);
        this.container.addChild(this.cursorGraphics);

        this.app.stage.addChild(this.container);
    }

    public async init(): Promise<void> {
        this.containerElement.innerHTML = '';
        this.containerElement.appendChild(this.app.canvas);

        const rect = this.containerElement.getBoundingClientRect();
        const width = Math.max(50, Math.floor(rect.width || 400));
        const height = Math.max(10, Math.floor(rect.height || 20));
        this.resize(width, height);

        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = Math.max(50, Math.floor(entry.contentRect.width));
                const h = Math.max(10, Math.floor(entry.contentRect.height));
                if (w !== this.bounds.width || h !== this.bounds.height) {
                    this.resize(w, h);
                }
            }
        });
        this.resizeObserver.observe(this.containerElement);
    }

    public resize(width: number, height: number): void {
        this.bounds = { width, height };
        this.container.x = 0;
        this.container.y = 0;
    }

    public present(): void {
        // PixiJS рендерит автоматически
    }

    public destroy(): void {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        this.gridGraphics.destroy();
        this.waveGraphics.destroy();
        this.markerGraphics.destroy();
        this.cursorGraphics.destroy();

        this.container.destroy({ children: true });

        this.containerElement.innerHTML = '';
    }
}
