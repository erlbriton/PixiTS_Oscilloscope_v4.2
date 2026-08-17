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
  type RenderingContext } from "./scope/OscilloscopeRenderer";
  import { bindEvents, bindTimeZoomWheel, updateTimeScaleReadout, updateCursorsFooter, type BindingsContext } from "./scope/OscilloscopeBindings";

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
  private targetRoot: HTMLElement | null = null;
  private isDestroyed: boolean = false;
  private lastLoadedIniContent: string | null = null;
  private selectedChannel: Channel | null = null;
  private slaveAddress: number = 1;
  private externalSerial: { write(data: Uint8Array): Promise<void> } | null =
    null;
  private onPollingStateChangeCallback?: (isPolling: boolean) => void;

  constructor() {
    this.settings = new Settings();
    this.archive = new Archive();
    this.serial = new Serial(this.archive);
    this.recorder = new Recorder(this.archive, new BrowserFileSaver());
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

            this.timelineScrollbar = new TimelineScrollbar(layoutElements.timelineContainer);
        this.timelineScrollbar.onChange((timestamp) => {
            console.log('[Oscilloscope] Скроллбар onChange. timestamp:', timestamp, ', isPolling:', this.settings.isPolling, ', isAtLive:', this.timelineScrollbar.isAtLivePosition());
            if (this.timelineScrollbar.isAtLivePosition() && this.settings.isPolling) {
                // Возвращаемся в живой режим ТОЛЬКО если опрос уже идёт
                this.settings.followLive();
            } else {
                // Иначе просто показываем историю на этом времени
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
    // При загрузке все каналы в режиме автомасштаба — активируем кнопку
    this.toolbar.setAutoScaleButtonState(true);
    this.resizer = new Resizer(this.settings, layoutElements.headerContainer);
    this.resizer.initialize();
    this.iniPanel = new IniPanel(layoutElements.iniPanelContainer);
    this.bottomPanels = new BottomPanels(layoutElements.bottomPanelsContainer);
    this.cursorsFooter = new CursorsFooter(layoutElements.footerContainer);
    this.rowsContainer = layoutElements.rowsContainer;
    this.propertiesModal = new PropertiesModal();
    this.connectionModal = new ConnectionModal();
    bindEvents(this.getBindingsContext());
    bindTimeZoomWheel(this.getBindingsContext(), this.rowsContainer);
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.animFrameId = requestAnimationFrame((t) => this.loop(t));
  }

  public draw(data: Record<string, number>): void {
    if (this.isDestroyed || !data) return;
    const now = Date.now();
    this.allChannels.forEach((ch) => {
      if (data[ch.id] !== undefined) {
        const val = data[ch.id];
        if (typeof val === "number" && Number.isFinite(val)) {
          ch.updateRawValue(val);
          this.archive.addSample(ch.id, now, ch.scaledValue);
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
      // Если опрос должен идти, явно возобновляем его после переподключения
      if (this.settings.isPolling) {
        this.serial.resumePolling();
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

  // private bindEvents(): void {//////////////////////////////////////////////
  //   this.toolbar.onOpenProperties(() => {
  //     this.propertiesModal.open(this.allChannels, this.visibleChannels);
  //   });
  //   this.toolbar.onToggleWindowSize((isHalf) => {
  //     if (this.splitContainer) {
  //       const viewport = this.splitContainer.parentElement;
  //       const oscContainer = document.querySelector("#osc-container");

  //       if (isHalf) {
  //         this.splitContainer.classList.add("half-window-left");
  //         this.splitContainer.classList.remove("full-window");
  //         if (viewport) viewport.classList.remove("full-window");
  //         if (oscContainer) oscContainer.classList.remove("full-window");
  //       } else {
  //         this.splitContainer.classList.remove("half-window-left");
  //         this.splitContainer.classList.add("full-window");
  //         if (viewport) viewport.classList.add("full-window");
  //         if (oscContainer) oscContainer.classList.add("full-window");
  //       }
  //     }
  //   });
  //       //              this.propertiesModal.onApply((newVisible) => {
  //       //       this.updateVisibleChannels(newVisible);
  //       //       // Диагностика: показываем состояние autoScale всех каналов
  //       //       console.log('[Oscilloscope] Состояние autoScale после применения:');
  //       //       this.allChannels.forEach(ch => {
  //       //           console.log(`  ${ch.name}: autoScale = ${ch.autoScale}`);
  //       //       });
  //       //       // Если хотя бы один канал не в автомасштабе — гасим кнопку
  //       //       const allAutoScale = this.allChannels.every(ch => ch.autoScale);
  //       //       console.log('[Oscilloscope] allAutoScale =', allAutoScale);
  //       //       this.toolbar.setAutoScaleButtonState(allAutoScale);
  //       //   });
  //     this.propertiesModal.onApply((newVisible) => {
  //       // Применяем новые настройки видимости и масштаба каналов
  //       this.updateVisibleChannels(newVisible);
        
  //       // Обновляем состояние кнопки автомасштаба на панели инструментов
  //       const allAutoScale = this.allChannels.every(ch => ch.autoScale);
  //       this.toolbar.setAutoScaleButtonState(allAutoScale);
  //   });

  //   this.serial.onStateChange((state, msg) => {
  //     if (state === "error") {
  //       this.setConnectionStatus(false, msg || "Связь с устройством потеряна.");
  //     } else if (state === "connected") {
  //       this.setConnectionStatus(true);
  //     }
  //   });
  //   this.iniPanel.onFileSelect((fileItem: IniFileItem) => {
  //     if (this.isDestroyed) return;
  //     this.currentIniId = fileItem.id;
  //     this.loadIniContent(fileItem.content);
  //   });
  //   window.addEventListener("oscilloscope-export-csv", () => {
  //     this.recorder.downloadCSV(this.visibleChannels);
  //   });
  //   this.toolbar.onToggleTimeZoom((enabled) => {
  //     this.settings.timeZoomEnabled = enabled;
  //   });

  //       this.toolbar.onTogglePolling((isPolling) => {
  //     // СПЕЦИАЛЬНАЯ ЛОГИКА: Если активен режим измерения и нажали ПУСК (isPolling === true)
  //     if (this.settings.isAmplitudeMode && isPolling) {
  //       console.log('[Oscilloscope] Аварийный выход из режима измерения через кнопку Пуск');

  //       // 1. Выключаем режим измерения
  //       this.settings.isAmplitudeMode = false;
  //       this.settings.amplitudeMarkerTime = null;
  //       this.cursorsFooter.setAmplitudeTime(null);
  //       this.toolbar.setAmplitudeModeButtonState(false);

  //       // 2. Запускаем стандартный опрос и движение графиков
  //       this.settings.isPolling = true;
  //       this.serial.resumePolling();
  //       this.settings.followLive();
  //       this.toolbar.updatePollingButtonState();

  //       // 3. Синхронизируем с main.ts (точно так же, как это делает рабочий код выхода из режима)
  //       if (this.onPollingStateChangeCallback) {
  //         this.onPollingStateChangeCallback(true);
  //       }
  //       return; // Прерываем выполнение, стандартная логика ниже не сработает
  //     }

  //     // Если нажали СТОП во время измерения - просто игнорируем (опрос внутри режима и так на паузе)
  //     if (this.settings.isAmplitudeMode && !isPolling) {
  //       return;
  //     }

  //     // Стандартная логика переключения Пуск/Стоп (вне режима измерения)
  //     console.log('[Oscilloscope] Кнопка Пуск/Стоп нажата. isPolling =', isPolling);
  //     if (isPolling) {
  //       this.serial.resumePolling();
  //       this.settings.followLive();
  //     } else {
  //       this.serial.pausePolling();
  //       this.settings.freezeTime();
  //     }
  //     if (this.onPollingStateChangeCallback) {
  //       this.onPollingStateChangeCallback(isPolling);
  //     }
  //   });

  //   this.toolbar.onAutoScale(() => {
  //     this.allChannels.forEach(ch => {
  //       ch.autoScale = true;
  //     });
  //     const allAutoScale = this.allChannels.every(ch => ch.autoScale);
  //     this.toolbar.setAutoScaleButtonState(allAutoScale);
  //   });

  //      this.toolbar.onToggleAmplitudeMode(() => {
  //                 if (this.settings.isAmplitudeMode) {
  //               // === ВЫХОД ИЗ РЕЖИМА ===
  //               this.settings.isAmplitudeMode = false;
  //               this.settings.amplitudeMarkerTime = null;
  //               this.bottomPanels.setReadout(ReadoutSlot.Reserved3, ''); // Очищаем третью ячейку
  //               this.toolbar.setAmplitudeModeButtonState(false);

  //       // Возвращаем опрос, если он был до входа в режим
  //       if (this.settings.wasPollingBeforeMeasure) {
  //         this.settings.isPolling = true;
  //         this.serial.resumePolling();
  //         this.settings.followLive();
  //         this.toolbar.updatePollingButtonState();

  //         // КРИТИЧЕСКИ ВАЖНО: Сообщаем main.ts, чтобы он перезапустил readLoop
  //         if (this.onPollingStateChangeCallback) {
  //           this.onPollingStateChangeCallback(true);
  //         }
  //       }
  //     } else {//////////////////////////////////////////////////////////////////////\
  //       // === ВХОД В РЕЖИМ ===
  //       this.settings.wasPollingBeforeMeasure = this.settings.isPolling;

  //       // ГАРАНТИРОВАННО останавливаем опрос и замораживаем время
  //       this.settings.isPolling = false;
  //       this.serial.pausePolling();
  //               this.settings.freezeTime();
  //               this.toolbar.updatePollingButtonState();
  //               if (this.onPollingStateChangeCallback) {
  //                   this.onPollingStateChangeCallback(false);
  //               }

  //               this.settings.isAmplitudeMode = true;
                
  //               // Вычисляем duration ТОЧНО так же, как в Renderer.ts, чтобы маркер был по центру
  //               const firstView = this.pixiViews.values().next().value;
  //               const width = firstView ? firstView.bounds.width : 800;
  //               const spacing = 40 * this.settings.timeScale;
  //               const duration = (width / spacing) * 1000;
                
  //               const now = this.settings.getCurrentViewTime();
  //               this.settings.amplitudeMarkerTime = now - (duration / 2);

  //               this.toolbar.setAmplitudeModeButtonState(true);
  //               this.cursorsFooter.setAmplitudeTime(this.settings.amplitudeMarkerTime);
  //           }
  //       });

  //       // Регистрируем callback для кнопки измерения временных интервалов
  //   this.toolbar.onToggleIntervalMode(() => {
  //     if (this.settings.isIntervalMode) {
  //       // === ВЫХОД ИЗ РЕЖИМА ===
  //       this.settings.isIntervalMode = false;
  //       this.settings.intervalMarker1Time = null;
  //       this.settings.intervalMarker2Time = null;
  //       this.toolbar.setIntervalModeButtonState(false);

  //       // Очищаем ячейку длительности интервала в подвале
  //       this.bottomPanels.setReadout(ReadoutSlot.Reserved2, '');

  //       // Возвращаем опрос, если он был остановлен
  //       if (this.settings.wasPollingBeforeInterval) {
  //         this.settings.isPolling = true;
  //         this.serial.resumePolling();
  //         this.settings.followLive();
  //         this.toolbar.updatePollingButtonState();

  //         if (this.onPollingStateChangeCallback) {
  //           this.onPollingStateChangeCallback(true);
  //         }
  //       }

  //       // Перерисовываем все графики для удаления маркеров
  //       this.visibleChannels.forEach((ch) => {
  //         const v = this.pixiViews.get(ch.id);
  //         if (v) {
  //           this.renderer.renderChannelGraph(ch, v);
  //         }
  //       });
  //     } else {
  //       // === ВХОД В РЕЖИМ ===
  //       this.settings.wasPollingBeforeInterval = this.settings.isPolling;
  //       this.settings.isIntervalMode = true;
  //       this.settings.intervalMarker1Time = null;
  //       this.settings.intervalMarker2Time = null;
  //       this.toolbar.setIntervalModeButtonState(true);

  //       // НЕ останавливаем опрос - маркеры работают и при движущихся графиках

  //       // Перерисовываем все графики
  //       this.visibleChannels.forEach((ch) => {
  //         const v = this.pixiViews.get(ch.id);
  //         if (v) {
  //           this.renderer.renderChannelGraph(ch, v);
  //         }
  //       });
  //     }
  //   });
  //         this.bottomPanels.onCommandSubmit((text) => {
  //     void handleCommandSubmit(this.getCommandContext(), text);
  //   });

  //   this.bottomPanels.onMultiplyCommand(() => {
  //     const ctx = this.getCommandContext();
  //     void handleMultiplyCommand(ctx, (t) => handleCommandSubmit(ctx, t));
  //   });
  // }/////////////////////////////////////////////////////////////////////////////////////\\

  // private bindTimeZoomWheel(): void {
  //   const rowsContainer = this.rowsContainer;
  //   rowsContainer.addEventListener(
  //     "wheel",
  //     (e: WheelEvent) => {
  //       if (!this.settings.timeZoomEnabled) return;
  //       const target = e.target as HTMLElement;
  //       if (!target.closest(".col-graph")) return;
  //       e.preventDefault();
  //       e.stopPropagation();
  //       const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  //       this.settings.setTimeScale(this.settings.timeScale * factor);
  //       this.updateTimeScaleReadout();
  //     },
  //     { passive: false },
  //   );
  //   this.updateTimeScaleReadout();
  // }

  // private updateTimeScaleReadout(): void {
  //   this.bottomPanels.setReadout(
  //     ReadoutSlot.TimeScale,
  //     `${Math.round(this.settings.timeScale * 100)}%`,
  //   );
  // }

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
    try {
      this.serial.setChannels(this.allChannels);
    } catch (err) {
      console.error("[Oscilloscope] Failed to set serial channels:", err);
    }

    await renderVisibleChannels(this.getRenderingContext());
    console.log(`[Oscilloscope] Switch complete.`);
  }

  /**
   * Форматирует длительность интервала в формат ЧЧ:ММ:СС.дсс
   * @param timeMs - длительность в миллисекундах (всегда положительная)
   * @returns строка вида "00:01:23.456"
   */

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
    };
  }

      private getRenderingContext(): RenderingContext {
    return {
      visibleChannels: this.visibleChannels,
      allChannels: this.allChannels,
      pixiViews: this.pixiViews,
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

    // Всегда обновляем диапазон (нужно, чтобы ползунок знал границы)
    const range = this.archive.getTimeRange();
    this.timelineScrollbar.setRange(range.min, range.max);

    // Обновляем позицию ползунка ТОЛЬКО если опрос идёт И мы в живом режиме
    if (this.settings.isPolling && this.settings.isLive()) {
      this.timelineScrollbar.setPosition(range.max);
    }
    // Иначе не трогаем ползунок — пользователь сам им управляет
    try {
      this.table.updateValues();
      this.toolbar.updateRecordTimer();
      this.visibleChannels.forEach((channel) => {
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
            if (this.settings.enableCursors) updateCursorsFooter(this.getBindingsContext());
    } catch (err) {
      console.error("Oscilloscope loop error:", err);
    }
    this.animFrameId = requestAnimationFrame((t) => this.loop(t));
  }

  // private updateCursorsFooter(): void {
  //   this.cursorsFooter.update(
  //     this.settings.cursorX1Percent,
  //     this.settings.cursorX2Percent,
  //     this.settings.timeWindowMs,
  //   );
  // }
}
