import { Channel } from './core/Channel';
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
        this.propertiesModal = new PropertiesModal();

        this.bindEvents();

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

    // /**
    //  * Переключение активного INI-файла в панели.
    //  */
    // public setActiveIni(id: string): void {///////////////////////////////////////////,,,,,,,,,,,,,,,,,,,,,,,////////
    //     if (this.isDestroyed || !id) return;
    //     if (this.currentIniId === id && this.allChannels.length > 0) return;
    //     this.currentIniId = id;
    //     if (this.iniPanel) {
    //         this.iniPanel.selectFileById(id);
    //     }
    // }//////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    public setActiveIni(id: string, loadContent: boolean = true): void {////////////////////////////////////////////////////
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
}/////////////////////////!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

    public destroy(): void {
        this.isDestroyed = true;
        this.isRunning = false;

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
                this.isRunning = false;
                this.showConnectionError(msg || 'Связь с устройством потеряна.');
            } else if (state === 'connected') {
                const wasRunning = this.isRunning;
                this.isRunning = true;
                this.lastFrameTime = performance.now();
                if (!wasRunning) {
                    this.animFrameId = requestAnimationFrame((t) => this.loop(t));
                }
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
    }

    /**
     * Главная точка входа для загрузки INI-контента.
     * Работает по рабочей модели: просто парсим RAM-параметры и передаём в applyParsedRamParams.
     * Никаких frameParamIds, никаких setFrameChannels.
     */
    private static lastLoadedIniContent: string | null = null;

// public async loadIniContent(iniContent: string): Promise<void> {/////////////////////////////////////////////////////////////////////////
//     if (this.isDestroyed || typeof iniContent !== 'string') return;

//     if (this.allChannels.length > 0 && iniContent === Oscilloscope.lastLoadedIniContent) {
//         console.log('[Oscilloscope] loadIniContent skipped: same content');
//         return;
//     }

//     const parsed = IniParser.parse(iniContent);

//     await this.applyParsedRamParams(parsed?.ramParams ?? []);

//     Oscilloscope.lastLoadedIniContent = iniContent;
// }//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


public async loadIniContent(iniContent: string): Promise<void> {/////////////////////////////////////////////////////////////////////////
    if (this.isDestroyed || typeof iniContent !== 'string') return;

    const lastLoadedIniContent = (this as any)._lastLoadedIniContent as string | null;

    if (this.allChannels.length > 0 && iniContent === lastLoadedIniContent) {
        console.log('[Oscilloscope] loadIniContent skipped: same content');
        return;
    }

    const parsed = IniParser.parse(iniContent);

    await this.applyParsedRamParams(parsed?.ramParams ?? []);

    (this as any)._lastLoadedIniContent = iniContent;
}///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

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
        const curX1 = document.getElementById('cur-x1');
        const curX2 = document.getElementById('cur-x2');
        const curDt = document.getElementById('cur-dt');
        const curFreq = document.getElementById('cur-freq');

        if (curX1 && curX2 && curDt && curFreq) {
            const x1Pct = this.settings.cursorX1Percent;
            const x2Pct = this.settings.cursorX2Percent;
            const dtMs = (Math.abs(x2Pct - x1Pct) / 100) * this.settings.timeWindowMs;
            const freqHz = dtMs > 0 ? (1000 / dtMs).toFixed(2) : '0';

            curX1.textContent = `${x1Pct.toFixed(1)}%`;
            curX2.textContent = `${x2Pct.toFixed(1)}%`;
            curDt.textContent = `${dtMs.toFixed(1)} ms`;
            curFreq.textContent = `${freqHz} Hz`;
        }
    }

    private showConnectionError(message: string): void {
        const existing = document.getElementById('oscilloscope-connection-error-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'oscilloscope-connection-error-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '9999';
        overlay.style.backdropFilter = 'blur(4px)';

        const modal = document.createElement('div');
        modal.className = 'modal-content';
        modal.style.maxWidth = '400px';
        modal.style.padding = '30px';
        modal.style.textAlign = 'center';
        modal.style.border = '1px solid #ff4d4d';
        modal.style.boxShadow = '0 0 20px rgba(255, 77, 77, 0.2)';

        modal.innerHTML = `
            <div style="color: #ff4d4d; font-size: 48px; margin-bottom: 20px;">
                ⚠️
            </div>
            <h2 style="margin-bottom: 15px; color: #fff;">Обрыв связи</h2>
            <p style="color: #ccc; line-height: 1.5; margin-bottom: 25px;">${message}</p>
            <div style="color: #94a3b8; font-size: 13px;">Ожидание переподключения в основном проекте...</div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }
}