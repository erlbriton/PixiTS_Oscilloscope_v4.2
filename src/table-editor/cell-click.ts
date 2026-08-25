// src/table-editor/cell-click.ts
// Обработка клика по групповым заголовкам "БАЗА" и "КОНТРОЛЛЕР".

/**
 * Вызывается при одиночном клике по групповому заголовку "БАЗА" или "КОНТРОЛЛЕР".
 * Пока — только диагностика с подсветкой. Реальное действие — на следующем шаге.
 */
export function handleGroupHeaderClick(
    th: HTMLElement,
    groupName: 'base' | 'controller',
): void {
    const label = groupName === 'base' ? 'БАЗА' : 'КОНТРОЛЛЕР';
    console.log(`[HEADER CLICK] Группа "${label}" — текст: "${th.innerText.trim()}"`);

    // Визуальная подсветка на 600 мс, чтобы пользователь видел отклик на клик
    th.style.transition = 'background-color 0.15s ease';
    th.style.backgroundColor = 'rgba(0, 120, 215, 0.35)';
    setTimeout(() => {
        th.style.backgroundColor = '';
    }, 600);
}