// src/ini-manager/file-loader-browser.ts
// Браузерная реализация открытия файлов и папок через File System Access API.
//
// Зеркало Tauri-файла file-loader-tauri.ts:
//   - в Tauri:    openIniFileTauri / openIniFolderTauri (через invoke);
//   - в браузере: openIniFile / openIniFolder (через showOpenFilePicker /
//                 showDirectoryPicker).
//
// Логика «что делать с содержимым» вынесена в processSingleFileContent
// (файл file-loader.ts) — обе платформы используют её.

import type { AppState } from '../core/app-state.js';
import { showIdModal } from '../ui/ui.js';
import { saveDbFolderHandle } from './db-folder.js';
import { setIniFileHandle } from './file-store.js';
import { processSingleFileContent, readTextFile } from './file-loader.js';

/** Часть window-API для выбора папки. */
interface DirectoryPickerWindow {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

/** Интерфейс только для метода обхода. */
interface DirectoryIterator {
    values(): AsyncIterableIterator<FileSystemHandle>;
}

/**
 * Открывает INI-файл через File System Access API.
 * Сохраняет хэндл файла в file-store для последующей записи.
 */
export async function openIniFile(appState: AppState): Promise<void> {
    try {
        const handles = await (window as unknown as {
            showOpenFilePicker: (opts: unknown) => Promise<FileSystemFileHandle[]>;
        }).showOpenFilePicker({
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
            const content = await readTextFile(file);
            setIniFileHandle(file.name, fileHandle);
            await processSingleFileContent(content, file.name, appState, file, fileHandle);
        }

        // Если до открытия ни один файл не был выбран — автоматически выбираем первый
        setTimeout(() => {
            const selected = document.querySelector('.tree-id-item.is-selected');
            if (!selected) {
                const firstLi = document.querySelector<HTMLLIElement>('.tree-id-item.is-leaf');
                if (firstLi) {
                    const details = firstLi.closest('details');
                    if (details && !(details as HTMLDetailsElement).open) {
                        (details as HTMLDetailsElement).open = true;
                    }
                    firstLi.click();
                    firstLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        }, 100);
    } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
            // Пользователь отменил выбор файла
            return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        showIdModal('Ошибка открытия файла: ' + msg);
        console.error('[file-loader-browser] openIniFile error:', err);
    }
}

/**
 * Открывает папку и загружает все INI-файлы из неё (и вложенных папок).
 * Доступно только в Linux через showDirectoryPicker API.
 * Работает через тот же конвейер, что и openIniFile: processSingleFileContent.
 */
export async function openIniFolder(appState: AppState): Promise<void> {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
        showIdModal('Выбор папки не поддерживается в этом браузере.');
        return;
    }

    try {
        const dirHandle = await picker();

        // Запоминаем открытую папку как общую папку базы:
        // новые файлы будут писаться в неё же (на Linux).
        await saveDbFolderHandle(dirHandle);

        // Рекурсивный обход всех вложенных папок
        const stack: FileSystemDirectoryHandle[] = [dirHandle];

        while (stack.length > 0) {
            const currentDir = stack.pop()!;

            for await (const entry of (currentDir as unknown as DirectoryIterator).values()) {
                if (entry.kind === 'directory') {
                    stack.push(entry as FileSystemDirectoryHandle);
                } else if (entry.kind === 'file') {
                    const name = entry.name.toLowerCase();
                    if (name.endsWith('.ini') || name.endsWith('.txt')) {
                        const fileHandle = entry as FileSystemFileHandle;
                        try {
                            const file = await fileHandle.getFile();
                            const content = await readTextFile(file);
                            setIniFileHandle(file.name, fileHandle);
                            await processSingleFileContent(content, file.name, appState, file, fileHandle, currentDir);
                        } catch (fileErr) {
                            // Ошибка чтения одного файла не прерывает всю папку
                            console.warn(`[file-loader-browser] Пропуск файла ${entry.name}:`, fileErr);
                        }
                    }
                }
            }
        }

        // Если до открытия ни один файл не был выбран — автоматически выбираем первый
        setTimeout(() => {
            const selected = document.querySelector('.tree-id-item.is-selected');
            if (!selected) {
                const firstLi = document.querySelector<HTMLLIElement>('.tree-id-item.is-leaf');
                if (firstLi) {
                    const details = firstLi.closest('details');
                    if (details && !(details as HTMLDetailsElement).open) {
                        (details as HTMLDetailsElement).open = true;
                    }
                    firstLi.click();
                    firstLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        }, 100);
    } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
            // Пользователь отменил выбор папки
            return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        showIdModal('Ошибка открытия папки: ' + msg);
        console.error('[file-loader-browser] openIniFolder error:', err);
    }
}