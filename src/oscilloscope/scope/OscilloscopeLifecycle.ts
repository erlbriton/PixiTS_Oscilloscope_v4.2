// src/oscilloscope/scope/OscilloscopeLifecycle.ts
// ============================================================================
// Жизненный цикл осциллографа: статус соединения, разрушение,
// заморозка/возобновление рендер-цикла. Вынесено из класса Oscilloscope.
// ============================================================================

import type { Oscilloscope } from "../Oscilloscope";

export function setConnectionStatus(osc: Oscilloscope, connected: boolean, message?: string): void {
  if (osc.isDestroyed) return;

  if (osc.toolbar) {
    osc.toolbar.updateStatus(connected);
  }

  if (connected) {
    if (!osc.connectionLost) return;
    osc.connectionLost = false;
    osc.connectionModal.close();
    osc.isRunning = true;
    osc.lastFrameTime = performance.now();
    // Возобновляем рендер-цикл, если он не запущен
    if (osc.animFrameId === null) {
      osc.animFrameId = requestAnimationFrame((t) => osc.loop(t));
    }
    if (osc.settings.isPolling) {
      if (osc.serial) {
        osc.serial.resumePolling();
      }
    }
  } else {
    if (osc.connectionLost) return;
    osc.connectionLost = true;
    osc.isRunning = false;
    // ПРИНУДИТЕЛЬНО останавливаем рендер-цикл: отменяем запланированный кадр
    if (osc.animFrameId !== null) {
      cancelAnimationFrame(osc.animFrameId);
      osc.animFrameId = null;
    }
    osc.connectionModal.show(message ?? "Связь с устройством потеряна.");
  }
}

export function destroy(osc: Oscilloscope): void {
  osc.isDestroyed = true;
  osc.isRunning = false;
  osc.connectionModal?.close();
  if (osc.statsTimerId !== null) {
    clearInterval(osc.statsTimerId);
    osc.statsTimerId = null;
  }
  if (osc.animFrameId !== null) {
    cancelAnimationFrame(osc.animFrameId);
    osc.animFrameId = null;
  }
  osc.pixiViews.forEach((view) => {
    try {
      view.destroy();
    } catch (err) {
      console.warn("[Oscilloscope] Failed to destroy PixiView:", err);
    }
  });
  osc.pixiViews.clear();
  if (osc.targetRoot) {
    osc.targetRoot.innerHTML = "";
  }
}

export function showFrozenState(osc: Oscilloscope, message: string): void {
  if (osc.isDestroyed) return;
  // Только останавливаем рендер-цикл. Окно показывает UI-слой (uiManager).
  osc.isRunning = false;
  if (osc.animFrameId !== null) {
    cancelAnimationFrame(osc.animFrameId);
    osc.animFrameId = null;
  }
}

export function resumeFromFrozen(osc: Oscilloscope): void {
  if (osc.isDestroyed) return;

  // Закрываем окно, если оно было открыто именно этим методом
  if (osc.connectionModal.isOpen) {
    osc.connectionModal.close();
  }

  // Запускаем рендер-цикл
  osc.isRunning = true;
  osc.lastFrameTime = performance.now();
  if (osc.animFrameId === null) {
    osc.animFrameId = requestAnimationFrame((t) => osc.loop(t));
  }
}