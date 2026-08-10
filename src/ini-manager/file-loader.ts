// src/ini-manager/file-loader.ts
import { showIdModal, populateDeviceForm } from '../ui/ui.js';
import { addDeviceToRegistry, deviceRegistry, setCurrentIniConfig } from './tree-core.js';
import type { RawIniConfig, DeviceRegistryItem } from './tree-core.js';
import { renderDeviceTree } from './tree-ui.js';
import { renderModbusTable } from '../ui/tree.js';
import { IniParser as CoreIniParser, IniConfig, iniParamsToChannelConfigs } from '../core/ini/index.js';
import type { AppState } from '../core/app-state.js';

/** Элемент списка INI-файлов для синхронизации с осциллографом */
interface OscIniFile {
  id: string;
  name: string;
  content: string;
  size: number;
  lastModified: number;
}

export function setupFileHandling(fileInput: HTMLInputElement, appState: AppState): void {
  let processingQueue: Promise<void> = Promise.resolve();

  fileInput.addEventListener('change', (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (!target || !target.files) return;
    const files: File[] = Array.from(target.files);
    if (files.length === 0) return;
    target.value = '';
    files.forEach((file: File) => {
      processingQueue = processingQueue
        .then(() => processSingleFile(file, appState))
        .catch((err: unknown) => {
          console.error('[file-loader] Unhandled file processing error:', err);
        });
    });
  });
}

async function processSingleFile(file: File, appState: AppState): Promise<void> {
  let content: string;
  try {
    content = await readFileAsText(file);
  } catch (err) {
    showIdModal(`Ошибка чтения файла: ${file.name}`);
    console.error('[file-loader] Read error:', err);
    return;
  }

  try {
    if (!content) {
      throw new Error('Файл пуст');
    }

    // ЕДИНЫЙ парсинг через core/ini
    const coreParser = new CoreIniParser();
    const parseResult = coreParser.parse(content);
    const iniConfig = new IniConfig(parseResult);

    // Совместимость: rawSections — тот же формат, что и старый ParsedData
    const config = parseResult.rawSections as RawIniConfig;

    if (!config || !(config['DEVICE'] || config['RAM'] || config['CD'] || config['FLASH'])) {
      throw new Error('Неверный формат INI файла (отсутствуют стандартные секции)');
    }

    appState.currentDeviceConfig = config;
    appState.currentIniContent = content;
    appState.currentIniConfig = iniConfig;

    const isAdded = addDeviceToRegistry(iniConfig);
    setCurrentIniConfig(iniConfig);

    if (isAdded) {
      renderDeviceTree();
    }
    if (config['DEVICE']) {
      populateDeviceForm(config['DEVICE']);
    }
    renderModbusTable(iniConfig);

    // Осциллограф: используем уже распарсенный iniConfig
    const osc = window.osc;
    if (osc && typeof osc.applyChannelConfigs === 'function') {
      try {
        const ramParams = iniConfig.getSection('RAM');
        const channelConfigs = iniParamsToChannelConfigs(ramParams);
        await osc.applyChannelConfigs(channelConfigs);
      } catch (oscErr: unknown) {
        const msg = oscErr instanceof Error ? oscErr.message : String(oscErr);
        console.error('[file-loader] applyChannelConfigs error:', oscErr);
        showIdModal('Ошибка применения INI к осциллографу: ' + msg);
      }
    } else if (osc && typeof osc.loadIniContent === 'function') {
      try {
        await osc.loadIniContent(content);
      } catch (oscErr: unknown) {
        console.error('[file-loader] Oscilloscope apply error (legacy):', oscErr);
      }
    }

    syncFilesToOscilloscope();

    const deviceId = findDeviceIdByConfig(config);
    if (deviceId && window.osc?.setActiveIni) {
      try {
        window.osc.setActiveIni(deviceId);
      } catch (uiErr) {
        console.error('[file-loader] Failed to set active INI:', uiErr);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showIdModal('Ошибка обработки файла ' + file.name + ': ' + msg);
    console.error('Parser Error:', err);
  }
}

function readFileAsText(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('Не удалось прочитать файл как текст'));
      }
    };
    reader.onerror = () => {
      reject(new Error('Ошибка чтения файла'));
    };
    reader.readAsText(file, 'windows-1251');
  });
}

function syncFilesToOscilloscope(): void {
  const osc = window.osc;
  if (!osc || typeof osc.setIniFiles !== 'function') return;

  const allFiles: OscIniFile[] = [];

  for (const location in deviceRegistry) {
    const group = deviceRegistry[location];
    if (!Array.isArray(group)) continue;
    group.forEach((dev: DeviceRegistryItem) => {
      try {
        if (!dev || dev.id == null) return;
        const configStr = serializeConfig(dev.fullConfig);
        allFiles.push({
          id: String(dev.id),
          name: dev.displayText ?? String(dev.id),
          content: configStr,
          size: new Blob([configStr]).size,
          lastModified: Date.now()
        });
      } catch (err) {
        console.warn('[file-loader] Failed to serialize device config:', err);
      }
    });
  }

  try {
    osc.setIniFiles(allFiles);
  } catch (err) {
    console.error('[file-loader] Failed to sync INI files to oscilloscope:', err);
  }
}

function findDeviceIdByConfig(config: RawIniConfig): string | null {
  if (!config) return null;

  for (const location in deviceRegistry) {
    const group = deviceRegistry[location];
    if (!Array.isArray(group)) continue;
    for (const dev of group) {
      if (dev && dev.fullConfig === config && dev.id != null) {
        return String(dev.id);
      }
    }
  }

  try {
    const target = serializeConfig(config);
    for (const location in deviceRegistry) {
      const group = deviceRegistry[location];
      if (!Array.isArray(group)) continue;
      for (const dev of group) {
        if (dev && dev.id != null && serializeConfig(dev.fullConfig) === target) {
          return String(dev.id);
        }
      }
    }
  } catch (err) {
    console.warn('[file-loader] Failed to find device by serialized config:', err);
  }
  return null;
}

function serializeConfig(config: RawIniConfig): string {
  if (!config || typeof config !== 'object') return '';
  let out = '';
  for (const section in config) {
    out += `[${section}]\n`;
    const data = config[section];
    if (data && typeof data === 'object') {
      for (const key in data) {
        const val = data[key];
        out += `${key} = ${Array.isArray(val) ? val.join('/') : val}\n`;
      }
    }
    out += '\n';
  }
  return out;
}