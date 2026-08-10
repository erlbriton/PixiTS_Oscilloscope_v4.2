// src/ini-manager/tree-core.ts
import type { IniConfig } from '../core/ini/index.js';

/** Тип сырого INI-конфига (совместим с ParsedData из iniParser.ts) */
export type RawIniConfig = Record<string, Record<string, string | string[]>>;

/** Элемент реестра устройств */
export interface DeviceRegistryItem {
  id: string;
  displayText: string;
  iniConfig: IniConfig;
  fullConfig: RawIniConfig;   // было Record<string, any>
}

/** Реестр: локации → массив устройств */
export const deviceRegistry: Record<string, DeviceRegistryItem[]> = {};

export let currentDeviceConfig: RawIniConfig | null = null;

export function setCurrentDeviceConfig(config: RawIniConfig | null): void {
  currentDeviceConfig = config;
}

export let currentIniConfig: IniConfig | null = null;

export function setCurrentIniConfig(config: IniConfig | null): void {
  currentIniConfig = config;
}

export function parseRegisterAddress(addrString: string): { reg: number | null; sub: string | null } {
  if (!addrString || addrString === '*') return { reg: null, sub: null };
  const cleanStr = addrString.toLowerCase().replace('r', '');
  const parts = cleanStr.split('.');
  let valStr = parts[0];
  let base = 16;
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

export function hexToFloat32(hexStr: string): number {
  if (!hexStr) return NaN;
  const intVal = parseInt(hexStr, 16);
  if (isNaN(intVal)) return NaN;
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, intVal, false);
  return view.getFloat32(0, false);
}

export function float32ToHex(floatVal: number, padLen: number = 8): string {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, floatVal, false);
  const intVal = view.getUint32(0, false);
  return 'x' + intVal.toString(16).toUpperCase().padStart(padLen, '0');
}

// БЫЛО: getSectionRange(config: any, …)
// СТАЛО:
export function getSectionRange(
  config: RawIniConfig,
  sectionName: string
): { start: number; count: number } {
  if (!config || !config[sectionName]) return { start: 0, count: 0 };
  const section = config[sectionName];
  let minReg = Infinity;
  let maxReg = -Infinity;

  // БЫЛО: (parts: any) => {
  // СТАЛО:
  Object.values(section).forEach((parts: string | string[]) => {
    if (Array.isArray(parts)) {
      const dataType = String(parts[2] || '').toUpperCase();
      const regAddrString = String(
        dataType === 'TBIT' ? (parts[5] ?? '') : (parts[4] ?? '')
      );
      const parsed = parseRegisterAddress(regAddrString);
      if (parsed.reg !== null && !isNaN(parsed.reg)) {
        minReg = Math.min(minReg, parsed.reg);
        const is32Bit =
          dataType.includes('FLOAT') ||
          dataType.includes('DWORD') ||
          dataType.includes('LONG') ||
          dataType.includes('INT32');
        maxReg = Math.max(maxReg, parsed.reg + (is32Bit ? 1 : 0));
      }
    }
  });

  if (minReg === Infinity) return { start: 0, count: 0 };
  return { start: minReg, count: maxReg - minReg + 1 };
}

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
      // БЫЛО: fullConfig: iniConfig.parseResult.rawSections  (as any)
      // СТАЛО: явное приведение к RawIniConfig
      fullConfig: iniConfig.parseResult.rawSections as RawIniConfig,
    });
    return true;
  }
  return false;
}