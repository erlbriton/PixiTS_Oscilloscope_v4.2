// src/core/app-state.ts
// Типизированное состояние приложения.
// Заменяет appState: any во всех модулях.
// Не зависит от DOM, Serial, осциллографа. Готов к Tauri.

import type { IniConfig } from './ini/index.js';

/**
 * Минимальный контракт старого INI-парсера (ini-manager/iniParser.ts).
 * Определён здесь, чтобы core/ не зависел от ini-manager/.
 * @deprecated Будет удалён после полной миграции на core/ini/IniParser.
 */
export interface IIniParserLegacy {
    parse(text: string): Record<string, Record<string, string | string[]>>;
    multiplierCache: Record<string, Record<string, string>>;
}

/**
 * Полное состояние приложения.
 * Все модули (uiManager, serial-actions, file-loader, device_updater)
 * будут типизированы через этот интерфейс.
 */
export interface AppState {
    /** Идёт ли идентификация устройства (запрос ID) */
    isIdentifying: boolean;
    /** Активен ли опрос контроллера (readLoop) */
    isPolling: boolean;
    /** Идёт ли обновление регистров (кнопка «Обновить») */
    isRefreshing: boolean;
    /** Запущен ли цикл readLoop (защита от повторного запуска) */
    isLoopRunning: boolean;
    /** Modbus-адрес устройства */
    slaveAddress: number;

    /**
     * Старый INI-парсер.
     * @deprecated Будет удалён после полной миграции на core/ini/IniParser.
     */
    parser: IIniParserLegacy;

    /**
     * Сырой конфиг для обратной совместимости со старым кодом.
     * @deprecated Используйте currentIniConfig вместо этого.
     */
    currentDeviceConfig: Record<string, Record<string, string | string[]>> | null;

    /** Текст текущего INI-файла */
    currentIniContent: string | null;

    /** Типизированный конфиг из единого INI-слоя */
    currentIniConfig: IniConfig | null;
}