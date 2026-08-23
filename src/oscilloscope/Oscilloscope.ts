// src/oscilloscope/Oscilloscope.ts

import { Channel, ChannelConfig, parseModbusReg } from "./core/Channel.js";
import { Archive } from "./core/Archive";
import { Recorder } from "./core/Recorder";
import { Settings } from "./config/Settings";
import { Serial } from "./comm/Serial";
import { Table } from "./ui/Table";
import { Toolbar } from "./ui/Toolbar";
import { Resizer } from "./ui/Resizer";
import { Layout } from "./ui/Layout";
import { IniPanel, IniFileItem } from "./ui/IniPanel";
import { Renderer } from "./graphics/Renderer";
import { PixiView } from "./graphics/PixiView";
import {
  IniParser as CoreIniParser,
  IniConfig,
  iniParamsToChannelConfigs,
} from "../core/ini/index.js";
import { PropertiesModal } from "./ui/PropertiesModal";
import { BottomPanels, ReadoutSlot } from "./ui/BottomPanels";
import { CursorsFooter } from "./ui/CursorsFooter";
import { ConnectionModal } from "./ui/ConnectionModal";
import { TimelineScrollbar } from "./ui/TimelineScrollbar";
import type { WebSerialPort } from "../serial/web-serial-types.js";
import { BrowserFileSaver } from "../core/platform/browser-fs.js";
import { buildWriteMultipleRegistersRequest } from "../serial/modbus.js";
import { handleCommandSubmit, handleMultiplyCommand, type CommandContext } from "./scope/OscilloscopeCommands";
import { 
  renderVisibleChannels, updateIntervalDisplay, 
  measureChannelAtTime, formatIntervalDuration, 
  syncViewPositions, bindSharedCanvasEvents,
  type RenderingContext } from "./scope/OscilloscopeRenderer";
import { bindEvents, bindTimeZoomWheel, updateTimeScaleReadout, type BindingsContext } from "./scope/OscilloscopeBindings";
import type { AppState } from "../core/app-state.js";
import { Application } from 'pixi.js';
import { SearchPanel } from './ui/SearchPanel';


export class Oscilloscope {/////////////////////////////\
  private settings: Settings;
  private archive: Archive;
  private serial: Serial | null;
  private recorder: Recorder | null;
  private viewerMode: boolean = false;
  private table!: Table;
  private toolbar!: Toolbar;
  private resizer!: Resizer;
  private renderer!: Renderer;
  private iniPanel!: IniPanel;
  private bottomPanels!: BottomPanels;
  private cursorsFooter!: CursorsFooter;
  private searchPanel!: SearchPanel;
  private connectionModal!: ConnectionModal;
  private timelineScrollbar!: TimelineScrollbar;
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
  private lastRenderTime: number = 0;
  private lastRenderSignature: string = "";
  private static readonly RENDER_INTERVAL_MS: number = 20;//  Частота опроса
  private drawCallCount: number = 0;
  private lastReportedHz: number = 0;
  private statsTimerId: number | null = null;
  private targetRoot: HTMLElement | null = null;
  private isDestroyed: boolean = false;
  private lastLoadedIniContent: string | null = null;
  private selectedChannel: Channel | null = null;
  private slaveAddress: number = 1;
  private externalSerial: { write(data: Uint8Array): Promise<void> } | null = null;
  private onPollingStateChangeCallback?: (isPolling: boolean) => void;
  private currentIniConfig: IniConfig | null = null;
  private appState: AppState | null = null;
  private pixiApp: Application | null = null;
  private graphColumnOffset: number = 0;
  private canvasOverlay: HTMLDivElement | null = null;

