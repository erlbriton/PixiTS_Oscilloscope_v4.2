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
// Импортируем класс совмещённой строки, который объединяет несколько каналов
// (от 2 до 5) в одну систему координат для детального анализа сигналов.
// Используется в обработчике onCreateComposite при клике «Совместить» в меню.
import { CompositeChannelRow } from "./ui/CompositeChannelRow";
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
import {
  getGraphColumnMetrics as canvasMetrics,
  updateGraphColumnOffset as canvasUpdateOffset,
  updateCanvasPosition as canvasUpdatePosition,
  syncCanvasLayout as canvasSyncLayout,
  type CanvasContext,
} from "./scope/OscilloscopeCanvas";
import {
  createCompositeRow as compositeCreateRow,
  checkAndUpdateCompositeHeight as compositeCheckHeight,
  type CompositeContext,
} from "./scope/OscilloscopeComposite";
import {
  draw as loopDraw,
  loop as loopTick,
  renderVisibleGraphs as loopRenderGraphs,
  type LoopContext,
} from "./scope/OscilloscopeLoop";
import {
  setChannels as channelsSetChannels,
  updateVisibleChannels as channelsUpdateVisible,
  setIniFiles as channelsSetIniFiles,
  applyChannelConfigs as channelsApplyConfigs,
  loadIniContent as channelsLoadIniContent,
} from "./scope/OscilloscopeChannels";
import type { AppState } from "../core/app-state.js";
import { Application } from 'pixi.js';
import { SearchPanel } from './ui/SearchPanel';


export class Oscilloscope {
  private settings: Settings;
  public archive: Archive;
  public serial: Serial | null;
  private recorder: Recorder | null;
  private viewerMode: boolean = false;
  private table!: Table;
  private toolbar!: Toolbar;
  private resizer!: Resizer;
  private renderer!: Renderer;
  public iniPanel!: IniPanel;
  private bottomPanels!: BottomPanels;
  public cursorsFooter!: CursorsFooter;
  private searchPanel!: SearchPanel;
  private connectionModal!: ConnectionModal;
  private timelineScrollbar!: TimelineScrollbar;
  private connectionLost: boolean = false;
  private rowsContainer!: HTMLElement;
  private splitContainer!: HTMLElement;
  public allChannels: Channel[] = [];
  public visibleChannels: Channel[] = [];
  private pixiViews: Map<string, PixiView> = new Map();
  private isRunning: boolean = false;
  private lastFrameTime: number = 0;
  private propertiesModal!: PropertiesModal;
  public availableIniFiles: IniFileItem[] = [];
  private currentIniId: string | null = null;
  private animFrameId: number | null = null;
  private lastRenderTime: number = 0;
  private lastRenderSignature: string = "";
  private drawCallCount: number = 0;
  public lastReportedHz: number = 0;
  private statsTimerId: number | null = null;
  private targetRoot: HTMLElement | null = null;
  public isDestroyed: boolean = false;
  public lastLoadedIniContent: string | null = null;
  private selectedChannel: Channel | null = null;
  private slaveAddress: number = 1;
  private externalSerial: { write(data: Uint8Array): Promise<void> } | null = null;
  private onPollingStateChangeCallback?: (isPolling: boolean) => void;
  public currentIniConfig: IniConfig | null = null;
  private appState: AppState | null = null;
  private pixiApp: Application | null = null;
  private graphColumnOffset: number = 0;
  private canvasOverlay: HTMLDivElement | null = null;
  
  // ========================================================================
  // СОВМЕЩЁННАЯ СТРОКА (Composite Channel Row)
  // ========================================================================
  // Поля для хранения текущей совмещённой строки и её PixiView.
  // В текущей реализации поддерживается только одна совмещённая строка
  // одновременно (согласно требованиям заказчика).
  // Если пользователь создаст новую совмещённую группу, старая будет
  // автоматически удалена (или можно добавить проверку в будущем).
  
  // Экземпляр текущей совмещённой строки. null означает, что сейчас
  // совмещённой строки нет. Хранится здесь, чтобы метод renderVisibleGraphs
  // мог отрисовать её наравне с обычными каналами.
  private compositeRow: CompositeChannelRow | null = null;
  
  // PixiView для отрисовки графиков в совмещённой строке.
  // Хранится отдельно от основной карты pixiViews, чтобы не смешивать
  // обычные каналы и совмещённую группу. Это также упрощает удаление
  // совмещённой строки при её разгруппировке.
  private compositePixiView: PixiView | null = null;
  
  // Массив каналов, которые входят в текущую совмещённую группу.
  // Нужен для отрисовки всех этих каналов в один PixiView в методе
  // renderVisibleGraphs. Если compositeRow === null, массив пустой.
  private compositeChannels: Channel[] = [];

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
    // При изменении ширины колонок пересинхронизируем позиции и ширину графиков.
        this.resizer.onResize = () => {
      canvasUpdateOffset(this.getCanvasContext());
      // Обновляем размер и позицию самого canvas-overlay И pixi-рендерера.
      // Без этого графики "застрянут" со старой шириной до прокрутки.
      this.syncCanvasLayout();
      syncViewPositions(this.getRenderingContext());
    };
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

