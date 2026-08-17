// src/oscilloscope/scope/OscilloscopeBindings.ts
// Привязка событий UI и обновление индикаторов.

import type { Channel } from "../core/Channel";
import type { Settings } from "../config/Settings";
import type { Toolbar } from "../ui/Toolbar";
import type { Serial } from "../comm/Serial";
import type { IniPanel, IniFileItem } from "../ui/IniPanel";
import type { Recorder } from "../core/Recorder";
import type { CursorsFooter } from "../ui/CursorsFooter";
import type { BottomPanels } from "../ui/BottomPanels";
import type { Renderer } from "../graphics/Renderer";
import type { PixiView } from "../graphics/PixiView";
import type { PropertiesModal } from "../ui/PropertiesModal";
import type { CommandContext } from "./OscilloscopeCommands";
import { handleCommandSubmit, handleMultiplyCommand } from "./OscilloscopeCommands";

export interface BindingsContext {
  settings: Settings;
  getChannels: () => Channel[];
  getVisibleChannels: () => Channel[];
  pixiViews: Map<string, PixiView>;
  propertiesModal: PropertiesModal;
  splitContainer: HTMLElement | null;
  toolbar: Toolbar;
  serial: Serial;
  iniPanel: IniPanel;
  recorder: Recorder;
  cursorsFooter: CursorsFooter;
  bottomPanels: BottomPanels;
  renderer: Renderer;
  isDestroyed: boolean;
  notifyPollingStateChange: (isPolling: boolean) => void;
  updateVisibleChannels: (newVisible: Channel[]) => Promise<void>;
  loadIniContent: (content: string) => Promise<void>;
  setConnectionStatus: (connected: boolean, message?: string) => void;
  getCommandContext: () => CommandContext;
}