    constructor(options?: { skipSerial?: boolean; skipRecorder?: boolean; viewerMode?: boolean }) {
    this.settings = new Settings();
    this.archive = new Archive();
    this.viewerMode = options?.viewerMode ?? false;    
    if (options?.skipSerial) {
      this.serial = null;
    } else {
      this.serial = new Serial(this.archive);
    }
    
    if (options?.skipRecorder) {
      this.recorder = null;
    } else {
      this.recorder = new Recorder(this.archive, new BrowserFileSaver());
    }
    
    this.renderer = new Renderer(this.settings, this.archive);
  }

  public setSerialPort(port: unknown): void {
    if (port && typeof (port as { write: unknown }).write === "function") {
      this.externalSerial = port as { write(data: Uint8Array): Promise<void> };
      console.log("[Oscilloscope] External serial port attached.");
    } else {
      this.externalSerial = null;
      console.warn("[Oscilloscope] Invalid serial port object.");
    }
  }

  public setOnPollingStateChange(cb: (isPolling: boolean) => void): void {
    this.onPollingStateChangeCallback = cb;
  }
public setAppState(state: AppState): void {
    this.appState = state;
  }

  public getAppState(): AppState {
    if (!this.appState) {
      throw new Error("[Oscilloscope] AppState is not set. Call setAppState() first.");
    }
    return this.appState;
  }

