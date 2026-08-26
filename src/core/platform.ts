/**
 * Определение платформы для UI-решений (например, доступности открытия папки).
 *
 * Бизнес-логика эту функцию НЕ использует — она остаётся платформо-независимой
 * и готовой к Tauri, где платформы определяются на стороне Rust.
 */

export function isLinux(): boolean {
    const ua = navigator.userAgent.toLowerCase();
    const platform = (navigator.platform || '').toLowerCase();
    return ua.includes('linux') || platform.includes('linux');
}

export function supportsDirectoryPicker(): boolean {
    // showDirectoryPicker работает только в Chromium-браузерах,
    // но мы включаем его только для Linux, чтобы избежать сюрпризов в Windows.
    return isLinux() && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}