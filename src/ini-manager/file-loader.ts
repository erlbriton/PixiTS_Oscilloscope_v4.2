// src/ini-manager/file-loader.ts

import { showIdModal, populateDeviceForm } from '../ui/ui.js';
import { addDeviceToRegistry, deviceRegistry, setCurrentIniConfig, updateDeviceInRegistry, removeDeviceFromRegistry } from './tree-core.js';
import type { RawIniConfig, DeviceRegistryItem } from './tree-core.js';
import { renderDeviceTree } from './tree-ui.js';
import { renderModbusTable } from '../ui/tree.js';
import { IniParser as CoreIniParser, IniConfig, iniParamsToChannelConfigs } from '../core/ini/index.js';
import type { AppState } from '../core/app-state.js';

/**
 * Открывает INI-файл через File System Access API.
 * Сохраняет хэндл файла в appState для последующей записи.
 */
/** Хэндлы открытых INI-файлов (имя файла → хэндл) для записи обратно */
const iniFileHandles = new Map<string, FileSystemFileHandle>();
let currentIniFileName: string | null = null;

/**
 * Хранилище File-объектов для перечитывания INI-файлов с диска.
 * Ключ: `${location}::${id}` — совпадает с уникальностью в deviceRegistry.
 * Браузер не следит за файлами сам, но пока жива ссылка на File,
 * file.text() возвращает актуальное содержимое с диска.
 */
interface StoredFileEntry {
    file: File;
    handle?: FileSystemFileHandle;
    location: string;
    id: string;
    content: string;
    lastModified: number;
}
const fileStore: Map<string, StoredFileEntry> = new Map();

/** Возвращает хэндл файла, с которым сейчас работает аджастер */
export function getCurrentIniFileHandle(): FileSystemFileHandle | null {
  if (!currentIniFileName) return null;
  return iniFileHandles.get(currentIniFileName) ?? null;
}

export async function openIniFile(appState: AppState): Promise<void> {
  try {
    const handles = await (window as any).showOpenFilePicker({
      types: [
        {
          description: 'INI Files',
          accept: { 'text/plain': ['.ini', '.txt'] },
        },
      ],
      multiple: true,
    });

    for (const fileHandle of handles) {
      const file = await fileHandle.getFile();
      const content = await readFileAsText(file);
      iniFileHandles.set(file.name, fileHandle);
      await processSingleFileContent(content, file.name, appState, file, fileHandle);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Пользователь отменил выбор файла
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    showIdModal('Ошибка открытия файла: ' + msg);
    console.error('[file-loader] openIniFile error:', err);
  }
}

/** Элемент списка INI-файлов для синхронизации с осциллографом */
interface OscIniFile {
  id: string;
  name: string;
  content: string;
  size: number;
  lastModified: number;
}

// setupFileHandling больше не используется — вместо неё openIniFile с File System Access API

async function processSingleFileContent(
    content: string,
    fileName: string,
    appState: AppState,
    sourceFile?: File,
    sourceHandle?: FileSystemFileHandle,
): Promise<void> {
  currentIniFileName = fileName;
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

   // appState.currentDeviceConfig = config;
    appState.currentIniContent = content;
    appState.currentIniConfig = iniConfig;

    const isAdded = addDeviceToRegistry(iniConfig);
    setCurrentIniConfig(iniConfig);

    // Сохраняем File-объект, чтобы позже перечитать файл с диска
    console.log('[file-loader] save check:', { isAdded, hasFile: !!sourceFile, hasDevice: !!iniConfig.device });
    if (isAdded && sourceFile && iniConfig.device) {
        const loc = iniConfig.device.location || 'Неизвестное место';
        const id = iniConfig.device.id || 'Без ID';
        const key = `${loc}::${id}`;
        fileStore.set(key, {
            file: sourceFile,
            handle: sourceHandle,
            location: loc,
            id: String(id),
            content,
            lastModified: Date.now(),
        });
    }

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

    // Событие "INI-файл загружен": uiManager по нему выполнит автоматический
    // опрос контроллера (как кнопка "Обновить"), если порт открыт.
    window.dispatchEvent(new CustomEvent('app:ini-file-loaded'));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showIdModal('Ошибка обработки файла ' + fileName + ': ' + msg);
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

/**
 * Перечитывает все загруженные INI-файлы с диска.
 * - Файл изменён: обновляет запись в реестре и памяти.
 * - Файл удалён/перемещён: удаляет устройство из реестра.
 * - Файл не менялся: пропускает.
 */
export async function reloadIniFilesFromDisk(): Promise<{
    updated: number;
    removed: number;
    unchanged: number;
    errors: string[];
}> {
    const results = { updated: 0, removed: 0, unchanged: 0, errors: [] as string[] };
    const keys = Array.from(fileStore.keys());

    if (keys.length === 0) {
        console.log('[file-loader] reloadIniFilesFromDisk: нет файлов для перечитывания');
        return results;
    }

    for (const key of keys) {
        const entry = fileStore.get(key);
        if (!entry) continue;

        try {
            // Если есть хэндл — берём свежий File с диска, иначе старый снимок
            const fileToRead = entry.handle ? await entry.handle.getFile() : entry.file;
            const newContent = await readFileAsText(fileToRead);

            if (newContent === entry.content) {
                results.unchanged++;
                continue;
            }

            // Файл изменился — парсим и обновляем реестр на месте
            try {
                const coreParser = new CoreIniParser();
                const parseResult = coreParser.parse(newContent);
                const newIniConfig = new IniConfig(parseResult);
                const newConfig = parseResult.rawSections as RawIniConfig;

                if (updateDeviceInRegistry(entry.location, entry.id, newIniConfig, newConfig)) {
                    entry.content = newContent;
                    entry.lastModified = Date.now();
                    results.updated++;
                    console.log(`[file-loader] Файл обновлён: ${entry.file.name}`);
                } else {
                    fileStore.delete(key);
                    results.errors.push(`${entry.file.name}: устройство не найдено в реестре`);
                }
            } catch (parseErr) {
                const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
                results.errors.push(`${entry.file.name}: ошибка парсинга — ${msg}`);
                console.error(`[file-loader] Parse error for ${entry.file.name}:`, parseErr);
            }
        } catch (readErr) {
            // Файл удалён или перемещён
            removeDeviceFromRegistry(entry.location, entry.id);
            fileStore.delete(key);
            results.removed++;
            console.log(`[file-loader] Файл удалён/недоступен: ${entry.file.name}`);
        }
    }

    if (results.updated > 0 || results.removed > 0) {
        renderDeviceTree();
        syncFilesToOscilloscope();
        console.log(
            `[file-loader] reload: updated=${results.updated}, removed=${results.removed}, unchanged=${results.unchanged}`,
        );
    }

    return results;
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
/**
 * Старый способ открытия файла через <input type="file">.
 * Временно оставляем для совместимости, пока не переключимся на openIniFile.
 */
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
        .then(async () => {
          const content = await readFileAsText(file);
          await processSingleFileContent(content, file.name, appState, file);
        })
        .catch((err: unknown) => {
          console.error('[file-loader] Unhandled file processing error:', err);
        });
    });
  });
}