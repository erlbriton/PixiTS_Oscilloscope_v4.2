// src/oscilloscope/ui/Toolbar.ts

import { Settings } from "../config/Settings";
import { Recorder } from "../core/Recorder";
import { Serial } from "../comm/Serial";
import { ToolbarComponents } from "./ToolbarComponents";

export class Toolbar {
  private container: HTMLElement;
  private settings: Settings;
  private recorder: Recorder;
  private serial: Serial;

  private autoscaleBtn!: HTMLButtonElement;
  private amplitudeBtn!: HTMLButtonElement;
  private cursorBtn!: HTMLButtonElement;
  private sweepBtn!: HTMLButtonElement;
  private pollingBtn!: HTMLButtonElement;
  private propertiesBtn!: HTMLButtonElement;
  private exportBtn!: HTMLButtonElement;
  private windowSizeBtn!: HTMLButtonElement;
  private statusBadge!: HTMLSpanElement;
  private onOpenPropertiesCallback?: () => void;
  private onToggleWindowSizeCallback?: (isHalf: boolean) => void;
  private onToggleTimeZoomCallback?: (enabled: boolean) => void;
  private onTogglePollingCallback?: (isPolling: boolean) => void;

  constructor(
    container: HTMLElement,
    settings: Settings,
    recorder: Recorder,
    serial: Serial,
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
  public onTogglePolling(cb: (isPolling: boolean) => void): void {
    this.onTogglePollingCallback = cb;
  }

  private onAutoScaleCallback?: () => void;

  public onAutoScale(cb: () => void): void {
    this.onAutoScaleCallback = cb;
  }

  /**
   * Обновляет подсветку кнопки автомасштабирования
   */
  public setAutoScaleButtonState(isActive: boolean): void {
    this.settings.autoScale = isActive;
    this.autoscaleBtn.classList.toggle("active", isActive);
  }

  public initialize(): void {
    this.container.innerHTML = "";

    // 1. Кнопка "Свойства" (габариты 64x32px)
    this.propertiesBtn = ToolbarComponents.createButton(
      `⚙️`,
      "icon-btn osc-btn-properties",
      () => {
        if (this.onOpenPropertiesCallback) this.onOpenPropertiesCallback();
      },
      "Свойства",
    );
    this.propertiesBtn.style.width = "64px";
    this.propertiesBtn.style.height = "32px";

    // 2. Индикатор статуса связи
    this.statusBadge = document.createElement("span");
    this.statusBadge.style.minWidth = "95px";
    this.statusBadge.style.height = "32px";
    this.statusBadge.style.display = "inline-flex";
    this.statusBadge.style.alignItems = "center";
    this.statusBadge.style.justifyContent = "center";
    this.statusBadge.style.padding = "0 8px";
    this.statusBadge.style.fontSize = "13px";
    this.statusBadge.style.fontWeight = "bold";
    this.statusBadge.style.color = "#0f110b";
    this.statusBadge.style.textShadow = "0 1px 2px rgba(0, 0, 0, 0.5)";
    this.statusBadge.style.userSelect = "none";
    this.statusBadge.style.borderRadius = "4px";

    // 3. Кнопка переключения размера окна (сразу после статуса, с иконкой)
    this.windowSizeBtn = ToolbarComponents.createButton(
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <path d="M9 3v18"/>
                <path d="M15 3v18"/>
            </svg>`,
      "tool-btn-dark window-toggle-btn",
      () => {
        this.settings.isHalfWindow = !this.settings.isHalfWindow;
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
      "Переключить ширину окна",
    );
    this.windowSizeBtn.style.width = "32px";
    this.windowSizeBtn.style.height = "32px";
    this.windowSizeBtn.style.padding = "0";
    this.windowSizeBtn.style.marginLeft = "4px";

    // 4. Кнопка Пуск-Стоп опроса (ВПЛОТНУЮ к кнопке 50%)
    const playIcon = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
            </svg>`;
    const pauseIcon = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
            </svg>`;

          this.pollingBtn = ToolbarComponents.createButton(
        pauseIcon,
        "tool-btn-dark active",
        () => {
          this.settings.isPolling = !this.settings.isPolling;
          this.pollingBtn.innerHTML = this.settings.isPolling
            ? pauseIcon
            : playIcon;
          this.pollingBtn.classList.toggle("active", this.settings.isPolling);
          if (this.onTogglePollingCallback) {
            this.onTogglePollingCallback(this.settings.isPolling);
          }
        },
        "Пуск/Стоп опроса контроллера°",
      );
      this.pollingBtn.style.width = "32px";
      this.pollingBtn.style.height = "32px";
      this.pollingBtn.style.padding = "0";
      this.pollingBtn.style.marginLeft = "0"; 

            // 5. Кнопка Автомасштабирование (вплотную к кнопке Пуск/Стоп)
      this.autoscaleBtn = ToolbarComponents.createButton(
        "📐",
        "tool-btn-dark",
        () => {
          this.settings.autoScale = true;
          this.autoscaleBtn.classList.add("active");
          if (this.onAutoScaleCallback) {
            this.onAutoScaleCallback();
          }
        },
        "Автомасштабирование (Auto-Scale)",
      );
      this.autoscaleBtn.style.width = "32px";
      this.autoscaleBtn.style.height = "32px";
      this.autoscaleBtn.style.padding = "0";
      this.autoscaleBtn.style.marginLeft = "0";

            // 6. Кнопка измерения величины сигнала (вплотную к кнопке Автомасштабирование)
      this.amplitudeBtn = ToolbarComponents.createButton(
        "📐",
        "tool-btn-dark",
        () => {
          if (this.onToggleAmplitudeModeCallback) {
              this.onToggleAmplitudeModeCallback();
          }
        },
        "Измерение величины сигнала",
      );
      this.amplitudeBtn.style.width = "32px";
      this.amplitudeBtn.style.height = "32px";
      this.amplitudeBtn.style.padding = "0";
      this.amplitudeBtn.style.marginLeft = "0";
      this.amplitudeBtn.style.width = "32px";
      this.amplitudeBtn.style.height = "32px";
      this.amplitudeBtn.style.padding = "0";
      this.amplitudeBtn.style.marginLeft = "0";

      //  Автомасштабирование 

    // Левая группа: Свойства → Статус → Кнопка размера → Пуск/Стоп → Заголовок
    const groupLeft = document.createElement("div");
    groupLeft.className = "toolbar-group";

    const title = document.createElement("div");
    title.className = "toolbar-title";

    groupLeft.append(
        this.propertiesBtn,
        this.statusBadge,
        this.windowSizeBtn,
        this.pollingBtn,
        this.autoscaleBtn,
        this.amplitudeBtn,
        title,
      );

    // По умолчанию при старте устанавливаем состояние "Нет связи"
    this.updateStatus(false);

    // Group 2: Controls
    const groupCenter = document.createElement("div");
    groupCenter.className = "toolbar-group";

    // this.autoscaleBtn = ToolbarComponents.createButton(
    //   "📐",
    //   "tool-btn-dark",
    //   () => {
    //     this.settings.autoScale = true;
    //     this.autoscaleBtn.classList.add("active");
    //     if (this.onAutoScaleCallback) {
    //       this.onAutoScaleCallback();
    //     }
    //   },
    //   "Автомасштабирование (Auto-Scale)",
    // );

    this.cursorBtn = ToolbarComponents.createButton(
      "📏",
      this.settings.enableCursors ? "active" : "",
      () => {
        this.settings.enableCursors = !this.settings.enableCursors;
        this.cursorBtn.classList.toggle("active", this.settings.enableCursors);
        const footer = document.getElementById("footer");
        if (footer)
          footer.style.display = this.settings.enableCursors ? "flex" : "none"; //📐
      },
      "Курсоры измерения (Cursors)",
    );

    const sweepIcon = `
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 5h18"/>
                <path d="m6 2-3 3 3 3"/>
                <path d="m18 2 3 3-3 3"/>
                <path d="M3 17h2l2-5 3 10 3-8 2 3h6"/>
            </svg>`;
    this.sweepBtn = ToolbarComponents.createButton(
      sweepIcon,
      "",
      () => {
        const enabled = !this.sweepBtn.classList.contains("active");
        this.sweepBtn.classList.toggle("active", enabled);
        if (this.onToggleTimeZoomCallback) {
          this.onToggleTimeZoomCallback(enabled);
        }
      },
      "Развертка: колесо мыши над графиками растягивает / сжимает их по времени",
    );
    this.sweepBtn.style.width = "64px";

    groupCenter.append(this.cursorBtn, this.sweepBtn);

    // Правая группа: Экспорт
    const groupRight = document.createElement("div");
    groupRight.className = "toolbar-group";

    this.exportBtn = ToolbarComponents.createButton(
      "💾",
      "",
      () => {
        window.dispatchEvent(new CustomEvent("oscilloscope-export-csv"));
      },
      "Экспорт CSV",
    );

    groupRight.append(this.exportBtn);

    this.container.append(groupLeft, groupCenter, groupRight);

    // Подписка на изменение состояния от модуля Serial
    this.serial.onStateChange((state: unknown) => {
      const isConnected = state === "connected" || state === true;
      this.updateStatus(isConnected);
    });
  }

  public updateStatus(isConnected: boolean): void {
    this.statusBadge.removeAttribute("title");

    if (isConnected) {
      this.statusBadge.className = "status-badge connected";
      this.statusBadge.textContent = "Подключено";
    } else {
      this.statusBadge.className = "status-badge disconnected";
      this.statusBadge.textContent = "Нет связи";
    }
  }

  public updateRecordTimer(): void {
    // Оставлен для сохранения интерфейса
  }

      private onToggleAmplitudeModeCallback?: () => void;

    public onToggleAmplitudeMode(cb: () => void): void {
        this.onToggleAmplitudeModeCallback = cb;
    }

        public setAmplitudeModeButtonState(isActive: boolean): void {
        this.amplitudeBtn.classList.toggle("active", isActive);
    }

    public updatePollingButtonState(): void {
        const playIcon = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
            </svg>`;
        const pauseIcon = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
            </svg>`;
        
        this.pollingBtn.innerHTML = this.settings.isPolling ? pauseIcon : playIcon;
        this.pollingBtn.classList.toggle("active", this.settings.isPolling);
    }
}
