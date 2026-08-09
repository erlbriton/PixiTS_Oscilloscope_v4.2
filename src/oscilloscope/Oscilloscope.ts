// src/oscilloscope/Oscilloscope.ts

import { Channel, ChannelConfig } from './core/Channel';
import { Archive } from './core/Archive';
import { Recorder } from './core/Recorder';
import { Settings } from './config/Settings';
import { Serial } from './comm/Serial';
import { Table } from './ui/Table';
import { Toolbar } from './ui/Toolbar';
import { Resizer } from './ui/Resizer';
import { Layout } from './ui/Layout';
import { IniPanel, IniFileItem } from './ui/IniPanel';
import { Renderer } from './graphics/Renderer';
import { PixiView } from './graphics/PixiView';
import { IniParser, ParsedRamParam } from './core/IniParser';
import { PropertiesModal } from './ui/PropertiesModal';
import { BottomPanels, ReadoutSlot } from './ui/BottomPanels';
import { CursorsFooter } from './ui/CursorsFooter';
import { ConnectionModal } from './ui/ConnectionModal';

export class Oscilloscope {
    private settings: Settings;
    private archive: Archive;
    private recorder: Recorder;
    private serial: Serial;
    private table!: Table;
    private toolbar!: Toolbar;
    private resizer!: Resizer;
    private renderer!: Renderer;
    private iniPanel!: IniPanel;
    private bottomPanels!: BottomPanels;
    private cursorsFooter!: CursorsFooter;
    private connectionModal!: ConnectionModal;
    private connectionLost: boolean = false;
    private rowsContainer!: HTMLElement;
    private splitContainer!: HTMLElement;

    private allChannels: Channel[] = [];
    private visibleChannels: Channel[] = [];
    private pixiViews: Map<string, PixiView> = new Map();
    private isRunning: boolean = false;
    private lastFrameTime: number = 0;
    private propertiesModal!: PropertiesModal;
    private availableIniFiles: IniFileItem[] = [];
    private currentIniId: string | null = null;

    private animFrameId: number | null = null;
    private targetRoot: HTMLElement | null = null;
    private isDestroyed: boolean = false;
    private lastLoadedIniContent: string | null = null;

    constructor() {
        this.settings = new Settings();
        this.archive = new Archive();
        this.serial = new Serial(this.archive);
        this.recorder = new Recorder(this.archive);
        this.renderer = new Renderer(this.settings, this.archive);
    }

    public async initialize(targetContainer?: HTMLElement | string): Promise<void> {
        if (this.targetRoot) return;

        let rootElement: HTMLElement | null = null;
        if (typeof targetContainer === 'string') {
            rootElement = document.querySelector(targetContainer);
        } else if (targetContainer instanceof HTMLElement) {
            rootElement = targetContainer;
        }
        if (!rootElement) {
            rootElement = document.getElementById('root') || document.body;
        }
        this.targetRoot = rootElement;
        this.isDestroyed = false;

        this.settings.applyCSSTemplateVariables();

        const layoutElements = Layout.createSkeleton(rootElement);
        this.splitContainer = layoutElements.splitContainer;

        this.table = new Table(layoutElements.rowsContainer);
        this.toolbar = new Toolbar(layoutElements.toolbarContainer, this.settings, this.recorder, this.serial);
        this.toolbar.initialize();

        this.resizer = new Resizer(this.settings, layoutElements.headerContainer);
        this.resizer.initialize();

        this.iniPanel = new IniPanel(layoutElements.iniPanelContainer);
        this.bottomPanels = new BottomPanels(layoutElements.bottomPanelsContainer);
        this.cursorsFooter = new CursorsFooter(layoutElements.footerContainer);
        this.rowsContainer = layoutElements.rowsContainer;
        this.propertiesModal = new PropertiesModal();
        this.connectionModal = new ConnectionModal();

        this.bindEvents();
        this.bindTimeZoomWheel();
        this.isRunning = true;
        this.lastFrameTime = performance.now();
        this.animFrameId = requestAnimationFrame((t) => this.loop(t));
    }

