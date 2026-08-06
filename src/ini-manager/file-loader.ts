import { showIdModal, populateDeviceForm } from '../ui/ui.js';
import { addDeviceToRegistry, deviceRegistry } from './tree-core.js';
import { renderDeviceTree } from './tree-ui.js';
import { renderModbusTable } from '../ui/tree.js';

export function setupFileHandling(fileInput: HTMLInputElement, appState: any): void {
    fileInput.addEventListener('change', (event: Event) => {
        const target = event.target as HTMLInputElement;
        if (!target || !target.files) return;

        const files: File[] = Array.from(target.files);
        if (files.length === 0) return;

        let processedCount = 0;
        files.forEach((file: File) => {
            const reader = new FileReader();

            reader.onload = (e: ProgressEvent<FileReader>) => {
                try {
                    const content = e.target?.result as string;
                    if (!content) throw new Error("Файл пуст");

                    // Используем парсер из appState
                    const config = appState.parser.parse(content);

                    if (config && (config['DEVICE'] || config['RAM'] || config['CD'] || config['FLASH'])) {
                        // СОХРАНЯЕМ КОНФИГУРАЦИЮ
                        appState.currentDeviceConfig = config;
                        appState.currentIniContent = content;

                        const isAdded = addDeviceToRegistry(config);
                        if (isAdded) renderDeviceTree();
                        
                        if (config['DEVICE']) populateDeviceForm(config['DEVICE']);
                        renderModbusTable(config);

                        // SYNC WITH OSCILLOSCOPE
                        const osc = (window as any).osc;
                        if (osc) {
                            // Direct load for immediate view
                            osc.loadIniContent(content);
                            // Sync registry for the panel
                            syncFilesToOscilloscope();
                        }
                    } else {
                        throw new Error("Неверный формат INI файла (отсутствуют стандартные секции)");
                    }
                } catch (err: any) {
                    showIdModal("Ошибка обработки файла " + file.name + ": " + err.message);
                    console.error("Parser Error:", err);
                } finally {
                    processedCount++;
                }
            };

            reader.onerror = () => {
                showIdModal("Ошибка чтения файла: " + file.name);
                processedCount++;
            };
            reader.readAsText(file, 'windows-1251');
        });

        fileInput.value = '';
    });
}

function syncFilesToOscilloscope() {
    const osc = (window as any).osc;
    if (!osc) return;
    
    const allFiles: any[] = [];
    const registry = (deviceRegistry as any);
    
    for (const location in registry) {
        if (Array.isArray(registry[location])) {
            registry[location].forEach((dev: any) => {
                const configStr = serializeConfig(dev.fullConfig);
                allFiles.push({
                    id: dev.id,
                    name: dev.displayText,
                    content: configStr,
                    size: new Blob([configStr]).size,
                    lastModified: Date.now()
                });
            });
        }
    }
    
    if (allFiles.length > 0) {
        osc.setIniFiles(allFiles);
    }
}

function serializeConfig(config: any): string {
    if (!config) return "";
    let out = "";
    for (const section in config) {
        out += `[${section}]\n`;
        const data = config[section];
        if (data && typeof data === 'object') {
            for (const key in data) {
                const val = data[key];
                out += `${key} = ${Array.isArray(val) ? val.join('/') : val}\n`;
            }
        }
        out += "\n";
    }
    return out;
}
