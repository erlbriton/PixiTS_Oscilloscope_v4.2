// src/oscilloscope/ui/Toolbar.ts

import { Settings } from '../config/Settings';
import { Recorder } from '../core/Recorder';
import { Serial } from '../comm/Serial';
import { ToolbarComponents } from './ToolbarComponents';

export class Toolbar {
    private container: HTMLElement;
    private settings: Settings;
    private recorder: Recorder;
    private serial: Serial;

    private autoscaleBtn!: HTMLButtonElement;
    private cursorBtn!: HTMLButtonElement;
    private sweepBtn!: HTMLButtonElement;
    private propertiesBtn!: HTMLButtonElement;
    private exportBtn!: HTMLButtonElement;
    private windowSizeBtn!: HTMLButtonElement;
    private statusBadge!: HTMLSpanElement;
    private onOpenPropertiesCallback?: () => void;
    private onToggleWindowSizeCallback?: (isHalf: boolean) => void;
    private onToggleTimeZoomCallback?: (enabled: boolean) => void;

    constructor(
        container: HTMLElement,
        settings: Settings,
        recorder: Recorder,
        serial: Serial
    ) {
        this.container = container;
        this.settings = settings;
        this.recorder = recorder;
        this.serial = serial;
    }

    public onOpenProperties(cb: () => void): void {
        this.onOpenPropertiesCallback = cb;
    }
    public onToggleWindowSize(cb: (isHalf: boolean) => void): void {
        this.onToggleWindowSizeCallback = cb;
    }
    public onToggleTimeZoom(cb: (enabled: boolean) => void): void {
        this.onToggleTimeZoomCallback = cb;
    }

    public initialize(): void {
        this.container.innerHTML = '';

        // Кнопка "Свойства": инициализация и установка ширины 64px (пропорция 2:1)
        this.propertiesBtn = ToolbarComponents.createButton(
            `⚙️`,
            'icon-btn osc-btn-properties',
            () => {
                if (this.onOpenPropertiesCallback) this.onOpenPropertiesCallback();
            },
            'Свойства'
        );
        this.propertiesBtn.style.width = '64px';

        // Group 1: Brand & Status (Левая группа элементов шапки)
        const groupLeft = document.createElement('div');
        groupLeft.className = 'toolbar-group';

        const title = document.createElement('div');
        title.className = 'toolbar-title';

        this.statusBadge = document.createElement('span');
        this.statusBadge.className = 'status-badge disconnected';
        this.statusBadge.textContent = 'DISCONNECTED';

        // Размещаем кнопку "Свойства" первой в левой группе
        groupLeft.append(this.propertiesBtn, title, this.statusBadge);

        // Group 2: Controls
        const groupCenter = document.createElement('div');
        groupCenter.className = 'toolbar-group';

        this.autoscaleBtn = ToolbarComponents.createButton('📐', this.settings.autoScale ? 'active' : '', () => {
            this.settings.autoScale = !this.settings.autoScale;
            this.autoscaleBtn.classList.toggle('active', this.settings.autoScale);
        }, 'Автомасштабирование (Auto-Scale)');

        this.cursorBtn = ToolbarComponents.createButton('📏', this.settings.enableCursors ? 'active' : '', () => {
            this.settings.enableCursors = !this.settings.enableCursors;
            this.cursorBtn.classList.toggle('active', this.settings.enableCursors);
            const footer = document.getElementById('footer');
            if (footer) footer.style.display = this.settings.enableCursors ? 'flex' : 'none';
        }, 'Курсоры измерения (Cursors)');

        const sweepIcon = `
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 5h18"/>
                <path d="m6 2-3 3 3 3"/>
                <path d="m18 2 3 3-3 3"/>
                <path d="M3 17h2l2-5 3 10 3-8 2 3h6"/>
            </svg>`;
        this.sweepBtn = ToolbarComponents.createButton(sweepIcon, '', () => {
            const enabled = !this.sweepBtn.classList.contains('active');
            this.sweepBtn.classList.toggle('active', enabled);
            if (this.onToggleTimeZoomCallback) {
                this.onToggleTimeZoomCallback(enabled);
            }
        }, 'Развертка: колесо мыши над графиками растягивает / сжимает их по времени');
        this.sweepBtn.style.width = '64px';
        groupCenter.append(this.autoscaleBtn, this.cursorBtn, this.sweepBtn);

        // Group 3: Window Size & Export
        const groupRight = document.createElement('div');
        groupRight.className = 'toolbar-group';

        this.windowSizeBtn = ToolbarComponents.createButton(
            this.settings.isHalfWindow ? '◧ 50%' : '▢ 100%',
            'window-toggle-btn',
            () => {
                this.settings.isHalfWindow = !this.settings.isHalfWindow;
                this.windowSizeBtn.innerHTML = this.settings.isHalfWindow ? '◧ 50%' : '▢ 100%';
                if (this.onToggleWindowSizeCallback) {
                    this.onToggleWindowSizeCallback(this.settings.isHalfWindow);
                }
            },
            'Переключить ширину окна (50% слева / 100% на весь экран)'
        );

        this.exportBtn = ToolbarComponents.createButton('💾', '', () => {
            window.dispatchEvent(new CustomEvent('oscilloscope-export-csv'));
        }, 'Экспорт CSV');

        groupRight.append(this.windowSizeBtn, this.exportBtn);

        this.container.append(groupLeft, groupCenter, groupRight);

        this.serial.onStateChange((state) => {
            if (state === 'connected') {
                this.statusBadge.className = 'status-badge connected';
                this.statusBadge.textContent = 'SERIAL CONNECTED';
            } else if (state === 'error') {
                this.statusBadge.className = 'status-badge disconnected';
                this.statusBadge.textContent = 'ERROR';
            } else {
                this.statusBadge.className = 'status-badge disconnected';
                this.statusBadge.textContent = 'DISCONNECTED';
            }
        });
    }

    public updateRecordTimer(): void {
        if (this.recorder.getState() === 'recording') {
            const sec = (this.recorder.getElapsedMs() / 1000).toFixed(1);
            this.statusBadge.textContent = `REC ${sec}s`;
        }
    }
}