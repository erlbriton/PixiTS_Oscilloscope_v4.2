/**
 * Отслеживание несохранённых изменений параметров INI-файла.
 * Хранит Set идентификаторов параметров, которые были изменены
 * в таблице или модальном окне свойств, но ещё не сохранены на диск.
 */

const dirtyParams = new Set<string>();

/** Пометить параметр как изменённый (несохранённый) */
export function markDirty(paramId: string): void {
  dirtyParams.add(paramId);
  console.log(`[DirtyTracker] Параметр помечен как изменённый: ${paramId}`);
}

/** Снять пометку с одного параметра */
export function clearDirty(paramId: string): void {
  dirtyParams.delete(paramId);
}

/** Очистить все пометки (обычно после сохранения файла) */
export function clearAllDirty(): void {
  dirtyParams.clear();
  console.log('[DirtyTracker] Все пометки сняты.');
}

/** Проверить, изменён ли конкретный параметр */
export function isDirty(paramId: string): boolean {
  return dirtyParams.has(paramId);
}

/** Есть ли хотя бы один несохранённый параметр */
export function hasAnyDirty(): boolean {
  return dirtyParams.size > 0;
}

/** Получить список всех несохранённых параметров (для диагностики) */
export function getDirtyParams(): string[] {
  return Array.from(dirtyParams);
}