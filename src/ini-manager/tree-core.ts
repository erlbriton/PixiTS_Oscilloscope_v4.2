// src/ini-manager/tree-core.ts
import type { IniConfig } from '../core/ini/index.js';

/** Тип сырого INI-конфига (совместим с AppState.currentDeviceConfig) */
export type RawIniConfig = Record<string, Record<string, string | string[]>>;

/** Элемент реестра устройств */
export interface DeviceRegistryItem {
  id: string;
  displayText: string;
  iniConfig: IniConfig;
  /** Сырой конфиг для обратной совместимости со старым кодом */
  fullConfig: RawIniConfig;
}

/** Реестр: локации → массив устройств */
export const deviceRegistry: Record<string, DeviceRegistryItem[]> = {};

// export let currentDeviceConfig: RawIniConfig | null = null;

// export function setCurrentDeviceConfig(config: RawIniConfig | null): void {
//   currentDeviceConfig = config;
// }

export let currentIniConfig: IniConfig | null = null;

export function setCurrentIniConfig(config: IniConfig | null): void {
  currentIniConfig = config;
}

// Вспомогательная функция для парсинга адресов
export function parseRegisterAddress(addrString: string): { reg: number | null; sub: string | null } {
  if (!addrString || addrString === '*') return { reg: null, sub: null };
  const cleanStr = addrString.toLowerCase().replace('r', '');
  const parts = cleanStr.split('.');
  let valStr = parts[0];
  let base = 16; // Default to hex
  if (valStr.startsWith('x')) {
    valStr = valStr.substring(1);
  } else if (valStr.startsWith('0x')) {
    valStr = valStr.substring(2);
  }
  return {
    reg: parseInt(valStr, base),
    sub: parts[1] ? parts[1].toUpperCase() : null
  };
}

// Вспомогательная функция для HEX -> Float32
export function hexToFloat32(hexStr: string): number {
  if (!hexStr) return NaN;
  const intVal = parseInt(hexStr, 16);
  if (isNaN(intVal)) return NaN;
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, intVal, false);
  return view.getFloat32(0, false);
}

// Вспомогательная функция для Float32 -> HEX
export function float32ToHex(floatVal: number, padLen: number = 8): string {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, floatVal, false);
  const intVal = view.getUint32(0, false);
  return 'x' + intVal.toString(16).toUpperCase().padStart(padLen, '0');
}

export function getSectionRange(
  config: RawIniConfig | null,
  sectionName: string
): { start: number; count: number } {
  if (!config || !config[sectionName]) return { start: 0, count: 0 };
  const section = config[sectionName];
  let minReg = Infinity;
  let maxReg = -Infinity;
  Object.values(section).forEach((parts: string | string[]) => {
    if (Array.isArray(parts)) {
      const dataType = String(parts[2] || '').toUpperCase();
      const regAddrString = String(dataType === 'TBIT' ? (parts[5] ?? '') : (parts[4] ?? ''));
      const parsed = parseRegisterAddress(regAddrString);
      if (parsed.reg !== null && !isNaN(parsed.reg)) {
        minReg = Math.min(minReg, parsed.reg);
        const is32Bit = dataType.toUpperCase().includes('FLOAT') ||
          dataType.toUpperCase().includes('DWORD') ||
          dataType.toUpperCase().includes('LONG') ||
          dataType.toUpperCase().includes('INT32');
        maxReg = Math.max(maxReg, parsed.reg + (is32Bit ? 1 : 0));
      }
    }
  });
  if (minReg === Infinity) return { start: 0, count: 0 };
  return { start: minReg, count: maxReg - minReg + 1 };
}

// Регистрация устройства
export function addDeviceToRegistry(iniConfig: IniConfig): boolean {
  if (!iniConfig || !iniConfig.device) return false;
  const dev = iniConfig.device;
  const location = dev.location || 'Неизвестное место';
  const id = dev.id || 'Без ID';
  const displayComponents = [id, dev.version, dev.date].filter(Boolean);
  const deviceDisplayText = displayComponents.join(' ');
  if (!deviceRegistry[location]) deviceRegistry[location] = [];
  const isDuplicate = deviceRegistry[location].some(item => item.id === id);
  if (!isDuplicate) {
    deviceRegistry[location].push({
      id,
      displayText: deviceDisplayText,
      iniConfig,
      fullConfig: iniConfig.parseResult.rawSections as RawIniConfig,
    });
    return true;
  }
  return false;
}

/**
 * План записи значения Контроллера.
 * Чистая логика без DOM — переносима в нативные проекты.
 */
export type ControllerWritePlan =
    | { ok: true; kind: 'words'; words: number[]; newHex: string; newPhys: string }
    | { ok: true; kind: 'bit'; bitIndex: number; bitValue: number; newPhys: string }
    | { ok: false };

