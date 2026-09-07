// src/ini-manager/save-ini.ts
// Кнопка "Сохранить изменения": хирургическая правка токенов значений
// в исходном тексте INI + запись в файл в кодировке windows-1251.

import { showIdModal } from '../ui/ui.js';
import { showConfirmDialog } from '../ui/confirm-dialog.js';
import { getCurrentIniFileHandle } from './file-loader.js';
import type { AppState } from '../core/app-state.js';
import { clearAllDirty } from './dirty-tracker.js';

// ─────────────────────────────────────────────
// Кодировка windows-1251 для записи
// ─────────────────────────────────────────────

let charToByte: Map<number, number> | null = null;

function getCharToByte(): Map<number, number> {
  if (charToByte) return charToByte;
  const decoder = new TextDecoder('windows-1251');
  const map = new Map<number, number>();
  const buf = new Uint8Array(1);
  for (let b = 0; b < 256; b++) {
    buf[0] = b;
    const ch = decoder.decode(buf);
    if (ch.length === 1) map.set(ch.charCodeAt(0), b);
  }
  charToByte = map;
  return map;
}

/** Кодирует строку в байты windows-1251 */
function encodeWindows1251(text: string): Uint8Array<ArrayBuffer> {
  const map = getCharToByte();
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      out[i] = code;
    } else {
      const b = map.get(code);
      out[i] = b !== undefined ? b : 0x3F; // '?' для неотображаемых
    }
  }
  return out;
}

// ─────────────────────────────────────────────
// Сохранение
// ─────────────────────────────────────────────

export async function saveIniChanges(appState: AppState): Promise<boolean> {
  const original = appState.currentIniContent;
  const fileHandle = getCurrentIniFileHandle();

  if (!original || !fileHandle) {
    showIdModal('Нет открытого файла для сохранения');
    return false;
  }

  // Собираем изменения из таблицы: key → весь массив parts
  const rows = Array.from(
    document.querySelectorAll<HTMLTableRowElement>('#grid-data-rows tr'),
  );
  const changes: { key: string; hexValue: string; hexIndex: number; multiplier: string }[] = [];

  for (const tr of rows) {
    const key = tr.getAttribute('data-key') || '';
    if (!key) continue;

    const tds = tr.querySelectorAll('td');
    if (tds.length < 8) continue;

    const dataType = (tr.getAttribute('data-type') || '').toUpperCase();
    const baseText = (tds[4]?.textContent || '').trim();
    if (!baseText || baseText === '—') continue;

    let parts: string[] = [];
    try { parts = JSON.parse(tr.dataset.parts || '[]'); } catch { continue; }

    const hexIndex = parseInt(tr.getAttribute('data-hex-index') || '-1', 10);
    if (hexIndex < 0 || hexIndex >= parts.length) continue;

    let hexValue = (parts[hexIndex] || '').trim();

    if (dataType === 'TPRMLIST') {
      // Текст опции → hex через список опций из data-parts
      hexValue = '';
      for (const p of parts) {
        const part = (p || '').trim();
        if (part.includes('#')) {
          const [h, t] = part.split('#');
          if (h && t && t.trim() === baseText) { hexValue = h.trim(); break; }
        }
      }
    }

    if (!hexValue) continue;
    const multiplier = parts.length > 9 ? (parts[9] ?? '').trim() : '';
    changes.push({ key, hexValue, hexIndex, multiplier });
  }

  if (changes.length === 0) {
    showIdModal('Нет изменений для сохранения');
    return false;
  }

  console.log('[SAVE] Собранные изменения:', JSON.stringify(changes.slice(0, 10)));

  // Хирургическая правка: обновляем все изменённые токены в строке key=...
  const sep = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);
  let applied = 0;

  for (const change of changes) {
    // Ключ может отделяться от '=' пробелами ("p10000=..." и "p10000 = ...")
    const keyRe = new RegExp(
      '^' + change.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=',
    );
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!keyRe.test(trimmed)) continue;

      const eq = line.indexOf('=');
      const rawValue = line.substring(eq + 1);
      const tokens = rawValue.split('/');
      let idx = tokens.length - 1;
      if (tokens[idx] === '') idx--; // пропускаем пустой хвостовой токен
      if (idx < 0) break;

      // Обновляем ТОЛЬКО токен значения и множитель зависимости (токен 9)
      const targetIdx = change.hexIndex < tokens.length ? change.hexIndex : idx;
      tokens[targetIdx] = change.hexValue;
      if (change.multiplier !== '' && tokens.length > 9) {
        tokens[9] = change.multiplier;
      }

      lines[i] = line.substring(0, eq + 1) + tokens.join('/');
      applied++;
      break;
    }
  }

  if (applied === 0) {
    showIdModal('Не удалось применить изменения');
    return false;
  }

  const newContent = lines.join(sep);

  try {
    const writable = await fileHandle.createWritable();
    await writable.write(encodeWindows1251(newContent));
    await writable.close();

    appState.currentIniContent = newContent;
    clearAllDirty();
    showIdModal(`Сохранено: ${applied} параметров`);
    console.log(`[SAVE] Файл сохранён (windows-1251), обновлено: ${applied}`);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showIdModal('Ошибка записи файла: ' + msg);
    console.error('[SAVE] Write error:', err);
    return false;
  }
}

/**
 * Подключает обработчик к кнопке "Сохранить изменения" (#save-btn).
 */
export function setupSaveButton(appState: AppState): void {
  const btn = document.getElementById('save-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const ok = await showConfirmDialog('Сохранить изменения в INI-файл?');
    if (ok) {
      await saveIniChanges(appState);
    }
  });
  console.log('[SAVE] Кнопка "Сохранить изменения" подключена.');
}