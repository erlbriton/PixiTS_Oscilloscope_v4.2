// src/core/encoding.ts

/**
 * Кодирование строки в windows-1251 (для записи INI-файлов на диск).
 * Обратная таблица строится один раз на основе браузерного TextDecoder.
 */

let win1251Map: Map<string, number> | null = null;

function getWin1251Map(): Map<string, number> {
    if (win1251Map) return win1251Map;
    win1251Map = new Map<string, number>();
    const decoder = new TextDecoder('windows-1251');
    for (let b = 0; b < 256; b++) {
        const ch = decoder.decode(new Uint8Array([b]))[0];
        if (!win1251Map.has(ch)) win1251Map.set(ch, b);
    }
    return win1251Map;
}

/** Кодировать строку в байты windows-1251. Несопоставимые символы -> '?' */
export function encodeWindows1251(text: string): Uint8Array<ArrayBuffer> {
    const map = getWin1251Map();
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) {
            bytes[i] = code;
        } else {
            bytes[i] = map.get(text[i]) ?? 0x3f;
        }
    }
    return bytes;
}