export function bindEvents(ctx: BindingsContext): void {
  ctx.toolbar.onOpenProperties(() => {
    ctx.propertiesModal.open(ctx.getChannels(), ctx.getVisibleChannels());
  });

  ctx.toolbar.onToggleWindowSize((isHalf) => {
    if (ctx.splitContainer) {
      const viewport = ctx.splitContainer.parentElement;
      const oscContainer = document.querySelector("#osc-container");

      if (isHalf) {
        ctx.splitContainer.classList.add("half-window-left");
        ctx.splitContainer.classList.remove("full-window");
        if (viewport) viewport.classList.remove("full-window");
        if (oscContainer) oscContainer.classList.remove("full-window");
      } else {
        ctx.splitContainer.classList.remove("half-window-left");
        ctx.splitContainer.classList.add("full-window");
        if (viewport) viewport.classList.add("full-window");
        if (oscContainer) oscContainer.classList.add("full-window");
      }
    }
  });

  ctx.propertiesModal.onApply((newVisible) => {
    ctx.updateVisibleChannels(newVisible);
    const allAutoScale = ctx.getChannels().every((ch) => ch.autoScale);
    ctx.toolbar.setAutoScaleButtonState(allAutoScale);
  });

  ctx.serial.onStateChange((state, msg) => {
    if (state === "error") {
      ctx.setConnectionStatus(false, msg || "Связь с устройством потеряна.");
    } else if (state === "connected") {
      ctx.setConnectionStatus(true);
    }
  });

  ctx.iniPanel.onFileSelect((fileItem: IniFileItem) => {
    if (ctx.isDestroyed) return;
    ctx.loadIniContent(fileItem.content);
  });

  window.addEventListener("oscilloscope-export-csv", () => {
    ctx.recorder.downloadCSV(ctx.getVisibleChannels());
  });

  ctx.toolbar.onToggleTimeZoom((enabled) => {
    ctx.settings.timeZoomEnabled = enabled;
  });

  ctx.toolbar.onTogglePolling((isPolling) => {
    console.log("[Bindings] onTogglePolling вызван с isPolling =", isPolling);
    
    // СПЕЦИАЛЬНАЯ ЛОГИКА: Если активен режим измерения и нажали ПУСК
    if (ctx.settings.isAmplitudeMode && isPolling) {
      console.log("[Bindings] Аварийный выход из режима измерения через кнопку Пуск");
      ctx.settings.isAmplitudeMode = false;
      ctx.settings.amplitudeMarkerTime = null;
      ctx.cursorsFooter.setAmplitudeTime(null);
      ctx.toolbar.setAmplitudeModeButtonState(false);

      ctx.settings.isPolling = true;
      ctx.serial.resumePolling();
      ctx.settings.followLive();
      ctx.toolbar.updatePollingButtonState();

      ctx.notifyPollingStateChange(true);
      return;
    }

    // Если нажали СТОП во время измерения - игнорируем (опрос и так на паузе)
    if (ctx.settings.isAmplitudeMode && !isPolling) {
      console.log("[Bindings] Игнорируем Стоп, так как активен режим измерения");
      return;
    }

    // Стандартная логика переключения Пуск/Стоп
    if (isPolling) {
      ctx.serial.resumePolling();
      ctx.settings.followLive();
    } else {
      console.log("[Bindings] Вызов pausePolling и freezeTime");
      ctx.serial.pausePolling();
      ctx.settings.freezeTime();
    }
    
    console.log("[Bindings] Уведомление main.ts об изменении isPolling на:", isPolling);
    ctx.notifyPollingStateChange(isPolling);
  });

  ctx.toolbar.onAutoScale(() => {
    console.log("[Bindings] Кнопка Автомасштаб нажата");
    const channels = ctx.getChannels();
    console.log(`[Bindings] channels.length = ${channels.length}`);
    
    if (channels.length === 0) {
      console.warn("[Bindings] ВНИМАНИЕ: channels пустой!");
    }
    
    channels.forEach((ch) => {
      console.log(`[Bindings] Устанавливаем autoScale=true для канала ${ch.name}`);
      ch.autoScale = true;
    });
    const allAutoScale = channels.every((ch) => ch.autoScale);
    console.log(`[Bindings] allAutoScale = ${allAutoScale}`);
    ctx.toolbar.setAutoScaleButtonState(allAutoScale);
  });

  ctx.toolbar.onToggleAmplitudeMode(() => {
    if (ctx.settings.isAmplitudeMode) {
      // === ВЫХОД ИЗ РЕЖИМА ===
      ctx.settings.isAmplitudeMode = false;
      ctx.settings.amplitudeMarkerTime = null;
      ctx.bottomPanels.setReadout(2, "");
      ctx.toolbar.setAmplitudeModeButtonState(false);

      if (ctx.settings.wasPollingBeforeMeasure) {
        ctx.settings.isPolling = true;
        ctx.serial.resumePolling();
        ctx.settings.followLive();
        ctx.toolbar.updatePollingButtonState();

        ctx.notifyPollingStateChange(true);
      }
    } else {
      // === ВХОД В РЕЖИМ ===
      console.log("[Bindings] Вход в режим измерения. Остановка опроса.");
      ctx.settings.wasPollingBeforeMeasure = ctx.settings.isPolling;
      ctx.settings.isPolling = false;
      
      console.log("[Bindings] Вызов ctx.serial.pausePolling()");
      ctx.serial.pausePolling();
      ctx.settings.freezeTime();
      
      ctx.toolbar.updatePollingButtonState();
      ctx.notifyPollingStateChange(false);

      ctx.settings.isAmplitudeMode = true;

      const firstView = ctx.pixiViews.values().next().value;
      const width = firstView ? firstView.bounds.width : 800;
      const spacing = 40 * ctx.settings.timeScale;
      const duration = (width / spacing) * 1000;

      const now = ctx.settings.getCurrentViewTime();
      ctx.settings.amplitudeMarkerTime = now - duration / 2;

      ctx.toolbar.setAmplitudeModeButtonState(true);
      ctx.cursorsFooter.setAmplitudeTime(ctx.settings.amplitudeMarkerTime);
    }
  });

  ctx.toolbar.onToggleIntervalMode(() => {
    if (ctx.settings.isIntervalMode) {
      ctx.settings.isIntervalMode = false;
      ctx.settings.intervalMarker1Time = null;
      ctx.settings.intervalMarker2Time = null;
      ctx.toolbar.setIntervalModeButtonState(false);
      ctx.bottomPanels.setReadout(1, "");

      if (ctx.settings.wasPollingBeforeInterval) {
        ctx.settings.isPolling = true;
        ctx.serial.resumePolling();
        ctx.settings.followLive();
        ctx.toolbar.updatePollingButtonState();

        ctx.notifyPollingStateChange(true);
      }

      ctx.getVisibleChannels().forEach((ch) => {
        const v = ctx.pixiViews.get(ch.id);
        if (v) {
          ctx.renderer.renderChannelGraph(ch, v);
        }
      });
    } else {
      ctx.settings.wasPollingBeforeInterval = ctx.settings.isPolling;
      ctx.settings.isIntervalMode = true;
      ctx.settings.intervalMarker1Time = null;
      ctx.settings.intervalMarker2Time = null;
      ctx.toolbar.setIntervalModeButtonState(true);

      ctx.getVisibleChannels().forEach((ch) => {
        const v = ctx.pixiViews.get(ch.id);
        if (v) {
          ctx.renderer.renderChannelGraph(ch, v);
        }
      });
    }
  });

  ctx.bottomPanels.onCommandSubmit((text) => {
    void handleCommandSubmit(ctx.getCommandContext(), text);
  });

  ctx.bottomPanels.onMultiplyCommand(() => {
    const cmdCtx = ctx.getCommandContext();
    void handleMultiplyCommand(cmdCtx, (t) => handleCommandSubmit(cmdCtx, t));
  });
}

export function bindTimeZoomWheel(ctx: BindingsContext, rowsContainer: HTMLElement): void {
  rowsContainer.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      if (!ctx.settings.timeZoomEnabled) return;
      const target = e.target as HTMLElement;
      if (!target.closest(".col-graph")) return;
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      ctx.settings.setTimeScale(ctx.settings.timeScale * factor);
      updateTimeScaleReadout(ctx);
    },
    { passive: false }
  );
  updateTimeScaleReadout(ctx);
}

export function updateTimeScaleReadout(ctx: BindingsContext): void {
  ctx.bottomPanels.setReadout(3, `${Math.round(ctx.settings.timeScale * 100)}%`);
}

export function updateCursorsFooter(ctx: BindingsContext): void {
  ctx.cursorsFooter.update(
    ctx.settings.cursorX1Percent,
    ctx.settings.cursorX2Percent,
    ctx.settings.timeWindowMs
  );
}