// src/oscilloscope/ui/Toolbar.ts

import { Settings } from "../config/Settings";
import { Recorder } from "../core/Recorder";
import { Serial } from "../comm/Serial";
import { ToolbarComponents } from "./ToolbarComponents";

export class Toolbar {
  private container: HTMLElement;
  private settings: Settings;
  private recorder: Recorder | null;
  private serial: Serial | null;

  private autoscaleBtn!: HTMLButtonElement;
  private amplitudeBtn!: HTMLButtonElement;
  private intervalBtn!: HTMLButtonElement;
  private recBtn!: HTMLButtonElement;
  private recArrowBtn!: HTMLButtonElement;
  private recMenu!: HTMLDivElement;
  private recGroup!: HTMLDivElement;
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
  private onAutoScaleCallback?: () => void;
  private onToggleAmplitudeModeCallback?: () => void;
  private onToggleIntervalModeCallback?: () => void;
  private onToggleRecCallback?: () => void;
  private onRecordFullBufferCallback?: () => void;
  

    constructor(
    container: HTMLElement,
    settings: Settings,
    recorder: Recorder | null,
    serial: Serial | null,
  ) {
    this.container = container;
    this.settings = settings;
    this.recorder = recorder;
    this.serial = serial;

    // Закрываем меню режимов записи при клике вне кнопки REC
    document.addEventListener("click", (e) => {
      if (this.recGroup && this.recMenu && !this.recGroup.contains(e.target as Node)) {
        this.recMenu.style.display = "none";
      }
    });
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
  public onAutoScale(cb: () => void): void {
    this.onAutoScaleCallback = cb;
  }
  public onToggleAmplitudeMode(cb: () => void): void {
    this.onToggleAmplitudeModeCallback = cb;
  }
    public onToggleRec(cb: () => void): void {
    this.onToggleRecCallback = cb;
  }
  public onRecordFullBuffer(cb: () => void): void {
    this.onRecordFullBufferCallback = cb;
  }
  public onToggleIntervalMode(cb: () => void): void {
    this.onToggleIntervalModeCallback = cb;
  }

  /** Скрывает кнопки, не нужные в режиме просмотра .rec */
  public applyViewerMode(): void {
    this.recGroup.style.display = 'none';
    this.pollingBtn.style.display = 'none';
    this.intervalBtn.style.display = 'none';
    this.statusBadge.style.display = 'none';
    this.windowSizeBtn.style.display = 'none';
  }

  /** Финальная настройка тулбара для просмотрщика (вызывать ПОСЛЕ добавления всех кнопок) */
  public finalizeViewerLayout(): void {
    // Все кнопки — слева друг за другом
    this.container.style.display = 'flex';
    this.container.style.justifyContent = 'flex-start';
    Array.from(this.container.children).forEach((child) => {
      (child as HTMLElement).style.marginLeft = '0';
    });
    this.container
      .querySelectorAll('button')
      .forEach((b) => this.styleViewerButton(b as HTMLElement));

    // Перемещаем в конец по частичному совпадению текста или title
    this.moveButtonToEnd('Экспорт');
    this.moveButtonToEnd('Закрыть');
  }

  /** Перемещает кнопку, если её текст или title содержит указанную строку */
  private moveButtonToEnd(match: string): void {
    const buttons = this.container.querySelectorAll('button');
    buttons.forEach((btn) => {
      const text = btn.textContent?.trim() || '';
      const title = btn.getAttribute('title') || '';
      if (text.includes(match) || title.includes(match)) {
        this.container.appendChild(btn); // appendChild перемещает существующий элемент в конец
      }
    });
  }

  /** Кнопка: ширина = 2 * высоты, без прижима вправо */
  private styleViewerButton(btn: HTMLElement): void {
    const H = 28;
    btn.style.height = `${H}px`;
    btn.style.width = `${H * 2}px`;
    btn.style.marginLeft = '0';
    btn.style.flex = '0 0 auto';
  }

  /** Добавляет свою кнопку в тулбар (для файловых операций в просмотрщике) */
  public appendCustomButton(label: string, title: string, onClick: () => void): HTMLElement {
    const btn = ToolbarComponents.createButton(label, 'tool-btn', onClick, title);
    this.container.appendChild(btn);
    this.styleViewerButton(btn);
    return btn;
  }

  public setAutoScaleButtonState(isActive: boolean): void {
    this.settings.autoScale = isActive;
    this.autoscaleBtn.classList.toggle("active", isActive);
  }

  public setAmplitudeModeButtonState(isActive: boolean): void {
    this.amplitudeBtn.classList.toggle("active", isActive);
  }

  public setIntervalModeButtonState(isActive: boolean): void {
    this.intervalBtn.classList.toggle("active", isActive);
  }

  public setRecButtonState(isRecording: boolean): void {
    this.recBtn.classList.toggle("active", isRecording);
    this.recBtn.style.color = isRecording ? "#ef4444" : "";
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

  public initialize(): void {
    this.container.innerHTML = "";

    this.propertiesBtn = ToolbarComponents.createButton(
      `⚙`,
      "icon-btn osc-btn-properties",
      () => {
        if (this.onOpenPropertiesCallback) this.onOpenPropertiesCallback();
      },
      "Свойства",
    );
    this.propertiesBtn.style.width = "64px";
    this.propertiesBtn.style.height = "32px";

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
    this.windowSizeBtn.style.backgroundColor = "#ffdc18";



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
        this.pollingBtn.innerHTML = this.settings.isPolling ? pauseIcon : playIcon;
        this.pollingBtn.classList.toggle("active", this.settings.isPolling);
        if (this.onTogglePollingCallback) {
          this.onTogglePollingCallback(this.settings.isPolling);
        }
      },
      "Пуск/Стоп опроса контроллера",
    );
    this.pollingBtn.style.width = "32px";
    this.pollingBtn.style.height = "32px";
    this.pollingBtn.style.padding = "0";
    this.pollingBtn.style.marginLeft = "0"; 

    this.autoscaleBtn = ToolbarComponents.createButton(
      "",
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
    this.autoscaleBtn.style.backgroundColor = "#773910";

    this.amplitudeBtn = ToolbarComponents.createButton(
      "📏",
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
    this.amplitudeBtn.style.backgroundColor = "#12aaaf";
    
    this.intervalBtn = ToolbarComponents.createButton(
      "T",
      "tool-btn-dark",
      () => {
        if (this.onToggleIntervalModeCallback) {
          this.onToggleIntervalModeCallback();
        }
      },
      "Измерение временных интервалов",
    );
    this.intervalBtn.style.width = "32px";
    this.intervalBtn.style.height = "32px";
    this.intervalBtn.style.padding = "0";
    this.intervalBtn.style.marginLeft = "0";
    this.intervalBtn.style.backgroundColor = "#3244e7";

        // === REC: split-кнопка с раскрывающимся меню режимов ===
    this.recGroup = document.createElement("div");
    this.recGroup.style.position = "relative";
    this.recGroup.style.display = "inline-flex";
    this.recGroup.style.alignItems = "center";

    this.recBtn = ToolbarComponents.createButton(
      "⏺",
      "tool-btn-dark",
      () => {
        if (this.onToggleRecCallback) {
          this.onToggleRecCallback();
        }
      },
      "Записать выделенный буфер",
    );
    this.recBtn.style.width = "32px";
    this.recBtn.style.height = "32px";
    this.recBtn.style.padding = "0";
    this.recBtn.style.marginLeft = "0";
    this.recBtn.style.backgroundColor = "#e7e432";
    this.recBtn.style.borderRight = "none";
    this.recBtn.style.borderTopRightRadius = "0";
    this.recBtn.style.borderBottomRightRadius = "0";

    // Разделитель между основной частью и треугольником (как на скриншоте)
    const recSeparator = document.createElement("div");
    recSeparator.style.width = "5px";
    recSeparator.style.height = "32px";
    recSeparator.style.flex = "0 0 auto";
    recSeparator.style.backgroundColor = "#e7e432";
    recSeparator.style.display = "flex";
    recSeparator.style.alignItems = "center";
    recSeparator.style.justifyContent = "center";

    const recSeparatorLine = document.createElement("div");
    recSeparatorLine.style.width = "2px";
    recSeparatorLine.style.height = "20px";
    recSeparatorLine.style.backgroundColor = "rgba(0, 0, 0, 0.65)";
    recSeparator.append(recSeparatorLine);

    this.recArrowBtn = ToolbarComponents.createButton(
      "▼",
      "tool-btn-dark",
      () => {
        this.recMenu.style.display =
          this.recMenu.style.display === "block" ? "none" : "block";
      },
      "Режимы записи",
    );
    this.recArrowBtn.style.width = "16px";
    this.recArrowBtn.style.height = "32px";
    this.recArrowBtn.style.padding = "0";
    this.recArrowBtn.style.marginLeft = "0";
    this.recArrowBtn.style.fontSize = "8px";
    this.recArrowBtn.style.color = "#000";
    this.recArrowBtn.style.backgroundColor = "#e7e432";
    this.recArrowBtn.style.borderLeft = "none";
    this.recArrowBtn.style.borderTopLeftRadius = "0";
    this.recArrowBtn.style.borderBottomLeftRadius = "0";

    this.recMenu = document.createElement("div");
    this.recMenu.style.display = "none";
    this.recMenu.style.position = "absolute";
    this.recMenu.style.top = "100%";
    this.recMenu.style.left = "0";
    this.recMenu.style.marginTop = "2px";
    this.recMenu.style.minWidth = "210px";
    this.recMenu.style.backgroundColor = "#1c1f16";
    this.recMenu.style.border = "1px solid #3a3f2e";
    this.recMenu.style.borderRadius = "4px";
    this.recMenu.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.5)";
    this.recMenu.style.zIndex = "1000";
    this.recMenu.style.padding = "4px 0";

    const recMenuItemSelected = document.createElement("div");
    recMenuItemSelected.textContent = "Записать выделенный буфер";

    const recMenuItemFull = document.createElement("div");
    recMenuItemFull.textContent = "Записать весь буфер";

    const styleRecMenuItem = (el: HTMLDivElement): void => {
      el.style.padding = "6px 12px";
      el.style.fontSize = "12px";
      el.style.color = "#e8e8e8";
      el.style.cursor = "pointer";
      el.style.whiteSpace = "nowrap";
      el.addEventListener("mouseenter", () => {
        el.style.backgroundColor = "#3a3f2e";
      });
      el.addEventListener("mouseleave", () => {
        el.style.backgroundColor = "transparent";
      });
    };
    styleRecMenuItem(recMenuItemSelected);
    styleRecMenuItem(recMenuItemFull);

    // Пункт по умолчанию: то же действие, что и основная кнопка
    recMenuItemSelected.addEventListener("click", () => {
      this.recMenu.style.display = "none";
      if (this.onToggleRecCallback) {
        this.onToggleRecCallback();
      }
    });

    // Пункт "Записать весь буфер": логика будет подключена следующим этапом
    recMenuItemFull.addEventListener("click", () => {
      this.recMenu.style.display = "none";
      if (this.onRecordFullBufferCallback) {
        this.onRecordFullBufferCallback();
      }
    });

    this.recMenu.append(recMenuItemSelected, recMenuItemFull);
    this.recGroup.append(this.recBtn, recSeparator, this.recArrowBtn, this.recMenu);

    // === Кнопка "Развертка" (добавляем прямо в groupLeft) ===
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
      "Развертка",
    );
    this.sweepBtn.style.width = "64px";

    // === Кнопка "Экспорт CSV" (тоже добавляем в groupLeft) ===
    this.exportBtn = ToolbarComponents.createButton(
      "💾",
      "",
      () => {
        window.dispatchEvent(new CustomEvent("oscilloscope-export-csv"));
      },
      "Экспорт CSV",
    );

    const groupLeft = document.createElement("div");
    groupLeft.className = "toolbar-group";

    const title = document.createElement("div");
    title.className = "toolbar-title";

    // Добавляем ВСЕ кнопки в одну группу: groupLeft
    groupLeft.append(
      this.propertiesBtn,
      this.statusBadge,
      this.windowSizeBtn,
      this.pollingBtn,
      this.autoscaleBtn,
      this.amplitudeBtn,
      this.intervalBtn,
      this.recGroup,
      this.sweepBtn,
      this.exportBtn,
      title,
    );

    this.updateStatus(false);

    // Добавляем только одну группу в контейнер
    this.container.append(groupLeft);

    this.serial?.onStateChange((state: unknown) => {
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
}