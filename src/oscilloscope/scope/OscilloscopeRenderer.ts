// src/oscilloscope/scope/OscilloscopeRenderer.ts
// Рендеринг графиков каналов и измерение значений в маркерах.

import type { Application } from "pixi.js";
import type { Channel } from "../core/Channel";
import type { Archive } from "../core/Archive";
import type { Renderer } from "../graphics/Renderer";
import { PixiView } from "../graphics/PixiView";
import type { Table } from "../ui/Table";
import type { Toolbar } from "../ui/Toolbar";
import type { BottomPanels } from "../ui/BottomPanels";
import type { Settings } from "../config/Settings";

export interface RenderingContext {
  visibleChannels: Channel[];
  allChannels: Channel[];
  pixiViews: Map<string, PixiView>;
  pixiApp: Application | null;
  graphColumnOffset: number;
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
  onToggleBit: (ch: Channel) => void;
}

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
      const allAutoScale = ctx.allChannels.every((ch) => ch.autoScale);
      ctx.toolbar.setAutoScaleButtonState(allAutoScale);
      // Могла измениться высота строки или её видимость —
      // пересинхронизируем позиции и размеры контейнеров графиков
      syncViewPositions(ctx);
    };

    row.onDelete = (deletedChannel) => {
      ctx.onChannelDeleted(deletedChannel);
    };

    row.onSelect = (selectedChannel: Channel) => {
      ctx.setSelectedChannel(selectedChannel);
      ctx.bottomPanels.setCommandText(`${selectedChannel.name} = `);
    };

    row.onToggleBit = (toggledChannel: Channel) => {
      ctx.onToggleBit(toggledChannel);
    };

    if (ctx.pixiApp) {
      const pixiView = new PixiView(ctx.pixiApp, 0, 0, 300, channel.rowHeight);
      tempPixiViews.set(channel.id, pixiView);
    }
  }

  if (!ctx.isDestroyed) {
    ctx.pixiViews.clear();
    tempPixiViews.forEach((view, id) => {
      ctx.pixiViews.set(id, view);
    });

    syncViewPositions(ctx);

    requestAnimationFrame(() => {
      ctx.rowsContainer.scrollTop = savedScrollTop;
      syncViewPositions(ctx);
    });
  }
}

/** Позиционирует контейнеры каналов по вертикали с учётом скролла и ширины колонки графиков. */
export function syncViewPositions(ctx: RenderingContext): void {
  const firstRow = ctx.rowsContainer.querySelector(".channel-row");
  const host = ctx.rowsContainer.parentElement as HTMLElement;
  const baseEl = firstRow ?? host.querySelector("#header");
  const graphEl = baseEl ? (baseEl.querySelector(".col-graph") as HTMLElement | null) : null;
  const width = graphEl
    ? Math.max(50, Math.round(graphEl.getBoundingClientRect().width))
    : 300;

  let yOffset = 0;
  const scrollTop = ctx.rowsContainer.scrollTop;
  for (const channel of ctx.visibleChannels) {
    const view = ctx.pixiViews.get(channel.id);
    if (view) {
      view.updateLayout(0, yOffset - scrollTop, width, channel.rowHeight);
    }
    yOffset += channel.rowHeight;
  }
}