  public async initialize(
    targetContainer?: HTMLElement | string,
  ): Promise<void> {
    if (this.targetRoot) return;
    let rootElement: HTMLElement | null = null;
    if (typeof targetContainer === "string") {
      rootElement = document.querySelector(targetContainer);
    } else if (targetContainer instanceof HTMLElement) {
      rootElement = targetContainer;
    }
    if (!rootElement) {
      rootElement = document.getElementById("root") || document.body;
    }
    this.targetRoot = rootElement;
    this.isDestroyed = false;
    this.settings.applyCSSTemplateVariables();   
    const layoutElements = Layout.createSkeleton(rootElement);
    this.splitContainer = layoutElements.splitContainer;
    if (this.viewerMode) {
      // В просмотрщике осциллограф всегда на всю ширину
      this.splitContainer.classList.remove("half-window-left");
    }

    this.timelineScrollbar = new TimelineScrollbar(layoutElements.timelineContainer);
    this.timelineScrollbar.onChange((timestamp) => {
      if (this.timelineScrollbar.isAtLivePosition() && this.settings.isPolling) {
        this.settings.followLive();
      } else {
        this.settings.setViewTime(timestamp);
      }
    });
    this.table = new Table(layoutElements.rowsContainer);
    this.toolbar = new Toolbar(
      layoutElements.toolbarContainer,
      this.settings,
      this.recorder,
      this.serial,
    );
    this.toolbar.initialize();
    this.toolbar.setAutoScaleButtonState(true);
    if (this.viewerMode) {
      this.toolbar.applyViewerMode();
      // Принудительно растягиваем осциллограф на всю ширину в просмотрщике
      this.splitContainer.classList.remove("half-window-left");
      this.splitContainer.style.width = "100%";
      const oscRoot = rootElement.firstElementChild as HTMLElement | null;
      if (oscRoot) oscRoot.style.width = "100%";
      // Просмотрщик: отключаем "живой" режим, иначе маркеры плывут
      this.settings.isPolling = false;
    }
    this.resizer = new Resizer(this.settings, layoutElements.headerContainer);
    this.resizer.initialize();
    this.iniPanel = new IniPanel(layoutElements.iniPanelContainer);
    this.bottomPanels = new BottomPanels(layoutElements.bottomPanelsContainer);
    this.cursorsFooter = new CursorsFooter(layoutElements.footerContainer);
    this.statsTimerId = window.setInterval(() => {
      const hz = this.drawCallCount / 5;
      this.lastReportedHz = hz;
      this.drawCallCount = 0;
      this.cursorsFooter?.setStats(this.allChannels.length, hz);
    }, 5000);
    this.rowsContainer = layoutElements.rowsContainer;
    this.propertiesModal = new PropertiesModal();
    this.connectionModal = new ConnectionModal();
    bindEvents(this.getBindingsContext());
    bindTimeZoomWheel(this.getBindingsContext(), this.rowsContainer);
    
    // Создаём единое PixiJS приложение для всего осциллографа
    this.pixiApp = new Application();
    await this.pixiApp.init({
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    
    // Создаём персональную обёртку поверх колонки графиков.
    // Обёртка управляется только нашими инлайн-стилями,
    // а canvas растягивается внутри неё штатным CSS приложения.
    const canvasHost = this.rowsContainer.parentElement as HTMLElement;
    canvasHost.style.position = 'relative';
    this.canvasOverlay = document.createElement('div');
    this.canvasOverlay.style.position = 'absolute';
    this.canvasOverlay.style.overflow = 'hidden';
    this.canvasOverlay.style.zIndex = '5';
    canvasHost.appendChild(this.canvasOverlay);
    this.canvasOverlay.appendChild(this.pixiApp.canvas);
    this.syncCanvasLayout();
    
    // Синхронизируем размер и позицию canvas с rowsContainer
    const resizeObserver = new ResizeObserver(() => {
      this.syncCanvasLayout();
      syncViewPositions(this.getRenderingContext());
    });
    resizeObserver.observe(this.rowsContainer);
    
    // Синхронизируем canvas и контейнеры при скролле из ЛЮБОГО источника:
    // колесо мыши, перетаскивание скроллбара, клавиатура
    this.rowsContainer.addEventListener('scroll', () => {
      this.updateCanvasPosition();
      syncViewPositions(this.getRenderingContext());
    });
    
    // Вычисляем отступ до колонки графиков
    this.updateGraphColumnOffset();
    
    // Навешиваем обработчики мыши на rowsContainer для работы с маркерами
    bindSharedCanvasEvents(() => this.getRenderingContext());
    
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.animFrameId = requestAnimationFrame((t) => this.loop(t));

        this.searchPanel = new SearchPanel();
    this.searchPanel.onSelect = (item) => {
      document.querySelectorAll(".channel-row.selected").forEach((el) => {
        el.classList.remove("selected");
      });
      const row = this.table.getRow(item.id);
      if (row) {
        const rowElement = row.getElement();
        rowElement.classList.add("selected");
        rowElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    window.addEventListener("oscilloscope-search", () => {
      this.searchPanel.open(this.allChannels);
    });
  }
  
  private getGraphColumnMetrics(): { left: number; width: number } {
    const host = this.rowsContainer.parentElement as HTMLElement;
    const hostRect = host.getBoundingClientRect();
    const firstRow = this.rowsContainer.querySelector(".channel-row");
    const baseEl = firstRow ?? host.querySelector("#header");
    const graphEl = baseEl ? (baseEl.querySelector(".col-graph") as HTMLElement | null) : null;
    if (!graphEl) {
      return { left: 0, width: Math.max(50, this.rowsContainer.clientWidth) };
    }
    const rect = graphEl.getBoundingClientRect();
    return {
      left: Math.round(rect.left - hostRect.left),
      width: Math.max(50, Math.round(rect.width)),
    };
  }

  private updateGraphColumnOffset(): void {
    this.graphColumnOffset = this.getGraphColumnMetrics().left;
  }

  private updateCanvasPosition(): void {
    if (!this.pixiApp || !this.canvasOverlay) return;
    const host = this.rowsContainer.parentElement as HTMLElement;
    const hostRect = host.getBoundingClientRect();
    const rowsRect = this.rowsContainer.getBoundingClientRect();
    const metrics = this.getGraphColumnMetrics();
    this.canvasOverlay.style.top = `${Math.round(rowsRect.top - hostRect.top)}px`;
    this.canvasOverlay.style.left = `${metrics.left}px`;
    this.canvasOverlay.style.width = `${metrics.width}px`;
    this.canvasOverlay.style.height = `${Math.round(rowsRect.height)}px`;
  }

  private syncCanvasLayout(): void {
    if (!this.pixiApp) return;
    this.updateCanvasPosition();
    const metrics = this.getGraphColumnMetrics();
    this.pixiApp.renderer.resize(metrics.width, Math.max(50, this.rowsContainer.clientHeight));
  }
  
  public getPixiApp(): Application | null {
    return this.pixiApp;
  }
  
  public getGraphColumnOffset(): number {
    return this.graphColumnOffset;
  }

  public draw(data: Record<string, number>): void {
    if (this.isDestroyed || !data) return;
    this.drawCallCount++;
    const now = Date.now();
    this.allChannels.forEach((ch) => {
      if (data[ch.id] !== undefined) {
        const val = data[ch.id];
        if (typeof val === "number" && Number.isFinite(val)) {
          ch.updateRawValue(val);
          // ВАЖНО: теперь передаём И scaledValue, И rawValue
          this.archive.addSample(ch.id, now, ch.scaledValue, ch.rawDecValue);
        }
      }
    });
  }

  public setIniFiles(files: IniFileItem[]): void {
    this.availableIniFiles = Array.isArray(files) ? files : [];
    if (this.iniPanel) {
      this.iniPanel.setExternalFiles(this.availableIniFiles);
    }
  }

  public setActiveIni(id: string, loadContent: boolean = true): void {
    if (this.isDestroyed || !id) return;
    if (
      this.currentIniId === id &&
      this.allChannels.length > 0 &&
      !loadContent
    ) {
      return;
    }
    this.currentIniId = id;
    if (this.iniPanel) {
      this.iniPanel.selectFileById(id);
    }
    if (loadContent) {
      const file = this.availableIniFiles.find((f) => f.id === id);
      if (file && typeof file.content === "string") {
        void this.loadIniContent(file.content);
      }
    }
  }

  public setSlaveAddress(addr: number): void {
    this.slaveAddress = addr;
  }

  public setConnectionStatus(connected: boolean, message?: string): void {
    if (this.isDestroyed) return;

    if (this.toolbar) {
      this.toolbar.updateStatus(connected);
    }

    if (connected) {
      if (!this.connectionLost) return;
      this.connectionLost = false;
      this.connectionModal.close();
      this.isRunning = true;
      this.lastFrameTime = performance.now();
      if (this.animFrameId === null) {
        this.animFrameId = requestAnimationFrame((t) => this.loop(t));
      }
      if (this.settings.isPolling) {
        if (this.serial) {
          this.serial.resumePolling();
        }
      }
    } else {
      if (this.connectionLost) return;
      this.connectionLost = true;
      this.isRunning = false;
      this.connectionModal.show(message ?? "Связь с устройством потеряна.");
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.isRunning = false;
    this.connectionModal?.close();
    if (this.statsTimerId !== null) {
      clearInterval(this.statsTimerId);
      this.statsTimerId = null;
    }
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.pixiViews.forEach((view) => {
      try {
        view.destroy();
      } catch (err) {
        console.warn("[Oscilloscope] Failed to destroy PixiView:", err);
      }
    });
    this.pixiViews.clear();
    if (this.targetRoot) {
      this.targetRoot.innerHTML = "";
    }
  }

  public async loadIniContent(iniContent: string): Promise<void> {
    if (this.isDestroyed || typeof iniContent !== "string") return;
    if (
      this.allChannels.length > 0 &&
      iniContent === this.lastLoadedIniContent
    ) {
      console.log("[Oscilloscope] loadIniContent skipped: same content");
      return;
    }
    try {
      const coreParser = new CoreIniParser();
      const parseResult = coreParser.parse(iniContent);
      const iniConfig = new IniConfig(parseResult);
      const ramParams = iniConfig.getSection("RAM");
      const channelConfigs = iniParamsToChannelConfigs(ramParams);
      await this.applyChannelConfigs(channelConfigs);
      this.currentIniConfig = iniConfig;
      this.lastLoadedIniContent = iniContent;
    } catch (err) {
      console.error("[Oscilloscope] Failed to parse INI content:", err);
    }
  }

  public async applyChannelConfigs(configs: ChannelConfig[]): Promise<void> {
    if (this.isDestroyed) return;
    const channels = (Array.isArray(configs) ? configs : [])
      .filter((c) => c && c.id)
      .map((c) => new Channel(c));
    await this.setChannels(channels);
  }

  public async setChannels(newChannels: Channel[]): Promise<void> {
    if (this.isDestroyed) return;
    console.log(`[Oscilloscope] Setting channels: ${newChannels.length}`);
    this.allChannels = Array.isArray(newChannels) ? newChannels : [];
    this.visibleChannels = [...this.allChannels];
    try {
      this.archive.clear();
    } catch (err) {
      console.error("[Oscilloscope] Failed to clear archive:", err);
    }
        if (this.serial) {
      try {
        this.serial.setChannels(this.allChannels);
      } catch (err) {
        console.error("[Oscilloscope] Failed to set serial channels:", err);
      }
    }

    await renderVisibleChannels(this.getRenderingContext());
    this.updateGraphColumnOffset();
    this.syncCanvasLayout();
    syncViewPositions(this.getRenderingContext());
    this.cursorsFooter?.setStats(this.allChannels.length, this.lastReportedHz);
    console.log(`[Oscilloscope] Switch complete.`);
  }

  /** Публичный доступ к внутреннему архиву (для просмотрщика .rec) */
  public getArchive(): Archive {
    return this.archive;
  }
  /** Возвращает массив всех каналов (для просмотрщика и внешних модулей) */
  public getAllChannels(): Channel[] {
    return this.allChannels;
  }
  /** Добавляет свою кнопку в тулбар (режим просмотрщика) */
  public addViewerButton(label: string, title: string, onClick: () => void): void {
    this.toolbar.appendCustomButton(label, title, onClick);
  }

  /** Финальная настройка тулбара для просмотрщика */
  public finalizeViewerToolbar(): void {
    this.toolbar.finalizeViewerLayout();
  }

  /** Фиксирует время просмотра (выключает "живой" режим, маркеры застывают) */
  public setViewTime(t: number): void {
    this.settings.setViewTime(t);
  }

  public async updateVisibleChannels(
    newVisibleChannels: Channel[],
  ): Promise<void> {
    if (this.isDestroyed) return;
    const validIds = new Set(this.allChannels.map((ch) => ch.id));
    const filtered = Array.isArray(newVisibleChannels)
      ? newVisibleChannels.filter((ch) => ch && validIds.has(ch.id))
      : [];
    if (
      newVisibleChannels.length > 0 &&
      filtered.length === 0 &&
      this.allChannels.length > 0
    ) {
      this.visibleChannels = [...this.allChannels];
    } else {
      this.visibleChannels = filtered;
    }
    renderVisibleChannels(this.getRenderingContext());
  }

  private getCommandContext(): CommandContext {
    return {
      selectedChannel: this.selectedChannel,
      externalSerial: this.externalSerial,
      slaveAddress: this.slaveAddress,
      bottomPanels: this.bottomPanels,
    };
  }

    private getBindingsContext(): BindingsContext {
    return {
      settings: this.settings,
      getChannels: () => this.allChannels,
      getVisibleChannels: () => this.visibleChannels,
      pixiViews: this.pixiViews,
      propertiesModal: this.propertiesModal,
      splitContainer: this.splitContainer,
      toolbar: this.toolbar,
      serial: this.serial,
      iniPanel: this.iniPanel,
      recorder: this.recorder,
      cursorsFooter: this.cursorsFooter,
      bottomPanels: this.bottomPanels,
      renderer: this.renderer,
      isDestroyed: this.isDestroyed,
      notifyPollingStateChange: (isPolling: boolean) => {
        if (this.onPollingStateChangeCallback) {
          this.onPollingStateChangeCallback(isPolling);
        }
      },
      updateVisibleChannels: (newVisible) => this.updateVisibleChannels(newVisible),
      loadIniContent: (content) => this.loadIniContent(content),
      setConnectionStatus: (connected, msg) => this.setConnectionStatus(connected, msg),
      getCommandContext: () => this.getCommandContext(),
      getCurrentIniConfig: () => this.currentIniConfig,
      getAppState: () => this.getAppState(),
    };
  }

  private getRenderingContext(): RenderingContext {
    return {
      visibleChannels: this.visibleChannels,
      allChannels: this.allChannels,
      pixiViews: this.pixiViews,
      pixiApp: this.pixiApp,
      graphColumnOffset: this.graphColumnOffset,
      table: this.table,
      renderer: this.renderer,
      archive: this.archive,
      settings: this.settings,
      rowsContainer: this.rowsContainer,
      bottomPanels: this.bottomPanels,
      toolbar: this.toolbar,
      isDestroyed: this.isDestroyed,
      selectedChannel: this.selectedChannel,
      setSelectedChannel: (ch) => { this.selectedChannel = ch; },
      onChannelDeleted: (ch) => {
        this.updateVisibleChannels(
          this.visibleChannels.filter((c) => c.id !== ch.id),
        );
      },
      onToggleBit: (ch) => {
        const newVal = ch.scaledValue === 0 ? 1 : 0;
        void handleCommandSubmit(this.getCommandContext(), `${ch.name} = ${newVal}`);
      },
    };
  }

  private loop(now: number): void {
    this.animFrameId = null;
    if (this.isDestroyed || !this.isRunning || !this.table) return;
    this.lastFrameTime = now;

    const range = this.archive.getTimeRange();
    this.timelineScrollbar.setRange(range.min, range.max);

    if (this.settings.isPolling && this.settings.isLive()) {
      this.timelineScrollbar.setPosition(range.max);
    }

    try {
      this.toolbar.updateRecordTimer();

      // Dirty-flag: есть ли смысл перерисовывать в этом тике
      const signature =
        `${range.max}|${this.settings.getCurrentViewTime()}|` +
        `${this.settings.timeScale}|${this.settings.amplitudeMarkerTime}|` +
        `${this.settings.intervalMarker1Time}|${this.settings.intervalMarker2Time}`;
      const dirty = signature !== this.lastRenderSignature;
      const throttled = now - this.lastRenderTime >= Oscilloscope.RENDER_INTERVAL_MS;

      if (dirty && throttled) {
        this.lastRenderSignature = signature;
        this.lastRenderTime = now;
        this.table.updateValues();
        this.renderVisibleGraphs();
      }
    } catch (err) {
      console.error("Oscilloscope loop error:", err);
    }
    this.animFrameId = requestAnimationFrame((t) => this.loop(t));
  }

  /** Рендерит только те каналы, чьи строки сейчас видимы в области прокрутки. */
  private renderVisibleGraphs(): void {
    const rowsRect = this.rowsContainer.getBoundingClientRect();
    const viewportTop = rowsRect.top - 60;
    const viewportBottom = rowsRect.bottom + 60;

    for (const channel of this.visibleChannels) {
      const row = this.table.getRow(channel.id);
      if (!row || !row.getIsVisible()) continue;

      const rowRect = row.getElement().getBoundingClientRect();
      if (rowRect.bottom < viewportTop || rowRect.top > viewportBottom) continue;

      const view = this.pixiViews.get(channel.id);
      if (!view) continue;
      try {
        this.renderer.renderChannelGraph(channel, view);
      } catch (renderErr) {
        console.error(`Error rendering channel ${channel.id}:`, renderErr);
      }
    }
  }
}