    // Делаем экземпляр осциллографа доступным глобально для доступа из UI-компонентов (модалок).
    (window as any).osc = this;
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
      canvasUpdatePosition(this.getCanvasContext());
      syncViewPositions(this.getRenderingContext());
    });
    
    // Вычисляем отступ до колонки графиков
    canvasUpdateOffset(this.getCanvasContext());
    
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
  
  /**
   * Строит контекст для канвас-функций (scope/OscilloscopeCanvas).
   * Состояние не копируется — передаются живые ссылки и сеттер.
   */
  public getCanvasContext(): CanvasContext {
    return {
      rowsContainer: this.rowsContainer,
      pixiApp: this.pixiApp,
      canvasOverlay: this.canvasOverlay,
      setGraphColumnOffset: (value) => { this.graphColumnOffset = value; },
    };
  }

  /** Публичная обёртка: синхронизация размера/позиции canvas (внешний API не менялся). */
  public syncCanvasLayout(): void {
    canvasSyncLayout(this.getCanvasContext());
  }

  public getPixiApp(): Application | null {
    return this.pixiApp;
  }

  public getGraphColumnOffset(): number {
    return this.graphColumnOffset;
  }

  /** Принимает новые значения параметров. Делегирует в scope/OscilloscopeLoop. */
  public draw(data: Record<string, number>): void {
    loopDraw(this.getLoopContext(), data);
  }

  /**
   * Строит контекст кадрового цикла (scope/OscilloscopeLoop).
   * Тайминг-состояние остаётся на классе — им делится lifecycle.
   */
  private getLoopContext(): LoopContext {
    return {
      isDestroyed: this.isDestroyed,
      isRunning: this.isRunning,
      table: this.table ?? null,
      archive: this.archive,
      settings: this.settings,
      timelineScrollbar: this.timelineScrollbar ?? null,
      toolbar: this.toolbar ?? null,
      viewerMode: this.viewerMode,
      renderer: this.renderer,
      rowsContainer: this.rowsContainer ?? null,
      pixiViews: this.pixiViews,
      getVisibleChannels: () => this.visibleChannels,
      getAllChannels: () => this.allChannels,
      getCompositeRow: () => this.compositeRow,
      getCompositeView: () => this.compositePixiView,
      getCompositeChannels: () => this.compositeChannels,
      getDrawCallCount: () => this.drawCallCount,
      setDrawCallCount: (v) => { this.drawCallCount = v; },
      getLastRenderSignature: () => this.lastRenderSignature,
      setLastRenderSignature: (v) => { this.lastRenderSignature = v; },
      getLastRenderTime: () => this.lastRenderTime,
      setLastRenderTime: (v) => { this.lastRenderTime = v; },
      setLastFrameTime: (v) => { this.lastFrameTime = v; },
      setAnimFrameId: (v) => { this.animFrameId = v; },
    };
  }

  public setIniFiles(files: IniFileItem[]): void {
    channelsSetIniFiles(this, files);
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
      // Возобновляем рендер-цикл, если он не запущен
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
      // ПРИНУДИТЕЛЬНО останавливаем рендер-цикл: отменяем запланированный кадр
      if (this.animFrameId !== null) {
        cancelAnimationFrame(this.animFrameId);
        this.animFrameId = null;
      }
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
    return channelsLoadIniContent(this, iniContent);
  }

  public async applyChannelConfigs(configs: ChannelConfig[]): Promise<void> {
    return channelsApplyConfigs(this, configs);
  }

  public async setChannels(newChannels: Channel[]): Promise<void> {
    return channelsSetChannels(this, newChannels);
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
    return channelsUpdateVisible(this, newVisibleChannels);
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

  public getRenderingContext(): RenderingContext {
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
      
      // Реализация callback'а создания совмещённой строки.
      // Делегирует вызов методу createCompositeRow() этого класса, который
      // управляет всем жизненным циклом совмещённой строки: создание,
      // добавление в DOM, создание PixiView, скрытие исходных строк
      // и сброс состояния выбора анализа.
      onCreateComposite: (channels) => {
        this.createCompositeRow(channels);
      },
      
      // Реализация выбора канала или совмещённой строки по координате Y.
      // Сначала пытаемся найти обычный канал. Если не нашли — проверяем,
      // не попал ли клик в область совмещённой строки.
      selectAtClientY: (clientY) => {
        // Сначала пытаемся найти обычный канал (видимый)
        const rowsRect = this.rowsContainer.getBoundingClientRect();
        const scrollTop = this.rowsContainer.scrollTop;
        const y = clientY - rowsRect.top + scrollTop;
        let acc = 0;
        
        for (const ch of this.visibleChannels) {
          const row = this.table.getRow(ch.id);
          if (!row || !row.getIsVisible()) continue;
          
          acc += ch.rowHeight;
          if (y < acc) {
            // Нашли обычный канал — кликаем по его строке
            row.getElement().click();
            return;
          }
        }
        
        // Если обычный канал не найден, проверяем совмещённую строку
        if (this.compositeRow && this.compositeRow.getIsVisible()) {
          const compositeRect = this.compositeRow.getElement().getBoundingClientRect();
          if (clientY >= compositeRect.top && clientY <= compositeRect.bottom) {
            // Клик попал в совмещённую строку — выбираем её
            this.compositeRow.getElement().click();
          }
        }
      },

      // Передаем ссылку на совмещённую строку в контекст рендеринга.
      // Это необходимо для обработки правого клика по области графиков.
      compositeRow: this.compositeRow || null,
    };
  }

  /** Кадровый цикл (приватный — запускается из setConnectionStatus/resumeFromFrozen). */
  private loop(now: number): void {
    loopTick(this.getLoopContext(), now);
  }

  /** Публичная обёртка: отрисовка видимых графиков (вызывает ChannelRow). */
  public renderVisibleGraphs(): void {
    loopRenderGraphs(this.getLoopContext());
  }

  // ========================================================================
  // СОЗДАНИЕ СОВМЕЩЁННОЙ СТРОКИ (Composite Channel Row)
  // ========================================================================
  // Метод создаёт совмещённую строку из массива выбранных каналов (от 2 до 5).
  // Вызывается из обработчика onCreateComposite в OscilloscopeRenderer.
  //
  // ПОСЛЕДОВАТЕЛЬНОСТЬ ДЕЙСТВИЙ:
  // 1) Удаляем предыдущую совмещённую строку, если она была.
  //    Это предотвращает накопление совмещённых групп (в требованиях указано,
  //    что несколько групп быть не может).
  // 2) Создаём новый объект CompositeChannelRow с переданными каналами.
  // 3) Добавляем HTML-элемент совмещённой строки в контейнер строк осциллографа.
  // 4) Создаём общий PixiView для всех каналов совмещённой строки.
  // 5) Скрываем исходные строки выбранных каналов (пользователь видит только
  //    совмещённую строку с легендой).
  // 6) Сбрасываем состояние выбора анализа (убираем красную подсветку и счётчик),
  //    чтобы пользователь мог выбрать новую группу после создания этой.
  // 7) Сохраняем ссылки на совмещённую строку, её PixiView и массив каналов,
  //    чтобы метод renderVisibleGraphs() мог отрисовать её.
  //
  // ПРИМЕЧАНИЕ: На этом шаге график в совмещённой строке пока пустой,
  // так как вызов renderCompositeGraph() будет добавлен в следующем шаге.
  // ========================================================================
  /**
   * Строит контекст для функций совмещённой строки (scope/OscilloscopeComposite).
   * Состояние читается через live-геттеры, чтобы замыкания (onDisconnect и т.п.),
   * срабатывающие позже, всегда видели актуальные значения.
   */
  private getCompositeContext(): CompositeContext {
    return {
      table: this.table,
      rowsContainer: this.rowsContainer,
      pixiApp: this.pixiApp,
      pixiViews: this.pixiViews,
      viewerMode: this.viewerMode,
      getCompositeRow: () => this.compositeRow,
      getCompositeView: () => this.compositePixiView,
      getCompositeChannels: () => this.compositeChannels,
      setComposite: (row, view, channels) => {
        this.compositeRow = row;
        this.compositePixiView = view;
        this.compositeChannels = channels;
      },
      getRenderingContext: () => this.getRenderingContext(),
      renderVisibleGraphs: () => this.renderVisibleGraphs(),
    };
  }

  /** Публичная обёртка: пересчёт высоты совмещённой строки (вызывает ChannelRow). */
  public checkAndUpdateCompositeHeight(channelId: string): void {
    compositeCheckHeight(this.getCompositeContext(), channelId);
  }

  /** Публичная обёртка: создание совмещённой строки из выбранных каналов. */
  public createCompositeRow(channels: Channel[]): void {
    compositeCreateRow(this.getCompositeContext(), channels);
  }

    /**
   * Показывает состояние "заморозки" (ошибка связи, но опрос продолжается).
   * Останавливает только рендер и показывает окно. Не трогает isPolling.
   */
  public showFrozenState(message: string): void {
    if (this.isDestroyed) return;
    // Только останавливаем рендер-цикл. Окно показывает UI-слой (uiManager).
    this.isRunning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /**
   * Возобновляет работу после "заморозки".
   * Запускает рендер-цикл и закрывает окно.
   */
  public resumeFromFrozen(): void {
    if (this.isDestroyed) return;
    
    // Закрываем окно, если оно было открыто именно этим методом
    if (this.connectionModal.isOpen) {
      this.connectionModal.close();
    }
    
    // Запускаем рендер-цикл
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    if (this.animFrameId === null) {
      this.animFrameId = requestAnimationFrame((t) => this.loop(t));
    }
  }
}
