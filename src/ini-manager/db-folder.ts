// src/ini-manager/db-folder.ts
/**
 * Папка базы INI-файлов (File System Access API, Chrome/Edge):
 *  - ручка папки хранится в IndexedDB и переживает перезагрузки;
 *  - после перезагрузки браузер один раз покажет плашку подтверждения;
 *  - при любом сбое — fallback: скачивание в "Загрузки".
 */

interface DbDirectoryHandleLike {
    queryPermission(desc: { mode: string }): Promise<string>;
    requestPermission(desc: { mode: string }): Promise<string>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<DbFileHandleLike>;
}

interface DbFileHandleLike {
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

interface WindowWithPicker {
    showDirectoryPicker?(opts: { mode: string }): Promise<DbDirectoryHandleLike>;
}

const DB_NAME = 'adjuster-db';
const STORE = 'kv';
const HANDLE_KEY = 'dbFolderHandle';

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE)) {
                req.result.createObjectStore(STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const rq = tx.objectStore(STORE).get(key);
            rq.onsuccess = () => resolve(rq.result as T | undefined);
            rq.onerror = () => reject(rq.error);
        });
    } catch {
        return undefined;
    }
}

async function idbSet(key: string, value: unknown): Promise<void> {
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // не критично: в следующий раз папку выберут заново
    }
}

/**
 * Возвращает ручку папки базы:
 *  - если сохранена — запрашивает разрешение (один клик в сеанс);
 *  - если нет — предлагает выбрать папку (один раз);
 *  - отмена/запрет/ошибка — null (вызывающий уходит в fallback-скачивание).
 * ВАЖНО: вызывать внутри пользовательского клика — иначе браузер
 * не разрешит показать диалог/плашку.
 */
export async function ensureDbFolder(): Promise<DbDirectoryHandleLike | null> {
    try {
        let handle = await idbGet<DbDirectoryHandleLike>(HANDLE_KEY);
        if (!handle) {
            const picker = (window as WindowWithPicker).showDirectoryPicker;
            if (typeof picker !== 'function') return null;
            handle = await picker.call(window, { mode: 'readwrite' });
            if (!handle) return null;
            await idbSet(HANDLE_KEY, handle);
        }
        let perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
            perm = await handle.requestPermission({ mode: 'readwrite' });
        }
        return perm === 'granted' ? handle : null;
    } catch {
        // пользователь отменил выбор папки или запретил доступ
        return null;
    }
}

/**
 * Создаёт файл в папке базы. Не перезаписывает существующий.
 * Возвращает: 'saved' | 'exists' | 'error'.
 */
export async function saveFileToDbFolder(
    handle: DbDirectoryHandleLike,
    name: string,
    content: string,
): Promise<'saved' | 'exists' | 'error'> {
    try {
        let fileHandle: DbFileHandleLike;
        try {
            await handle.getFileHandle(name, { create: false });
            return 'exists';
        } catch {
            fileHandle = await handle.getFileHandle(name, { create: true });
        }
        const writable = await fileHandle.createWritable();
        // Добавляем BOM (Byte Order Mark) для корректного отображения
        // кириллицы в Windows (Блокнот, старые программы).
        await writable.write('\uFEFF' + content);
        await writable.close();
        return 'saved';
    } catch (err) {
        console.error('[db-folder] Ошибка сохранения в папку базы:', err);
        return 'error';
    }
}

/** Fallback: скачать файл в "Загрузки". */
export function downloadFallback(name: string, content: string): void {
    // Добавляем BOM и явно указываем charset=utf-8
    const blob = new Blob(['\uFEFF' + content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}