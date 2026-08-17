// src/oscilloscope/scope/OscilloscopeRenderer.ts
// Рендеринг графиков каналов и измерение значений в маркерах.

import type { Channel } from "../core/Channel";
import type { Archive } from "../core/Archive";
import type { Renderer } from "../graphics/Renderer";
import { PixiView } from "../graphics/PixiView";
import type { Table } from "../ui/Table";
import type { Toolbar } from "../ui/Toolbar";
import type { BottomPanels } from "../ui/BottomPanels";
import type { Settings } from "../config/Settings";

/** Контекст для рендеринга каналов */
export interface RenderingContext {
  visibleChannels: Channel[];
  allChannels: Channel[];
  pixiViews: Map<string, PixiView>;
  table: Table;
  renderer: Renderer;
  archive: Archive;
  settings: Settings;
  rowsContainer: HTMLElement;
  bottomPanels: BottomPanels;
  toolbar: Toolbar;
  isDestroyed: boolean;
  selectedChannel: Channel | null;
  setSelectedChannel: (ch: Channel | null) => void;
  onChannelDeleted: (ch: Channel) => void;
  onToggleBit: (ch: Channel) => void; // <-- Исправлено: добавлен проброс
}

/**
 * Измеряет значение канала в указанный момент времени и отображает его в таблице.
 */
export function measureChannelAtTime(
  ctx: RenderingContext,
  channelId: string,
  timeMs: number,
): void {
  const channel = ctx.allChannels.find((c) => c.id === channelId);
  if (!channel) return;

  let rawValue: number;
  if (channel.isBit) {
    const stepValue = ctx.archive.getStepValueAtTime(channelId, timeMs);
    if (stepValue === null) return;
    rawValue = stepValue > 0 ? 1 : 0;
  } else {
    const physicalValue = ctx.archive.getValueAtTime(channelId, timeMs);
    if (physicalValue === null) return;
    rawValue =
      channel.scale !== 0
        ? Math.round(physicalValue / channel.scale)
        : Math.round(physicalValue);
  }

  channel.updateRawValue(rawValue);

  const allRows = ctx.table.getAllRows();
  allRows.forEach((row) => row.getElement().classList.remove("selected"));

  const targetRow = ctx.table.getRow(channelId);
  if (targetRow) {
    targetRow.getElement().classList.add("selected");
    targetRow.updateValue();
  }

  ctx.setSelectedChannel(channel);
  ctx.bottomPanels.setCommandText(`${channel.name} = `);
}

/**
 * Форматирует длительность интервала в формат ЧЧ:ММ:СС.дсс
 */
