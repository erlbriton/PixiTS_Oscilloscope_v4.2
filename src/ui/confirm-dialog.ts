// src/ui/confirm-dialog.ts
// UI-слой: построение диалоговых окон.
// В нативном приложении этот модуль будет заменён на нативные диалоги —
// логика (table-editor) при этом не меняется, т.к. только вызывает эти функции.

/**
 * Универсальное окно подтверждения с большим зелёным "?".
 * Возвращает true при "Yes", false при "No"/закрытии.
 * Стили — инлайн, чтобы не зависеть от кэша CSS.
 */
function showConfirmDialog(message: string): Promise<boolean> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0, 0, 0, 0.35)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '10000';

        const dialog = document.createElement('div');
        dialog.style.background = '#f0f0f0';
        dialog.style.border = '1px solid #888';
        dialog.style.boxShadow = '0 4px 16px rgba(0,0,0,0.4)';
        dialog.style.width = 'auto';
        dialog.style.minWidth = '380px';
        dialog.style.fontFamily = 'Segoe UI, Arial, sans-serif';
        dialog.style.color = '#000';

        // Заголовок окна + крестик
        const titleBar = document.createElement('div');
        titleBar.style.display = 'flex';
        titleBar.style.justifyContent = 'space-between';
        titleBar.style.alignItems = 'center';
        titleBar.style.padding = '6px 10px';
        titleBar.style.background = '#fff';
        titleBar.style.borderBottom = '1px solid #ddd';
        const titleText = document.createElement('span');
        titleText.textContent = 'Confirm';
        titleText.style.fontWeight = '600';
        const closeX = document.createElement('span');
        closeX.textContent = '×';
        closeX.style.cursor = 'pointer';
        closeX.style.fontWeight = '700';
        titleBar.appendChild(titleText);
        titleBar.appendChild(closeX);

        // Контент: зелёная иконка "?" + текст
        const content = document.createElement('div');
        content.style.display = 'flex';
        content.style.alignItems = 'center';
        content.style.gap = '14px';
        content.style.padding = '20px 16px';

        const icon = document.createElement('div');
        icon.textContent = '?';
        icon.style.width = '44px';
        icon.style.height = '44px';
        icon.style.borderRadius = '50%';
        icon.style.background = 'radial-gradient(circle at 35% 30%, #4dd24d, #009000)';
        icon.style.color = '#fff';
        icon.style.fontWeight = '700';
        icon.style.fontSize = '28px';
        icon.style.display = 'flex';
        icon.style.alignItems = 'center';
        icon.style.justifyContent = 'center';
        icon.style.flex = '0 0 auto';

        const text = document.createElement('div');
        text.textContent = message;
        text.style.fontSize = '14px';
        text.style.whiteSpace = 'nowrap';

        content.appendChild(icon);
        content.appendChild(text);

        // Кнопки Yes / No
        const buttons = document.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.justifyContent = 'center';
        buttons.style.gap = '16px';
        buttons.style.padding = '0 16px 18px';

        const mkBtn = (label: string): HTMLButtonElement => {
            const b = document.createElement('button');
            b.textContent = label;
            b.style.minWidth = '80px';
            b.style.padding = '5px 12px';
            b.style.fontSize = '14px';
            return b;
        };
        const yesBtn = mkBtn('Yes');
        const noBtn = mkBtn('No');
        buttons.appendChild(yesBtn);
        buttons.appendChild(noBtn);

        dialog.appendChild(titleBar);
        dialog.appendChild(content);
        dialog.appendChild(buttons);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const close = (result: boolean): void => {
            overlay.remove();
            resolve(result);
        };

        yesBtn.addEventListener('click', () => close(true));
        noBtn.addEventListener('click', () => close(false));
        closeX.addEventListener('click', () => close(false));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(false);
        });
    });
}

/** Окно "Копировать параметры базы в контроллер?" */
export function showCopyBaseConfirm(): Promise<boolean> {
    return showConfirmDialog('Копировать параметры базы в контроллер?');
}

/** Окно "Копировать параметры контроллера в базу?" */
export function showCopyControllerConfirm(): Promise<boolean> {
    return showConfirmDialog('Копировать параметры контроллера в базу?');
}