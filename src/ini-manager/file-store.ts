// src/ini-manager/file-store.ts
// Хранилище состояния файлов INI-базы.
//
// Отвечает ТОЛЬКО за хранение:
//  - карта «ключ → запись» для всех загруженных INI-файлов (fileStore);
//  - имя текущего открытого файла + его File System Access handle
//    (для сохранения через browser File System Access API).

/** Имя текущего открытого INI-файла. */
let currentIniFileName: string | null = null;

/** Хэндлы открытых INI-файлов (имя файла → хэндл) для записи обратно. */
const iniFileHandles = new Map<string, FileSystemFileHandle>();

/**
 * Запись о файле в хранилище.
 * Ключ карты — `${location}::${id}`, совпадает с уникальностью в deviceRegistry.
 */
export interface StoredFileEntry {
    file: File;
    handle?: FileSystemFileHandle;
    /** Родительская папка файла (если известна при загрузке — например, при открытии папки) */
    parentHandle?: FileSystemDirectoryHandle;
    location: string;
    id: string;
    content: string;
    lastModified: number;
    /**
     * Абсолютный путь к файлу на диске (только Tauri).
     *
     * В браузерной версии НЕ заполняется и НЕ читается — используется
     * только editDeviceIniFile в Tauri-версии для открытия файла
     * во внешнем редакторе через invoke('open_in_default_editor').
     * Оставлено для 100% совместимости структуры StoredFileEntry
     * между двумя проектами.
     */
    path?: string;
}

/** Карта всех загруженных INI-файлов. */
export const fileStore: Map<string, StoredFileEntry> = new Map();

/** Геттер хранилища файлов. */
export function getFileStore(): Map<string, StoredFileEntry> {
    return fileStore;
}

/** Возвращает имя текущего открытого INI-файла. */
export function getCurrentIniFileName(): string | null {
    return currentIniFileName;
}

/** Устанавливает имя текущего открытого INI-файла. */
export function setCurrentIniFileName(name: string | null): void {
    currentIniFileName = name;
}

/** Возвращает handle текущего открытого файла (или null). */
export function getCurrentIniFileHandle(): FileSystemFileHandle | null {
    if (!currentIniFileName) return null;
    return iniFileHandles.get(currentIniFileName) ?? null;
}

/** Сохраняет handle для файла с указанным именем. */
export function setIniFileHandle(name: string, handle: FileSystemFileHandle): void {
    iniFileHandles.set(name, handle);
}