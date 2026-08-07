import { showIdModal, populateDeviceForm } from '../ui/ui.js';
import { addDeviceToRegistry, deviceRegistry } from './tree-core.js';
import { renderDeviceTree } from './tree-ui.js';
import { renderModbusTable } from '../ui/tree.js';

export function setupFileHandling(fileInput: HTMLInputElement, appState: any): void {
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
                .catch((err: any) => {
                    console.error('[file-loader] Unhandled file processing error:', err);
                });
        });
    });
}

async function processSingleFile(file: File, appState: any): Promise<void> {
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

        const parser = appState?.parser;
        if (!parser || typeof parser.parse !== 'function') {
            throw new Error('Не инициализирован INI-парсер');
        }

        const config = parser.parse(content);

        if (!config || !(config['DEVICE'] || config['RAM'] || config['CD'] || config['FLASH'])) {
            throw new Error('Неверный формат INI файла (отсутствуют стандартные секции)');
        }

        appState.currentDeviceConfig = config;
        appState.currentIniContent = content;

        const isAdded = addDeviceToRegistry(config);
        if (isAdded) {
            renderDeviceTree();
        }

        if (config['DEVICE']) {
            populateDeviceForm(config['DEVICE']);
        }

        renderModbusTable(config);

        const osc = (window as any).osc;
        if (osc && typeof osc.loadIniContent === 'function') {
            const normalizedContent = serializeConfig(config);

            let oscLoadApplied = false;

            if (normalizedContent.trim().length > 0) {
                try {
                    await osc.loadIniContent(normalizedContent);
                    oscLoadApplied = true;
                } catch (normalizedErr) {
                    console.warn(
                        '[file-loader] Normalized INI apply failed, falling back to raw content:',
                        normalizedErr
                    );
                }
            }

            if (!oscLoadApplied) {
                try {
                    await osc.loadIniContent(content);
                    oscLoadApplied = true;
                } catch (oscErr: any) {
                    console.error('[file-loader] Oscilloscope apply error:', oscErr);
                    showIdModal(
                        'Ошибка применения INI к осциллографу: ' +
                        (oscErr?.message ? oscErr.message : String(oscErr))
                    );
                }
            }
        }

        syncFilesToOscilloscope();

        const deviceId = findDeviceIdByConfig(config);
        if (deviceId && typeof (window as any).osc?.setActiveIni === 'function') {
            try {
                (window as any).osc.setActiveIni(deviceId);
            } catch (uiErr) {
                console.error('[file-loader] Failed to set active INI:', uiErr);
            }
        }
    } catch (err: any) {
        showIdModal('Ошибка обработки файла ' + file.name + ': ' + (err?.message ? err.message : String(err)));
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
    const osc = (window as any).osc;
    if (!osc || typeof osc.setIniFiles !== 'function') return;

    const allFiles: any[] = [];
    const registry = deviceRegistry as any;

    for (const location in registry) {
        const group = registry[location];
        if (!Array.isArray(group)) continue;

        group.forEach((dev: any) => {
            try {
                if (!dev || dev.id == null) return;

                const configStr = serializeConfig(dev?.fullConfig);

                allFiles.push({
                    id: String(dev.id),
                    name: dev.displayText ?? dev.name ?? String(dev.id),
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

function findDeviceIdByConfig(config: any): string | null {
    if (!config) return null;

    const registry = deviceRegistry as any;

    for (const location in registry) {
        const group = registry[location];
        if (!Array.isArray(group)) continue;

        for (const dev of group) {
            if (dev && dev.fullConfig === config && dev.id != null) {
                return String(dev.id);
            }
        }
    }

    try {
        const target = serializeConfig(config);

        for (const location in registry) {
            const group = registry[location];
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

function serializeConfig(config: any): string {
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