export function formatIntervalDuration(timeMs: number): string {
  const absMs = Math.abs(timeMs);
  const totalSeconds = Math.floor(absMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = Math.floor(absMs % 1000);

  const hStr = String(hours).padStart(2, "0");
  const mStr = String(minutes).padStart(2, "0");
  const sStr = String(seconds).padStart(2, "0");
  const msStr = String(milliseconds).padStart(3, "0");

  return `${hStr}:${mStr}:${sStr}.${msStr}`;
}

/**
 * Обновляет отображение длительности интервала в подвале.
 */
export function updateIntervalDisplay(ctx: RenderingContext): void {
  if (
    ctx.settings.intervalMarker1Time !== null &&
    ctx.settings.intervalMarker2Time !== null
  ) {
    const durationMs =
      ctx.settings.intervalMarker2Time - ctx.settings.intervalMarker1Time;
    const formatted = formatIntervalDuration(durationMs);
    ctx.bottomPanels.setReadout(1, formatted);
  } else if (ctx.settings.intervalMarker1Time !== null) {
    ctx.bottomPanels.setReadout(1, "—");
  } else {
    ctx.bottomPanels.setReadout(1, "");
  }
}

/**
 * Рендерит графики всех видимых каналов с обработчиками взаимодействия.
 */
export async function renderVisibleChannels(
  ctx: RenderingContext,
): Promise<void> {
  if (ctx.isDestroyed || !ctx.table) return;

  ctx.pixiViews.forEach((view) => {
    try {
      view.destroy();
    } catch (err) {
      console.warn("[Oscilloscope] Failed to destroy old PixiView:", err);
    }
  });

  ctx.pixiViews.clear();
  const tempPixiViews: Map<string, PixiView> = new Map();

  const savedScrollTop = ctx.rowsContainer.scrollTop;

  ctx.table.clear();
  for (const channel of ctx.visibleChannels) {
    if (ctx.isDestroyed) break;
    const row = ctx.table.addChannel(channel);

    row.onChannelUpdated = () => {
      if (ctx.settings.enableCursors) {
        // updateCursorsFooter will be called from main loop
      }
      const allAutoScale = ctx.allChannels.every((ch) => ch.autoScale);
      ctx.toolbar.setAutoScaleButtonState(allAutoScale);
    };

    row.onDelete = (deletedChannel) => {
      ctx.onChannelDeleted(deletedChannel);
    };

    row.onSelect = (selectedChannel: Channel) => {
      ctx.setSelectedChannel(selectedChannel);
      ctx.bottomPanels.setCommandText(`${selectedChannel.name} = `);
    };

    // <-- Исправлено: теперь корректно вызывает переданный извне обработчик
    row.onToggleBit = (toggledChannel: Channel) => {
      ctx.onToggleBit(toggledChannel);
    };

    const container = row.getGraphContainer();
    if (container) {
      const pixiView = new PixiView(container);
      try {
        await pixiView.init();

        pixiView.canvas.addEventListener("click", (e: MouseEvent) => {
          console.log(
            "[OscilloscopeRenderer] Canvas click. Amplitude:",
            ctx.settings.isAmplitudeMode,
            "Interval:",
            ctx.settings.isIntervalMode
          );

          if (!ctx.settings.isAmplitudeMode && !ctx.settings.isIntervalMode)
            return;

          if (
            ctx.settings.isIntervalMode &&
            ctx.settings.intervalMarker1Time !== null &&
            ctx.settings.intervalMarker2Time !== null
          ) {
            return;
7          }

          const rect = pixiView.canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const width = rect.width;

          if (width <= 0) return;

          const spacing = 40 * ctx.settings.timeScale;
          const duration = (width / spacing) * 1000;

          const currentTime = ctx.settings.getCurrentViewTime();
          const startTime = currentTime - duration;

          const markerTime = startTime + (x / width) * duration;
          console.log("[OscilloscopeRenderer] Calculated markerTime:", markerTime);

          if (ctx.settings.isAmplitudeMode) {
            ctx.settings.amplitudeMarkerTime = markerTime;

            const date = new Date(markerTime);
            const day = String(date.getDate()).padStart(2, "0");
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const year = String(date.getFullYear()).slice(-2);
            const hours = String(date.getHours()).padStart(2, "0");
            const minutes = String(date.getMinutes()).padStart(2, "0");
            const seconds = String(date.getSeconds()).padStart(2, "0");
            const formattedTime = `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;

            ctx.bottomPanels.setReadout(2, formattedTime);

            measureChannelAtTime(ctx, channel.id, markerTime);
          }

          if (ctx.settings.isIntervalMode) {
            if (ctx.settings.intervalMarker1Time === null) {
              ctx.settings.intervalMarker1Time = markerTime;
            } else if (ctx.settings.intervalMarker2Time === null) {
              if (markerTime !== ctx.settings.intervalMarker1Time) {
                ctx.settings.intervalMarker2Time = markerTime;
              }
            }

            updateIntervalDisplay(ctx);
          }

          // Принудительная перерисовка всех графиков
          ctx.visibleChannels.forEach((ch) => {
            const v = ctx.pixiViews.get(ch.id);
            if (v) {
              ctx.renderer.renderChannelGraph(ch, v);
            }
          });
        });

        let draggingMarker: 1 | 2 | null = null;

        const getMarkerUnderCursor = (clientX: number): 1 | 2 | null => {
          if (!ctx.settings.isIntervalMode) return null;

          const rect = pixiView.canvas.getBoundingClientRect();
          const x = clientX - rect.left;
          const width = rect.width;
          if (width <= 0) return null;

          const spacing = 40 * ctx.settings.timeScale;
          const duration = (width / spacing) * 1000;
          const currentTime = ctx.settings.getCurrentViewTime();
          const startTime = currentTime - duration;

          if (ctx.settings.intervalMarker1Time !== null) {
            const marker1X =
              ((ctx.settings.intervalMarker1Time - startTime) / duration) *
              width;
            if (Math.abs(x - marker1X) <= 5) {
              return 1;
            }
          }

          if (ctx.settings.intervalMarker2Time !== null) {
            const marker2X =
              ((ctx.settings.intervalMarker2Time - startTime) / duration) *
              width;
            if (Math.abs(x - marker2X) <= 5) {
              return 2;
            }
          }

          return null;
        };

        pixiView.canvas.addEventListener("mousemove", (e: MouseEvent) => {
          if (draggingMarker !== null) return;

          const marker = getMarkerUnderCursor(e.clientX);
          if (marker !== null) {
            pixiView.canvas.style.cursor = "ew-resize";
          } else {
            pixiView.canvas.style.cursor = "";
          }
        });

        pixiView.canvas.addEventListener("mousedown", (e: MouseEvent) => {
          if (!ctx.settings.isIntervalMode) return;
          if (
            ctx.settings.intervalMarker1Time === null ||
            ctx.settings.intervalMarker2Time === null
          )
            return;

          const marker = getMarkerUnderCursor(e.clientX);
          if (marker !== null) {
            draggingMarker = marker;
            e.preventDefault();
          }
        });

        const globalMouseMove = (e: MouseEvent) => {
          if (draggingMarker === null) return;

          const rect = pixiView.canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const width = rect.width;
          if (width <= 0) return;

          const spacing = 40 * ctx.settings.timeScale;
          const duration = (width / spacing) * 1000;
          const currentTime = ctx.settings.getCurrentViewTime();
          const startTime = currentTime - duration;

          const markerTime = startTime + (x / width) * duration;

          if (draggingMarker === 1) {
            ctx.settings.intervalMarker1Time = markerTime;
          } else {
            ctx.settings.intervalMarker2Time = markerTime;
          }

          updateIntervalDisplay(ctx);

          ctx.visibleChannels.forEach((ch) => {
            const v = ctx.pixiViews.get(ch.id);
            if (v) {
              ctx.renderer.renderChannelGraph(ch, v);
            }
          });
        };

        const globalMouseUp = () => {
          if (draggingMarker !== null) {
            draggingMarker = null;
            pixiView.canvas.style.cursor = "";
          }
        };

        document.addEventListener("mousemove", globalMouseMove);
        document.addEventListener("mouseup", globalMouseUp);

        tempPixiViews.set(channel.id, pixiView);
      } catch (err) {
        console.warn(
          `[Oscilloscope] PixiView init failed for channel ${channel.id}:`,
          err,
        );
      }
    }
  }

  if (!ctx.isDestroyed) {
    ctx.pixiViews.clear();
    tempPixiViews.forEach((view, id) => {
      ctx.pixiViews.set(id, view);
    });

    requestAnimationFrame(() => {
      ctx.rowsContainer.scrollTop = savedScrollTop;
    });
  }
}