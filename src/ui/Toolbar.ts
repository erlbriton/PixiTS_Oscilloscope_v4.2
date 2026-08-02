// src/ui/Toolbar.ts

import { Settings } from '../config/Settings';
import { Recorder } from '../core/Recorder';
import { Serial } from '../comm/Serial';
import { ToolbarComponents } from './ToolbarComponents';

export class Toolbar {
    private container: HTMLElement;
    private settings: Settings;
    private recorder: Recorder;
    private serial: Serial;

    private connectBtn!: HTMLButtonElement;
    private autoscaleBtn!: HTMLButtonElement;
    private cursorBtn!: HTMLButtonElement;
    private generatorBtn!: HTMLButtonElement;
    private propertiesBtn!: HTMLButtonElement;
    private exportBtn!: HTMLButtonElement;
    private windowSizeBtn!: HTMLButtonElement;
    private statusBadge!: HTMLSpanElement;

    private onOpenGeneratorModalCallback?: () => void;
    private onOpenWebSerialModalCallback?: () => void;
    private onOpenPropertiesCallback?: () => void;
    private onToggleWindowSizeCallback?: (isHalf: boolean) => void;

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

    public onOpenGeneratorModal(cb: () => void): void {
        this.onOpenGeneratorModalCallback = cb;
    }

    public onOpenWebSerialModal(cb: () => void): void {
        this.onOpenWebSerialModalCallback = cb;
    }

    public onOpenProperties(cb: () => void): void {
        this.onOpenPropertiesCallback = cb;
    }

    public onToggleWindowSize(cb: (isHalf: boolean) => void): void {
        this.onToggleWindowSizeCallback = cb;
    }

    public initialize(): void {
        this.container.innerHTML = '';

        // Group 1: Connection & Brand
        const groupLeft = document.createElement('div');
        groupLeft.className = 'toolbar-group';

        const title = document.createElement('div');
        title.className = 'toolbar-title';
        title.innerHTML = `⚡ PixiTS Oscilloscope v4.1`;

        this.connectBtn = ToolbarComponents.createButton('🔌', 'primary', () => this.handleConnectClick(), 'Подключить Web Serial');

        groupLeft.append(title, this.connectBtn);

        // Group 2: Controls & INI File Selection
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

        this.generatorBtn = ToolbarComponents.createButton('📁', 'primary', () => {
            if (this.onOpenGeneratorModalCallback) this.onOpenGeneratorModalCallback();
        }, 'Выбрать .ini файлы');

        groupCenter.append(this.autoscaleBtn, this.cursorBtn, this.generatorBtn);

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

        this.propertiesBtn = ToolbarComponents.createButton(
            `⚙️`,
            'icon-btn',
            () => {
                if (this.onOpenPropertiesCallback) this.onOpenPropertiesCallback();
            },
            'Свойства просмотра параметров'
        );

        this.exportBtn = ToolbarComponents.createButton('💾', '', () => {
            window.dispatchEvent(new CustomEvent('oscilloscope-export-csv'));
        }, 'Экспорт CSV');

        this.statusBadge = document.createElement('span');
        this.statusBadge.className = 'status-badge disconnected';
        this.statusBadge.textContent = 'DISCONNECTED';

        groupRight.append(this.windowSizeBtn, this.propertiesBtn, this.exportBtn, this.statusBadge);

        this.container.append(groupLeft, groupCenter, groupRight);

        this.serial.onStateChange((state) => {
            if (state === 'connected') {
                this.statusBadge.className = 'status-badge connected';
                this.statusBadge.textContent = 'SERIAL CONNECTED';
                this.connectBtn.innerHTML = `🔌`;
                this.connectBtn.title = 'Отключить Web Serial';
            } else if (state === 'error') {
                this.statusBadge.className = 'status-badge disconnected';
                this.statusBadge.textContent = 'ERROR';
                this.connectBtn.innerHTML = `🔌`;
                this.connectBtn.title = 'Подключить Web Serial';
            } else {
                this.statusBadge.className = 'status-badge disconnected';
                this.statusBadge.textContent = 'DISCONNECTED';
                this.connectBtn.innerHTML = `🔌`;
                this.connectBtn.title = 'Подключить Web Serial';
            }
        });
    }

    private async handleConnectClick(): Promise<void> {
        if (this.serial.getState() === 'connected') {
            await this.serial.disconnect();
            return;
        }

        const isIframe = window.self !== window.top;
        if (isIframe && this.onOpenWebSerialModalCallback) {
            this.onOpenWebSerialModalCallback();
            return;
        }

        const baud = 115200;
        const success = await this.serial.connect(baud);
        if (!success && this.onOpenWebSerialModalCallback) {
            this.onOpenWebSerialModalCallback();
        }
    }

    public updateRecordTimer(): void {
        if (this.recorder.getState() === 'recording') {
            const sec = (this.recorder.getElapsedMs() / 1000).toFixed(1);
            this.statusBadge.textContent = `REC ${sec}s`;
        }
    }
}