    /**
     * Мост для получения данных от внешнего проекта.
     */
    public draw(data: Record<string, number>): void {
        if (this.isDestroyed || !data) return;

        const now = Date.now();
        this.allChannels.forEach(ch => {
            if (data[ch.id] !== undefined) {
                const val = data[ch.id];
                if (typeof val === 'number' && Number.isFinite(val)) {
                    ch.updateRawValue(val);
                    this.archive.addSample(ch.id, now, ch.scaledValue);
                }
            }
        });
    }

    /**
     * Инжекция SerialPort, открытого во внешнем проекте.
     */
    public setSerialPort(port: any): void {
        if (this.serial && typeof (this.serial as any).attachPort === 'function') {
            (this.serial as any).attachPort(port);
        }
    }

    /**
     * Установка списка INI-файлов из внешнего проекта.
     */
    public setIniFiles(files: IniFileItem[]): void {
        this.availableIniFiles = Array.isArray(files) ? files : [];
        if (this.iniPanel) {
            this.iniPanel.setExternalFiles(this.availableIniFiles);
        }
    }

    public setActiveIni(id: string, loadContent: boolean = true): void {
        if (this.isDestroyed || !id) return;

        if (this.currentIniId === id && this.allChannels.length > 0 && !loadContent) {
            return;
        }

        this.currentIniId = id;

        if (this.iniPanel) {
            this.iniPanel.selectFileById(id);
        }

        if (loadContent) {
            const file = this.availableIniFiles.find(f => f.id === id);
            if (file && typeof file.content === 'string') {
                void this.loadIniContent(file.content);
            }
        }
    }

    /**
     * Управление состоянием связи (вызывается внешним проектом и Serial).
     *
     * false — графики и маркеры останавливаются, показывается окно «Нет связи».
     * true  — окно скрывается, отрисовка возобновляется.
     */
    public setConnectionStatus(connected: boolean, message?: string): void {
        if (this.isDestroyed) return;

        if (connected) {
            if (!this.connectionLost) return;
            this.connectionLost = false;
            this.connectionModal.close();
            this.isRunning = true;
            this.lastFrameTime = performance.now();
            if (this.animFrameId === null) {
                this.animFrameId = requestAnimationFrame((t) => this.loop(t));
            }
        } else {
            if (this.connectionLost) return;
            this.connectionLost = true;
            this.isRunning = false;
            this.connectionModal.show(message ?? 'Связь с устройством потеряна.');
        }
    }

    public destroy(): void {
        this.isDestroyed = true;
        this.isRunning = false;
        this.connectionModal?.close();

        if (this.animFrameId !== null) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }

        this.pixiViews.forEach(view => {
            try {
                view.destroy();
            } catch (err) {
                console.warn('[Oscilloscope] Failed to destroy PixiView:', err);
            }
        });
        this.pixiViews.clear();

