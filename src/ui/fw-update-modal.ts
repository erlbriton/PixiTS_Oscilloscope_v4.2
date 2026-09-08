// src/ui/fw-update-modal.ts
// Модальное окно "Обновление программы устройства": показывается, когда
// ID устройства совпал (ID=...), но остальная часть ID-строки отличается
// от записанной в INI (другая версия/модель ПО).
// Действия кнопок подключаются следующим шагом — сейчас заглушки.

export interface FwUpdateInfo {
    /** Полная ID-строка, прочитанная из контроллера */
    idLine: string;
    /** Тип устройства (например DExS.PWR) */
    deviceType: string;
    /** Версия устройства */
    deviceVersion: string;
    /** Версия прошивки */
    firmwareVersion: string;
    /** Дата прошивки */
    firmwareDate: string;
}

export function initFwUpdateModal(): void {
    const overlay = document.getElementById('fwUpdateOverlay');
    if (!overlay) return;

    const hide = (): void => overlay.classList.add('hidden');

    document.getElementById('fwUpdateCloseBtn')?.addEventListener('click', hide);
    document.getElementById('fwUpdateCancelBtn')?.addEventListener('click', hide);
    overlay.addEventListener('click', (e: MouseEvent) => {
        if (e.target === overlay) hide();
    });
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (!overlay.classList.contains('hidden') && e.key === 'Escape') hide();
    });

    // Заглушки — действия подключим следующим шагом
    document.getElementById('fwUpdateCreateCopyBtn')?.addEventListener('click', () => {
        console.log('[FW-UPDATE] Кнопка "Создать резервную копию устройства" (действие будет подключено)');
    });
    document.getElementById('fwUpdateAddDeviceBtn')?.addEventListener('click', () => {
        console.log('[FW-UPDATE] Кнопка "Добавить устройство в базу" (действие будет подключено)');
    });
    document.getElementById('fwUpdateAddTemplateBtn')?.addEventListener('click', () => {
        console.log('[FW-UPDATE] Кнопка "Добавить шаблон" (действие будет подключено)');
    });

    console.log('[FW-UPDATE] Модальное окно "Обновление программы устройства" инициализировано.');
}

/** Заполняет поля и показывает окно */
export function showFwUpdateModal(info: FwUpdateInfo): void {
    const overlay = document.getElementById('fwUpdateOverlay');
    if (!overlay) return;

    console.log('[FW-UPDATE] Показываем окно с данными:', info);

    const set = (id: string, value: string): void => {
        const el = document.getElementById(id);
        if (el) (el as HTMLInputElement).value = value;
    };
    const setText = (id: string, value: string): void => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    // ID-строка: используем полную строку или собираем из частей
    const idLine = info.idLine || `${info.serial} ${info.deviceType} v${info.deviceVersion} ${info.firmwareVersion} ${info.firmwareDate}`;
    set('fwUpdateId', idLine);
    set('fwUpdateType', info.deviceType);
    setText('fwUpdateDevVersion', info.deviceVersion);
    setText('fwUpdateFwVersion', info.firmwareVersion);
    setText('fwUpdateFwDate', info.firmwareDate);

    overlay.classList.remove('hidden');
}

export function hideFwUpdateModal(): void {
    document.getElementById('fwUpdateOverlay')?.classList.add('hidden');
}