/** Белый список типов, разрешённых к редактированию в Контроллере */
const CONTROLLER_EDITABLE_TYPES: ReadonlySet<string> = new Set([
    'TWORD', 'TINT', 'TBIT',
    'TFLOAT', 'TFLOAT32', 'FLOAT',
    'TDWORD', 'TLONG', 'TINT32',
]);

/**
 * Проверяет введённое значение и строит план записи.
 * Не выполняет никаких операций с DOM или портом.
 */
export function planControllerWrite(
    dataTypeRaw: string,
    editType: string,
    valueStr: string,
    scale: number,
    subRaw: string,
): ControllerWritePlan {
    const dataType = dataTypeRaw.toUpperCase();
    if (!CONTROLLER_EDITABLE_TYPES.has(dataType)) return { ok: false };

    const is32Bit = dataType.includes('FLOAT') || dataType.includes('DWORD') ||
        dataType.includes('LONG') || dataType.includes('INT32');
    const isFloat = dataType.includes('FLOAT');
    const isBit = dataType === 'TBIT';

    const safeScale = (!isNaN(scale) && scale !== 0) ? scale : 1.0;

    // --- Ввод HEX ---
    if (editType === 'hex') {
        const cleanHex = valueStr.replace(/^(x|0x)/i, '');
        if (!/^[0-9A-Fa-f]+$/.test(cleanHex)) return { ok: false };
        // 16 бит — максимум 4 hex-цифры, 32 бита — максимум 8
        if (is32Bit ? cleanHex.length > 8 : cleanHex.length > 4) return { ok: false };

        const parsed = parseInt(cleanHex, 16);
        if (isNaN(parsed)) return { ok: false };

        if (isBit) {
            const bitIndex = parseInt(subRaw, 16);
            return {
                ok: true,
                kind: 'bit',
                bitIndex: isNaN(bitIndex) ? 0 : bitIndex,
                bitValue: parsed & 1,
                newPhys: String(parsed & 1),
            };
        }

        const newHex = 'x' + parsed.toString(16).toUpperCase().padStart(is32Bit ? 8 : 4, '0');
        let newPhys: string;
        if (isFloat) {
            const dv = new DataView(new ArrayBuffer(4));
            dv.setUint32(0, parsed >>> 0, false);
            newPhys = String(dv.getFloat32(0, false) * safeScale);
        } else if (is32Bit) {
            const signed = parsed > 0x7FFFFFFF ? parsed - 0x100000000 : parsed;
            newPhys = String(signed * safeScale);
        } else {
            const signed = parsed > 0x7FFF ? parsed - 0x10000 : parsed;
            newPhys = String(signed * safeScale);
        }

        const words = is32Bit
            ? [parsed & 0xFFFF, (parsed >>> 16) & 0xFFFF]
            : [parsed & 0xFFFF];

        return { ok: true, kind: 'words', words, newHex, newPhys };
    }

    // --- Ввод Physical ---
    const valNum = parseFloat(valueStr.replace(',', '.'));
    if (isNaN(valNum) || !isFinite(valNum)) return { ok: false };

    if (isBit) {
        const bitIndex = parseInt(subRaw, 16);
        const bitValue = valNum > 0 ? 1 : 0;
        return {
            ok: true,
            kind: 'bit',
            bitIndex: isNaN(bitIndex) ? 0 : bitIndex,
            bitValue,
            newPhys: String(bitValue),
        };
    }

    if (isFloat) {
        // float32ToHex возвращает строку с префиксом 'x' (например, "x47359000"),
        // поэтому перед parseInt префикс нужно снять, иначе получим NaN и [0x0, 0x0]
        const hexStrRaw = float32ToHex(valNum / safeScale);
        const hexStr = hexStrRaw.replace(/^x/i, '').toUpperCase();
        const rawInt = parseInt(hexStr, 16);
        if (isNaN(rawInt)) return { ok: false };

        return {
            ok: true,
            kind: 'words',
            words: [rawInt & 0xFFFF, (rawInt >>> 16) & 0xFFFF],
            newHex: 'x' + hexStr,
            newPhys: String(valNum),
        };
    }

    const raw = Math.round(valNum / safeScale);
    if (is32Bit) {
        if (raw < -2147483648 || raw > 4294967295) return { ok: false };
        const unsigned = raw < 0 ? raw + 0x100000000 : raw;
        return {
            ok: true,
            kind: 'words',
            words: [unsigned & 0xFFFF, (unsigned >>> 16) & 0xFFFF],
            newHex: 'x' + unsigned.toString(16).toUpperCase().padStart(8, '0'),
            newPhys: String(valNum),
        };
    }

    // 16 бит: сюда попадает и попытка записать 32-битное значение -> invalid
    if (raw < -32768 || raw > 65535) return { ok: false };
    const word = raw & 0xFFFF;
    return {
        ok: true,
        kind: 'words',
        words: [word],
        newHex: 'x' + word.toString(16).toUpperCase().padStart(4, '0'),
        newPhys: String(valNum),
    };
}