        if (this.targetRoot) {
            this.targetRoot.innerHTML = '';
        }
    }

    private bindEvents(): void {
        this.toolbar.onOpenProperties(() => {
            this.propertiesModal.open(this.allChannels, this.visibleChannels);
        });

        this.toolbar.onToggleWindowSize((isHalf) => {
            if (this.splitContainer) {
                if (isHalf) {
                    this.splitContainer.classList.add('half-window-left');
                    this.splitContainer.classList.remove('full-window');
                } else {
                    this.splitContainer.classList.remove('half-window-left');
                    this.splitContainer.classList.add('full-window');
                }
            }
        });

        this.propertiesModal.onApply((newVisible) => {
            this.updateVisibleChannels(newVisible);
        });

        this.serial.onStateChange((state, msg) => {
            if (state === 'error') {
                this.setConnectionStatus(false, msg || 'Связь с устройством потеряна.');
            } else if (state === 'connected') {
                this.setConnectionStatus(true);
            }
        });

        this.iniPanel.onFileSelect((fileItem: IniFileItem) => {
            if (this.isDestroyed) return;
            this.currentIniId = fileItem.id;
            this.loadIniContent(fileItem.content);
        });

        window.addEventListener('oscilloscope-export-csv', () => {
            this.recorder.downloadCSV(this.visibleChannels);
        });

        this.toolbar.onToggleTimeZoom((enabled) => {
            this.settings.timeZoomEnabled = enabled;
        });
    }

    /**
     * Колесо мыши над областью графиков = горизонтальная развертка.
     * Работает ТОЛЬКО когда включена кнопка «Развертка» в тулбаре.
     * Колесо вверх — растянуть (зум ×), колесо вниз — сжать.
     */
    private bindTimeZoomWheel(): void {
        const rowsContainer = this.rowsContainer;

        rowsContainer.addEventListener('wheel', (e: WheelEvent) => {
            if (!this.settings.timeZoomEnabled) return;

            const target = e.target as HTMLElement;
            if (!target.closest('.col-graph')) return;

            e.preventDefault();
            e.stopPropagation();

            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            this.settings.setTimeScale(this.settings.timeScale * factor);
            this.updateTimeScaleReadout();
        }, { passive: false });

        this.updateTimeScaleReadout();
    }

    /**
     * Отображает текущий процент развертки
     * в крайней правой ячейке нижней панели.
     */
    private updateTimeScaleReadout(): void {
        this.bottomPanels.setReadout(
            ReadoutSlot.TimeScale,
            `${Math.round(this.settings.timeScale * 100)}%`
        );
    }

    /**
     * Главная точка входа для загрузки INI-контента.
     * Защита от повторной загрузки одного и того же контента,
     * чтобы избежать гонок при переключении INI через панель и дерево устройств.
     */
    public async loadIniContent(iniContent: string): Promise<void> {
        if (this.isDestroyed || typeof iniContent !== 'string') return;

        if (this.allChannels.length > 0 && iniContent === this.lastLoadedIniContent) {
            console.log('[Oscilloscope] loadIniContent skipped: same content');
            return;
        }

        const parsed = IniParser.parse(iniContent);

        await this.applyParsedRamParams(parsed?.ramParams ?? []);

        this.lastLoadedIniContent = iniContent;
    }

        /**
     * Применение типизированных конфигураций каналов из единого INI-слоя.
     * Новый путь загрузки: принимает готовые данные, НЕ парсит INI-текст.
     * Осциллограф не знает про INI — только про ChannelConfig.
     */
    // public async applyChannelConfigs(configs: ChannelConfig[]): Promise<void> {
    //     if (this.isDestroyed) return;

    //     const channels = (Array.isArray(configs) ? configs : [])
    //         .filter(c => c && c.id)
    //         .map(c => new Channel(c));

    //     await this.setChannels(channels);
    // }

    /**
 * Применение типизированных конфигураций каналов из единого INI-слоя.
 * Новый путь загрузки: принимает готовые данные, НЕ парсит INI-текст.
 * Осциллограф не знает про INI — только про ChannelConfig.
 */
