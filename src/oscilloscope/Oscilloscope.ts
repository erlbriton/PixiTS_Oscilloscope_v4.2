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
    this.bindEvents();
    this.bindTimeZoomWheel();
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

  private bindEvents(): void {
    this.toolbar.onOpenProperties(() => {
      this.propertiesModal.open(this.allChannels, this.visibleChannels);
    });
    this.toolbar.onToggleWindowSize((isHalf) => {
      if (this.splitContainer) {
        const viewport = this.splitContainer.parentElement;
        const oscContainer = document.querySelector("#osc-container");

        if (isHalf) {
          this.splitContainer.classList.add("half-window-left");
          this.splitContainer.classList.remove("full-window");
          if (viewport) viewport.classList.remove("full-window");
          if (oscContainer) oscContainer.classList.remove("full-window");
        } else {
          this.splitContainer.classList.remove("half-window-left");
          this.splitContainer.classList.add("full-window");
          if (viewport) viewport.classList.add("full-window");
          if (oscContainer) oscContainer.classList.add("full-window");
        }
      }
    });
        //              this.propertiesModal.onApply((newVisible) => {
        //       this.updateVisibleChannels(newVisible);
        //       // Диагностика: показываем состояние autoScale всех каналов
        //       console.log('[Oscilloscope] Состояние autoScale после применения:');
        //       this.allChannels.forEach(ch => {
        //           console.log(`  ${ch.name}: autoScale = ${ch.autoScale}`);
        //       });
        //       // Если хотя бы один канал не в автомасштабе — гасим кнопку
        //       const allAutoScale = this.allChannels.every(ch => ch.autoScale);
        //       console.log('[Oscilloscope] allAutoScale =', allAutoScale);
        //       this.toolbar.setAutoScaleButtonState(allAutoScale);
        //   });
    this.serial.onStateChange((state, msg) => {
      if (state === "error") {
        this.setConnectionStatus(false, msg || "Связь с устройством потеряна.");
      } else if (state === "connected") {
        this.setConnectionStatus(true);
      }
    });
    this.iniPanel.onFileSelect((fileItem: IniFileItem) => {
      if (this.isDestroyed) return;
      this.currentIniId = fileItem.id;
      this.loadIniContent(fileItem.content);
    });
    window.addEventListener("oscilloscope-export-csv", () => {
      this.recorder.downloadCSV(this.visibleChannels);
    });
    this.toolbar.onToggleTimeZoom((enabled) => {
      this.settings.timeZoomEnabled = enabled;
    });

    this.toolbar.onTogglePolling((isPolling) => {////////////////////////////////////////////\
      // Тихо игнорируем нажатие, если активен режим измерения
      if (this.settings.isAmplitudeMode) {
        return;
      }

      console.log('[Oscilloscope] Кнопка Пуск/Стоп нажата. isPolling =', isPolling);
      if (isPolling) {
        this.serial.resumePolling();
        this.settings.followLive();
      } else {
        this.serial.pausePolling();
        this.settings.freezeTime();
      }
      if (this.onPollingStateChangeCallback) {
        this.onPollingStateChangeCallback(isPolling);
      }
    });/////////////////////////////////////////////////////////////////////////////////////\

    this.toolbar.onAutoScale(() => {
      this.allChannels.forEach(ch => {
        ch.autoScale = true;
      });
      const allAutoScale = this.allChannels.every(ch => ch.autoScale);
      this.toolbar.setAutoScaleButtonState(allAutoScale);
    });

    this.toolbar.onToggleAmplitudeMode(() => {
      if (this.settings.isAmplitudeMode) {
        // === ВЫХОД ИЗ РЕЖИМА ===
        this.settings.isAmplitudeMode = false;
        this.settings.amplitudeMarkerTime = null;
        this.cursorsFooter.setAmplitudeTime(null);
        this.toolbar.setAmplitudeModeButtonState(false);

        // Возвращаем опрос, если он был до входа в режим
        if (this.settings.wasPollingBeforeMeasure) {
          this.settings.isPolling = true;
          this.serial.resumePolling();
          this.settings.followLive();
          this.toolbar.updatePollingButtonState();

          // КРИТИЧЕСКИ ВАЖНО: Сообщаем main.ts, чтобы он перезапустил readLoop
          if (this.onPollingStateChangeCallback) {
            this.onPollingStateChangeCallback(true);
          }
        }
      } else {//////////////////////////////////////////////////////////////////////\
        // === ВХОД В РЕЖИМ ===
        this.settings.wasPollingBeforeMeasure = this.settings.isPolling;

        // ГАРАНТИРОВАННО останавливаем опрос и замораживаем время
        this.settings.isPolling = false;
        this.serial.pausePolling();
                this.settings.freezeTime();
                this.toolbar.updatePollingButtonState();
                if (this.onPollingStateChangeCallback) {
                    this.onPollingStateChangeCallback(false);
                }

                this.settings.isAmplitudeMode = true;
                
                // Вычисляем duration ТОЧНО так же, как в Renderer.ts, чтобы маркер был по центру
                const firstView = this.pixiViews.values().next().value;
                const width = firstView ? firstView.bounds.width : 800;
                const spacing = 40 * this.settings.timeScale;
                const duration = (width / spacing) * 1000;
                
                const now = this.settings.getCurrentViewTime();
                this.settings.amplitudeMarkerTime = now - (duration / 2);

                this.toolbar.setAmplitudeModeButtonState(true);
                this.cursorsFooter.setAmplitudeTime(this.settings.amplitudeMarkerTime);
            }////////////////////////////////////////////////////////////////////////////////\\
        });
    this.bottomPanels.onCommandSubmit((text) => {
      void this.handleCommandSubmit(text);
    });

    this.bottomPanels.onMultiplyCommand(() => {
      void this.handleMultiplyCommand();
    });
  }

  private bindTimeZoomWheel(): void {
    const rowsContainer = this.rowsContainer;
    rowsContainer.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        if (!this.settings.timeZoomEnabled) return;
        const target = e.target as HTMLElement;
        if (!target.closest(".col-graph")) return;
        e.preventDefault();
        e.stopPropagation();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.settings.setTimeScale(this.settings.timeScale * factor);
        this.updateTimeScaleReadout();
      },
      { passive: false },
    );
    this.updateTimeScaleReadout();
  }

  private updateTimeScaleReadout(): void {
    this.bottomPanels.setReadout(
      ReadoutSlot.TimeScale,
      `${Math.round(this.settings.timeScale * 100)}%`,
    );
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

    await this.renderVisibleChannels();
    console.log(`[Oscilloscope] Switch complete.`);
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
    await this.renderVisibleChannels();
  }

  private async renderVisibleChannels(): Promise<void> {
    if (this.isDestroyed || !this.table) return;
    this.pixiViews.forEach((view) => {
      try {
        view.destroy();
      } catch (err) {
        console.warn("[Oscilloscope] Failed to destroy old PixiView:", err);
      }
    });
           this.pixiViews.clear();
        const tempPixiViews: Map<string, PixiView> = new Map();
        
                // Запоминаем позицию прокрутки перед очисткой таблицы
        const savedScrollTop = this.rowsContainer.scrollTop;
        
        this.table.clear();
        for (const channel of this.visibleChannels) {
      if (this.isDestroyed) break;
      const row = this.table.addChannel(channel);
              row.onChannelUpdated = () => {
          if (this.settings.enableCursors) this.updateCursorsFooter();
          // Обновляем состояние кнопки автомасштабирования
          const allAutoScale = this.allChannels.every(ch => ch.autoScale);
          this.toolbar.setAutoScaleButtonState(allAutoScale);
        };
      row.onDelete = (deletedChannel) => {
        this.updateVisibleChannels(
          this.visibleChannels.filter((c) => c.id !== deletedChannel.id),
        );
      };
      row.onSelect = (selectedChannel: Channel) => {
        this.selectedChannel = selectedChannel;
        this.bottomPanels.setCommandText(`${selectedChannel.name} = `);
      };
      row.onToggleBit = (toggledChannel: Channel) => {
        this.selectedChannel = toggledChannel;
        const currentVal = toggledChannel.scaledValue;
        const newVal = currentVal === 0 ? 1 : 0;
        console.log(
          `[Oscilloscope] Double-click toggle bit: ${toggledChannel.name}, ${currentVal} -> ${newVal}`,
        );
        void this.handleCommandSubmit(`${toggledChannel.name} = ${newVal}`);
      };
              const container = row.getGraphContainer();
        if (container) {
          const pixiView = new PixiView(container);
          try {
            await pixiView.init();

                        // Добавляем обработчик клика для режима измерения величины сигнала
            pixiView.canvas.addEventListener('click', (e: MouseEvent) => {
              if (!this.settings.isAmplitudeMode) return;

              const rect = pixiView.canvas.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const width = rect.width;
              
              if (width <= 0) return;

              // Вычисляем duration ТОЧНО так же, как в Renderer.ts
              const spacing = 40 * this.settings.timeScale;
              const duration = (width / spacing) * 1000;
              
              const currentTime = this.settings.getCurrentViewTime();
              const startTime = currentTime - duration;

              // Вычисляем абсолютное время по координате X клика
              const markerTime = startTime + (x / width) * duration;

              // Обновляем состояние маркера и подвал
              this.settings.amplitudeMarkerTime = markerTime;
              this.cursorsFooter.setAmplitudeTime(markerTime);
              
              // Принудительно вызываем перерисовку всех графиков для мгновенного отклика
              this.visibleChannels.forEach((ch) => {
                const v = this.pixiViews.get(ch.id);
                if (v) {
                  this.renderer.renderChannelGraph(ch, v);
                }
              });
            });

            tempPixiViews.set(channel.id, pixiView);
          } catch (err) {
            console.warn(
              `[Oscilloscope] PixiView init failed for channel ${channel.id}:`,
              err,
            );
          }
        }
    }
           if (!this.isDestroyed) {
            this.pixiViews = tempPixiViews;
            
                       // Восстанавливаем позицию прокрутки после перерисовки
            requestAnimationFrame(() => {
                this.rowsContainer.scrollTop = savedScrollTop;
            });
        }
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
      if (this.settings.enableCursors) this.updateCursorsFooter();
    } catch (err) {
      console.error("Oscilloscope loop error:", err);
    }
    this.animFrameId = requestAnimationFrame((t) => this.loop(t));
  }

  private updateCursorsFooter(): void {
    this.cursorsFooter.update(
      this.settings.cursorX1Percent,
      this.settings.cursorX2Percent,
      this.settings.timeWindowMs,
    );
  }

  private async handleMultiplyCommand(): Promise<void> {
    if (!this.selectedChannel) {
      console.warn("[Oscilloscope] x10: Нет выбранного канала.");
      return;
    }
    if (!this.externalSerial) {
      console.warn("[Oscilloscope] x10: Нет подключения к порту.");
      return;
    }
    const parsedReg = parseModbusReg(this.selectedChannel.modbusReg);
    if (!parsedReg || parsedReg.bit === null) {
      console.warn(
        "[Oscilloscope] x10: Выбранный параметр не является битовым.",
      );
      return;
    }

    const commandText = this.bottomPanels.getCommandText();
    console.log(
      `[Oscilloscope] x10: Запуск очереди из 10 записей (5 Гц) для "${commandText}"`,
    );

    for (let i = 0; i < 10; i++) {
      console.log(`[Oscilloscope] x10: запись ${i + 1}/10`);
      await this.handleCommandSubmit(commandText);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log("[Oscilloscope] x10: Очередь записей завершена.");
  }

  private async handleCommandSubmit(text: string): Promise<void> {
    const ch = this.selectedChannel;
    if (!ch || !ch.modbusReg) {
      console.warn("[Oscilloscope] No channel selected or missing modbusReg.");
      return;
    }

    const parsedReg = parseModbusReg(ch.modbusReg);
    if (!parsedReg) {
      console.warn(`[Oscilloscope] Invalid modbusReg format: ${ch.modbusReg}`);
      return;
    }

    if (!this.externalSerial) {
      console.warn(
        "[Oscilloscope] No external serial port attached for write.",
      );
      return;
    }

    const parts = text.split("=");
    if (parts.length < 2) {
      console.warn('[Oscilloscope] No "=" found in command.');
      return;
    }

    const valueStr = parts.slice(1).join("=").trim();

    let valueToWrite: number;
    if (valueStr.toLowerCase().startsWith("x")) {
      valueToWrite = parseInt(valueStr.substring(1), 16);
    } else {
      valueToWrite = parseInt(valueStr, 10);
    }

    if (isNaN(valueToWrite)) {
      console.warn("[Oscilloscope] Invalid number format.");
      return;
    }

    if (parsedReg.bit !== null) {
      const serialWithRead = this.externalSerial as {
        readRegister?(slaveId: number, address: number): Promise<number | null>;
      };

      if (!serialWithRead.readRegister) {
        console.error(
          "[Oscilloscope] externalSerial does not support readRegister.",
        );
        return;
      }

      const currentVal = await serialWithRead.readRegister(
        this.slaveAddress,
        parsedReg.address,
      );
      if (currentVal === null) {
        console.error(
          "[Oscilloscope] Failed to read register for RMW operation.",
        );
        return;
      }

      let newVal = currentVal;
      if (valueToWrite !== 0) {
        newVal |= 1 << parsedReg.bit;
      } else {
        newVal &= ~(1 << parsedReg.bit);
      }

      console.log(
        `[Oscilloscope] Bit RMW: addr=${parsedReg.address}, bit=${parsedReg.bit}, old=${currentVal}, new=${newVal}`,
      );

      const packet = buildWriteMultipleRegistersRequest(
        this.slaveAddress,
        parsedReg.address,
        [newVal],
      );
      const hexDump = Array.from(packet)
        .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
        .join(" ");
      console.log(`[Oscilloscope] Bit RMW packet HEX: ${hexDump}`);

      await this.externalSerial.write(packet);
      console.log("[Oscilloscope] Bit RMW write sent successfully.");

      this.bottomPanels.focusCommand();
      return;
    }

    const typeUpper = (ch.dataType || "").toUpperCase();
    const is32Bit =
      typeUpper.includes("FLOAT") ||
      typeUpper.includes("DWORD") ||
      typeUpper.includes("LONG") ||
      typeUpper.includes("INT32");

    let values: number[];
    if (is32Bit) {
      const buf = new ArrayBuffer(4);
      const view = new DataView(buf);

      if (typeUpper.includes("FLOAT")) {
        view.setFloat32(0, valueToWrite, false);
      } else {
        view.setUint32(0, valueToWrite, false);
      }

      const reg1 = view.getUint16(0, false);
      const reg2 = view.getUint16(2, false);
      values = [reg2, reg1];

      console.log(
        `[Oscilloscope] 32-bit write: addr=${parsedReg.address}, val=${valueToWrite}, regs=[${reg1}, ${reg2}]`,
      );
    } else {
      const val16 = valueToWrite & 0xffff;
      values = [val16];
      console.log(
        `[Oscilloscope] 16-bit write: addr=${parsedReg.address}, val=${val16}`,
      );
    }

    try {
      const packet = buildWriteMultipleRegistersRequest(
        this.slaveAddress,
        parsedReg.address,
        values,
      );
      const hexDump = Array.from(packet)
        .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
        .join(" ");
      console.log(
        `[Oscilloscope] Write packet HEX (${packet.length} bytes): ${hexDump}`,
      );
      await this.externalSerial.write(packet);
      console.log("[Oscilloscope] Write packet sent successfully.");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[Oscilloscope] Failed to send write packet:", errMsg);
    }

    this.bottomPanels.focusCommand();
  }
}
