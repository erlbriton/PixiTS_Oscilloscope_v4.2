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

        // 1. Кнопка "Свойства" (габариты 64x32px)
        this.propertiesBtn = ToolbarComponents.createButton(
            `⚙️`,
            'icon-btn osc-btn-properties',
            () => {
                if (this.onOpenPropertiesCallback) this.onOpenPropertiesCallback();
            },
            'Свойства'
        );
        this.propertiesBtn.style.width = '64px';
        this.propertiesBtn.style.height = '32px';

        // 2. Индикатор статуса связи
        this.statusBadge = document.createElement('span');
        this.statusBadge.style.minWidth = '95px';
        this.statusBadge.style.height = '32px';
        this.statusBadge.style.display = 'inline-flex';
        this.statusBadge.style.alignItems = 'center';
        this.statusBadge.style.justifyContent = 'center';
        this.statusBadge.style.padding = '0 8px';
        this.statusBadge.style.fontSize = '13px';
        this.statusBadge.style.fontWeight = 'bold';
        this.statusBadge.style.color = '#0f110b';
        this.statusBadge.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.5)';
        this.statusBadge.style.userSelect = 'none';
        this.statusBadge.style.borderRadius = '4px';

        // 3. Кнопка переключения размера окна (теперь СРАЗУ после статуса, с иконкой)
        this.windowSizeBtn = ToolbarComponents.createButton(
            `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <path d="M9 3v18"/>
                <path d="M15 3v18"/>
            </svg>`,
            'window-toggle-btn',
            () => {
                this.settings.isHalfWindow = !this.settings.isHalfWindow;
                // Меняем иконку: одна панель / две панели
                this.windowSizeBtn.innerHTML = this.settings.isHalfWindow 
                    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <path d="M9 3v18"/>
                    </svg>`
                    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <path d="M9 3v18"/>
                        <path d="M15 3v18"/>
                    </svg>`;
                if (this.onToggleWindowSizeCallback) {
                    this.onToggleWindowSizeCallback(this.settings.isHalfWindow);
                }
            },
            'Переключить ширину окна (50% слева / 100% на весь экран)'
        );
        // Стили кнопки в темном стиле, как в таблице
        this.windowSizeBtn.style.width = '32px';
        this.windowSizeBtn.style.height = '32px';
        this.windowSizeBtn.style.backgroundColor = '#1e293b';
        this.windowSizeBtn.style.color = '#e2e8f0';
        this.windowSizeBtn.style.border = '1px solid #334155';
        this.windowSizeBtn.style.borderTop = '1px solid #475569';
        this.windowSizeBtn.style.borderBottom = '1px solid #0f172a';
        this.windowSizeBtn.style.borderRadius = '4px';
        this.windowSizeBtn.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08)';
        this.windowSizeBtn.style.padding = '0';
        this.windowSizeBtn.style.cursor = 'pointer';
        this.windowSizeBtn.style.display = 'inline-flex';
        this.windowSizeBtn.style.alignItems = 'center';
        this.windowSizeBtn.style.justifyContent = 'center';
        this.windowSizeBtn.style.marginLeft = '4px';
        this.windowSizeBtn.style.transition = 'all 0.1s ease';

        // Эффекты hover/active
        this.windowSizeBtn.addEventListener('mouseenter', () => {
            this.windowSizeBtn.style.background = 'linear-gradient(180deg, #3a4a62 0%, #253348 50%, #1a2436 100%)';
        });
        this.windowSizeBtn.addEventListener('mouseleave', () => {
            this.windowSizeBtn.style.background = 'linear-gradient(180deg, #2d3a4f 0%, #1e293b 50%, #141c2a 100%)';
        });
        this.windowSizeBtn.addEventListener('mousedown', () => {
            this.windowSizeBtn.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.6)';
            this.windowSizeBtn.style.transform = 'translateY(1px)';
        });
        this.windowSizeBtn.addEventListener('mouseup', () => {
            this.windowSizeBtn.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08)';
            this.windowSizeBtn.style.transform = 'translateY(0)';
        });

        // Левая группа элементов: кнопка "Свойства", статус, кнопка размера окна, заголовок
        const groupLeft = document.createElement('div');
        groupLeft.className = 'toolbar-group';

        const title = document.createElement('div');
        title.className = 'toolbar-title';

        // Порядок: Свойства → Статус → Кнопка размера → Заголовок
        groupLeft.append(this.propertiesBtn, this.statusBadge, this.windowSizeBtn, title);

        // По умолчанию при старте устанавливаем состояние "Нет связи"
        this.updateStatus(false);

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

        // Group 3: Export (кнопка размера окна перенесена в groupLeft)
        const groupRight = document.createElement('div');
        groupRight.className = 'toolbar-group';

        this.exportBtn = ToolbarComponents.createButton('💾', '', () => {
            window.dispatchEvent(new CustomEvent('oscilloscope-export-csv'));
        }, 'Экспорт CSV');

        groupRight.append(this.exportBtn);

        this.container.append(groupLeft, groupCenter, groupRight);

        // Подписка на изменение состояния от модуля Serial
        this.serial.onStateChange((state: unknown) => {
            const isConnected = state === 'connected' || state === true;
            this.updateStatus(isConnected);
        });
    }

    /**
     * Обновляет цвет и надпись индикатора состояния связи без всплывающих подсказок.
     * @param isConnected - true, если связь установлена, false — если потеряна
     */
    public updateStatus(isConnected: boolean): void {
        // Убираем всплывающую подсказку, если она была установлена ранее
        this.statusBadge.removeAttribute('title');

        if (isConnected) {
            this.statusBadge.className = 'status-badge connected';
            this.statusBadge.textContent = 'Подключено';
        } else {
            this.statusBadge.className = 'status-badge disconnected';
            this.statusBadge.textContent = 'Нет связи';
        }
    }

    public updateRecordTimer(): void {
        // Оставлен для сохранения интерфейса
    }
}