/** Навешивает обработчики мыши на общий canvas один раз (без дублирования). */
export function bindSharedCanvasEvents(getCtx: () => RenderingContext): void {
  const initialCtx = getCtx();
  if (!initialCtx.pixiApp) return;
  const canvas = initialCtx.pixiApp.canvas as HTMLCanvasElement;

  let draggingMarker: 1 | 2 | null = null;

  const getGraphRect = (): DOMRect => canvas.getBoundingClientRect();

  const timeFromClientX = (ctx: RenderingContext, clientX: number): number | null => {
    const rect = getGraphRect();
    const x = clientX - rect.left;
    const width = rect.width;
    if (width <= 0) return null;

    const spacing = 40 * ctx.settings.timeScale;
    const duration = (width / spacing) * 1000;
    const currentTime = ctx.settings.getCurrentViewTime();
    const startTime = currentTime - duration;
    return startTime + (x / width) * duration;
  };

  const channelFromClientY = (ctx: RenderingContext, clientY: number): Channel | null => {
    const rect = getGraphRect();
    const y = clientY - rect.top + ctx.rowsContainer.scrollTop;
    let acc = 0;
    for (const ch of ctx.visibleChannels) {
      acc += ch.rowHeight;
      if (y < acc) return ch;
    }
    return null;
  };

  const rerenderAll = (ctx: RenderingContext): void => {
    ctx.pixiViews.forEach((view, id) => {
      const ch = ctx.allChannels.find((c) => c.id === id);
      if (ch) ctx.renderer.renderChannelGraph(ch, view);
    });
  };

  const getMarkerUnderCursor = (ctx: RenderingContext, clientX: number): 1 | 2 | null => {
    if (!ctx.settings.isIntervalMode) return null;
    const rect = getGraphRect();
    const x = clientX - rect.left;
    const width = rect.width;
    if (width <= 0) return null;

    const spacing = 40 * ctx.settings.timeScale;
    const duration = (width / spacing) * 1000;
    const currentTime = ctx.settings.getCurrentViewTime();
    const startTime = currentTime - duration;

    if (ctx.settings.intervalMarker1Time !== null) {
      const marker1X = ((ctx.settings.intervalMarker1Time - startTime) / duration) * width;
      if (Math.abs(x - marker1X) <= 5) return 1;
    }
    if (ctx.settings.intervalMarker2Time !== null) {
      const marker2X = ((ctx.settings.intervalMarker2Time - startTime) / duration) * width;
      if (Math.abs(x - marker2X) <= 5) return 2;
    }
    return null;
  };

  canvas.addEventListener("click", (e: MouseEvent) => {
    const ctx = getCtx();
    const channel = channelFromClientY(ctx, e.clientY);

    if (channel) {
      const row = ctx.table.getRow(channel.id);
      if (row) row.getElement().click();
    }

    if (!ctx.settings.isAmplitudeMode && !ctx.settings.isIntervalMode) return;
    if (
      ctx.settings.isIntervalMode &&
      ctx.settings.intervalMarker1Time !== null &&
      ctx.settings.intervalMarker2Time !== null
    ) {
      return;
    }

    const markerTime = timeFromClientX(ctx, e.clientX);
    if (markerTime === null) return;

    if (ctx.settings.isAmplitudeMode) {
      if (!channel) return;
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

    rerenderAll(ctx);
  });

  canvas.addEventListener("contextmenu", (e: MouseEvent) => {
    const ctx = getCtx();
    const channel = channelFromClientY(ctx, e.clientY);
    if (!channel) return;
    const row = ctx.table.getRow(channel.id);
    if (!row) return;
    e.preventDefault();
    row.getElement().dispatchEvent(
      new MouseEvent("contextmenu", {
        clientX: e.clientX,
        clientY: e.clientY,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  canvas.addEventListener("mousemove", (e: MouseEvent) => {
    if (draggingMarker !== null) return;
    const ctx = getCtx();
    const marker = getMarkerUnderCursor(ctx, e.clientX);
    canvas.style.cursor = marker !== null ? "ew-resize" : "";
  });

  canvas.addEventListener("mousedown", (e: MouseEvent) => {
    const ctx = getCtx();
    if (!ctx.settings.isIntervalMode) return;
    if (
      ctx.settings.intervalMarker1Time === null ||
      ctx.settings.intervalMarker2Time === null
    ) {
      return;
    }
    const marker = getMarkerUnderCursor(ctx, e.clientX);
    if (marker !== null) {
      draggingMarker = marker;
      e.preventDefault();
    }
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (draggingMarker === null) return;
    const ctx = getCtx();

    const markerTime = timeFromClientX(ctx, e.clientX);
    if (markerTime === null) return;

    if (draggingMarker === 1) {
      ctx.settings.intervalMarker1Time = markerTime;
    } else {
      ctx.settings.intervalMarker2Time = markerTime;
    }
    updateIntervalDisplay(ctx);
    rerenderAll(ctx);
  });

  document.addEventListener("mouseup", () => {
    if (draggingMarker !== null) {
      draggingMarker = null;
      canvas.style.cursor = "";
    }
  });

  canvas.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      const ctx = getCtx();
      e.preventDefault();

      const forwarded = new WheelEvent("wheel", {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        bubbles: true,
        cancelable: true,
      });
      ctx.rowsContainer.dispatchEvent(forwarded);

      // Синтетическое событие не вызывает нативный скролл,
      // поэтому скроллим вручную, если обработчик зума не перехватил событие
      if (!forwarded.defaultPrevented) {
        ctx.rowsContainer.scrollTop += e.deltaY;
        ctx.rowsContainer.scrollLeft += e.deltaX;
      }
    },
    { passive: false },
  );
}