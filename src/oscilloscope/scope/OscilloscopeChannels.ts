// src/oscilloscope/scope/OscilloscopeChannels.ts
// ============================================================================
// Каналы: функции, вынесенные из класса Oscilloscope.
// Пока только setChannels (проверена экспериментом в том же файле).
// ============================================================================

import type { Oscilloscope } from "../Oscilloscope";
import type { Channel } from "../core/Channel.js";
import type { IniFileItem } from "../ui/IniPanel";
import {
  renderVisibleChannels,
  syncViewPositions,
} from "./OscilloscopeRenderer";
import {
  updateGraphColumnOffset as canvasUpdateOffset,
} from "./OscilloscopeCanvas";

export async function setChannels(osc: Oscilloscope, newChannels: Channel[]): Promise<void> {
  if (osc.isDestroyed) return;
  console.log(`[Oscilloscope] Setting channels: ${newChannels.length}`);
  console.log(`[DIAG] Before: allChannels=${osc.allChannels.length}, visibleChannels=${osc.visibleChannels.length}`);
  osc.allChannels = Array.isArray(newChannels) ? newChannels : [];
  osc.visibleChannels = [...osc.allChannels];
  try {
    osc.archive.clear();
  } catch (err) {
    console.error("[Oscilloscope] Failed to clear archive:", err);
  }
  if (osc.serial) {
    try {
      osc.serial.setChannels(osc.allChannels);
    } catch (err) {
      console.error("[Oscilloscope] Failed to set serial channels:", err);
    }
  }

  await renderVisibleChannels(osc.getRenderingContext());
  canvasUpdateOffset(osc.getCanvasContext());
  osc.syncCanvasLayout();
  syncViewPositions(osc.getRenderingContext());
  osc.cursorsFooter?.setStats(osc.allChannels.length, osc.lastReportedHz);
  console.log(`[DIAG] After: allChannels=${osc.allChannels.length}, visibleChannels=${osc.visibleChannels.length}`);
  console.log(`[Oscilloscope] Switch complete.`);
}
export async function updateVisibleChannels(
  osc: Oscilloscope,
  newVisibleChannels: Channel[],
): Promise<void> {
  if (osc.isDestroyed) return;
  const validIds = new Set(osc.allChannels.map((ch) => ch.id));
  const filtered = Array.isArray(newVisibleChannels)
    ? newVisibleChannels.filter((ch) => ch && validIds.has(ch.id))
    : [];
  if (
    newVisibleChannels.length > 0 &&
    filtered.length === 0 &&
    osc.allChannels.length > 0
  ) {
    osc.visibleChannels = [...osc.allChannels];
  } else {
    osc.visibleChannels = filtered;
  }
  renderVisibleChannels(osc.getRenderingContext());
}

export function setIniFiles(osc: Oscilloscope, files: IniFileItem[]): void {
  osc.availableIniFiles = Array.isArray(files) ? files : [];
  if (osc.iniPanel) {
    osc.iniPanel.setExternalFiles(osc.availableIniFiles);
  }
}