public async applyChannelConfigs(configs: ChannelConfig[]): Promise<void> {
    if (this.isDestroyed) return;

    const channels = (Array.isArray(configs) ? configs : [])
        .filter(c => c && c.id)
        .map(c => new Channel(c));

    await this.setChannels(channels);
}

    public async applyParsedRamParams(ramParams: ParsedRamParam[]): Promise<void> {
        if (this.isDestroyed) return;

        let bitIndex = 0;
        const safeParams = Array.isArray(ramParams) ? ramParams : [];

        const newChannels = safeParams
            .filter(param => Boolean(param) && param.id != null && String(param.id).length > 0)
            .map(param => {
                let color: string | undefined;
                if (param.isBit) {
                    color = (bitIndex % 2 === 0) ? '#00d2ff' : '#d2a679';
                    bitIndex++;
                }

                return new Channel({
                    id: param.id,
                    name: param.name,
                    description: param.description,
                    dataType: param.type,
                    unit: param.unit,
                    scale: param.scale,
                    rawDecValue: param.rawDec,
                    hexValue: param.rawHex,
                    isBit: param.isBit,
                    modbusReg: param.modbusReg,
                    min: param.isBit ? 0 : -50,
                    max: param.isBit ? 1 : 500,
                    color: color
                });
            });

        await this.setChannels(newChannels);
    }

    /**
     * Простая замена каналов - как в рабочем коде.
     * Никаких setFrameChannels, resetCommunication, auto-switch.
     */
    public async setChannels(newChannels: Channel[]): Promise<void> {
        if (this.isDestroyed) return;

        console.log(`[Oscilloscope] Setting channels: ${newChannels.length}`);

        // Полная замена каналов
        this.allChannels = Array.isArray(newChannels) ? newChannels : [];
        this.visibleChannels = [...this.allChannels];

        // Очистка архива
        try {
            this.archive.clear();
        } catch (err) {
            console.error('[Oscilloscope] Failed to clear archive:', err);
        }

        // Передача новых каналов в Serial - размер опроса будет вычислен автоматически по modbusReg
        try {
            this.serial.setChannels(this.allChannels);
        } catch (err) {
            console.error('[Oscilloscope] Failed to set serial channels:', err);
        }

        // Перерисовка UI и графиков
        await this.renderVisibleChannels();

        console.log(`[Oscilloscope] Switch complete.`);
    }

    public async updateVisibleChannels(newVisibleChannels: Channel[]): Promise<void> {
        if (this.isDestroyed) return;

        const validIds = new Set(this.allChannels.map(ch => ch.id));
        const filtered = Array.isArray(newVisibleChannels)
            ? newVisibleChannels.filter(ch => ch && validIds.has(ch.id))
            : [];

        if (newVisibleChannels.length > 0 && filtered.length === 0 && this.allChannels.length > 0) {
            this.visibleChannels = [...this.allChannels];
        } else {
            this.visibleChannels = filtered;
        }

        await this.renderVisibleChannels();
    }

    private async renderVisibleChannels(): Promise<void> {
        if (this.isDestroyed || !this.table) return;

        // Уничтожаем старые графические представления
        this.pixiViews.forEach(view => {
            try {
                view.destroy();
            } catch (err) {
                console.warn('[Oscilloscope] Failed to destroy old PixiView:', err);
            }
        });
        this.pixiViews.clear();

        const tempPixiViews: Map<string, PixiView> = new Map();
        this.table.clear();

        for (const channel of this.visibleChannels) {
            if (this.isDestroyed) break;

            const row = this.table.addChannel(channel);
            row.onChannelUpdated = () => {
                if (this.settings.enableCursors) this.updateCursorsFooter();
            };
            row.onDelete = (deletedChannel) => {
                this.updateVisibleChannels(this.visibleChannels.filter(c => c.id !== deletedChannel.id));
            };
            row.onSelect = (selectedChannel) => {
                this.bottomPanels.setCommandText(`${selectedChannel.name} = `);
            };

            const container = row.getGraphContainer();
            if (container) {
                const pixiView = new PixiView(container);
                try {
                    await pixiView.init();
                    tempPixiViews.set(channel.id, pixiView);
                } catch (err) {
                    console.warn(`[Oscilloscope] PixiView init failed for channel ${channel.id}:`, err);
                }
            }
        }

        if (!this.isDestroyed) {
            this.pixiViews = tempPixiViews;
        }
    }

    private loop(now: number): void {
        this.animFrameId = null;

        if (this.isDestroyed || !this.isRunning || !this.table) return;

        this.lastFrameTime = now;

        try {
            this.table.updateValues();
            this.toolbar.updateRecordTimer();

            this.visibleChannels.forEach(channel => {
                const row = this.table.getRow(channel.id);
                if (row && !row.getIsVisible()) return;

                const view = this.pixiViews.get(channel.id);
                if (view) {
                    try {
                        this.renderer.renderChannelGraph(channel, view);
                    } catch (renderErr) {
                        console.error(`Error rendering channel ${channel.id}:`, renderErr);
                    }
                }
            });

            if (this.settings.enableCursors) this.updateCursorsFooter();
        } catch (err) {
            console.error('Oscilloscope loop error:', err);
        }

        this.animFrameId = requestAnimationFrame((t) => this.loop(t));
    }

    private updateCursorsFooter(): void {
        this.cursorsFooter.update(
            this.settings.cursorX1Percent,
            this.settings.cursorX2Percent,
            this.settings.timeWindowMs
        );
    }
}