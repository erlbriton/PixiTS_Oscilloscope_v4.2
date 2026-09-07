// src/ui/param-properties-ui.ts
/**
 * Окно "Свойства параметра": открывается по двойному клику на строке таблицы
 * параметров. Заполняет поля данными параметра, даёт редактировать шкалу и
 * зависимость. "Применить" пока просто закрывает окно — логика сохранения
 * будет добавлена следующим шагом.
 */
import { markDirty } from '../ini-manager/dirty-tracker.js';
import { float32ToHex } from '../ini-manager/tree-core.js';
import { updateCellDisplay, updateMismatchClass } from '../table-editor/controller-write.js';

/** ID параметра, для которого сейчас открыто окно свойств */
let currentParamId: string | null = null;

interface ParamInfo {
    id: string;
    name: string;
    description: string;
    unit: string;
    scale: string | number;
}

interface ScaleEntry {
    name: string;
    value: string;
}

const SCALE_TABLE: ScaleEntry[] = [
    { name: 'IntegerScale', value: '1' },
    { name: 'FracDecScale', value: '0.1' },
    { name: 'FracHundScale', value: '0.01' },
    { name: 'FracThousScale', value: '0.001' },
    { name: 'FracDecThousScale', value: '0.0001' },
];

function getScaleValue(scaleName: string): string {
    const entry = SCALE_TABLE.find((s) => s.name === scaleName);
    return entry ? entry.value : '1';
}

function scaleNameFromParam(scale: string | number): string {
    if (typeof scale === 'string') {
        if (SCALE_TABLE.some((s) => s.name === scale)) return scale;
        // Строка-число ("0.1", "0.01"...) — ищем по значению
        const byValue = SCALE_TABLE.find((s) => s.value === scale);
        if (byValue) return byValue.name;
    } else if (typeof scale === 'number') {
        const byValue = SCALE_TABLE.find((s) => s.value === String(scale));
        if (byValue) return byValue.name;
    }
    return 'IntegerScale';
}

export function initParamPropertiesUI(): void {
    const overlay = document.getElementById('paramPropsOverlay');
    if (!overlay) return;

    const scaleSelect = document.getElementById('paramPropsScaleSelect') as HTMLSelectElement | null;
    const scaleValue = document.getElementById('paramPropsScaleValue') as HTMLInputElement | null;

    // Автообновление числового эквивалента при смене шкалы
    scaleSelect?.addEventListener('change', () => {
        if (scaleValue) scaleValue.value = getScaleValue(scaleSelect.value);
    });

    const closeBtn = document.getElementById('paramPropsCloseBtn');
    const applyBtn = document.getElementById('paramPropsApplyBtn');
    const cancelBtn = document.getElementById('paramPropsCancelBtn');

    const hide = (): void => {
        overlay.classList.add('hidden');
    };

    closeBtn?.addEventListener('click', hide);
    applyBtn?.addEventListener('click', () => {
      // Сохраняем изменённый коэффициент в parts и пересчитываем значение
      if (currentParamId) {
        const row = document.querySelector<HTMLTableRowElement>(
          `#grid-data-rows tr[data-key="${CSS.escape(currentParamId)}"]`
        );
        if (row) {
          let parts: string[] = [];
          try { parts = JSON.parse(row.dataset.parts || '[]'); } catch {}

          const coefficientInput = document.getElementById('paramPropsCoefficient') as HTMLInputElement | null;
          if (coefficientInput && coefficientInput.value.trim()) {
            const newMultiplier = coefficientInput.value.trim().replace(',', '.');
            if (parts.length > 9) {
              parts[9] = newMultiplier;
              console.log(`[PARAM-PROPS] ${currentParamId}: множитель обновлён на ${newMultiplier}`);

              // Пересчёт значения зависимого параметра: база × множитель
              const dependsOn = (parts[8] ?? '').trim();
              const mult = parseFloat(newMultiplier);
              if (dependsOn && !isNaN(mult)) {
                const baseRow = document.querySelector<HTMLTableRowElement>(
                  `#grid-data-rows tr[data-name="${CSS.escape(dependsOn)}"]`
                );
                if (baseRow) {
                  const basePhysText = (baseRow.querySelectorAll('td')[5]?.textContent || '').trim();
                  const baseValue = parseFloat(basePhysText.replace(',', '.'));
                  if (!isNaN(baseValue)) {
                    const newValue = baseValue * mult;
                    const newValueStr = Number.isInteger(newValue)
                      ? newValue.toString()
                      : newValue.toFixed(4);

                    const dataType = (row.getAttribute('data-type') || '').toUpperCase();
                    const hexIndex = parseInt(row.getAttribute('data-hex-index') || '-1', 10);
                    const is32Bit = dataType.includes('FLOAT') || dataType.includes('DWORD') ||
                      dataType.includes('LONG') || dataType.includes('INT32');

                    let scale = 1.0;
                    if (parts.length > 6 && parts[6]) {
                      const parsedScale = parseFloat(parts[6].replace(',', '.'));
                      if (!isNaN(parsedScale) && parsedScale !== 0) scale = parsedScale;
                    }

                    let newHex: string;
                    if (dataType.includes('FLOAT')) {
                      const hexStr = float32ToHex(newValue / scale);
                      newHex = 'x' + hexStr.toUpperCase();
                    } else {
                      const rawVal = Math.round(newValue / scale);
                      if (is32Bit) {
                        newHex = 'x' + rawVal.toString(16).toUpperCase().padStart(8, '0');
                      } else {
                        newHex = 'x' + (rawVal & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
                      }
                    }

                    if (hexIndex >= 0 && hexIndex < parts.length) {
                      parts[hexIndex] = newHex;
                    }

                    row.dataset.parts = JSON.stringify(parts);

                    const tds = row.querySelectorAll('td');
                    updateCellDisplay(tds[4], newHex);
                    updateCellDisplay(tds[5], newValueStr);
                    updateMismatchClass(row, dataType);

                    console.log(`[PARAM-PROPS] ${currentParamId}: значение пересчитано = ${newValueStr} (${dependsOn} × ${mult})`);
                  }
                } else {
                  console.warn(`[PARAM-PROPS] Базовый параметр "${dependsOn}" не найден в таблице`);
                }
              } else {
                // Зависимости нет — просто сохраняем множитель
                row.dataset.parts = JSON.stringify(parts);
              }
            }
          }

          markDirty(currentParamId);
        }
      }
      hide();
    });
    cancelBtn?.addEventListener('click', hide);

    overlay.addEventListener('click', (e: MouseEvent) => {
        if (e.target === overlay) hide();
    });

    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (!overlay.classList.contains('hidden') && e.key === 'Escape') {
            hide();
        }
    });
}

/**
 * Открывает окно свойств параметра, заполняя поля данными param.
 * allSiblings — остальные параметры той же секции (для списка "Зависит от").
 */
export function showParamPropertiesModal(param: ParamInfo, allSiblings: ParamInfo[]): void {
    const overlay = document.getElementById('paramPropsOverlay');
    if (!overlay) return;

    // Запоминаем, какой параметр открыт — нужно для кнопки Apply
    currentParamId = param.id;

    const nameInput = document.getElementById('paramPropsName') as HTMLInputElement | null;
    const descInput = document.getElementById('paramPropsDescription') as HTMLInputElement | null;
    const unitInput = document.getElementById('paramPropsUnit') as HTMLInputElement | null;
    const scaleSelect = document.getElementById('paramPropsScaleSelect') as HTMLSelectElement | null;
    const scaleValue = document.getElementById('paramPropsScaleValue') as HTMLInputElement | null;
    const dependsSelect = document.getElementById('paramPropsDependsSelect') as HTMLSelectElement | null;
    const coefficient = document.getElementById('paramPropsCoefficient') as HTMLInputElement | null;

    if (nameInput) nameInput.value = param.name ?? '';
    if (descInput) descInput.value = param.description ?? '';
    if (unitInput) unitInput.value = (param.unit ?? '').replace('*', '—');

    // Шкала: выбираем по имени, число справа — эквивалент.
    const scaleName = scaleNameFromParam(param.scale);
    if (scaleSelect) scaleSelect.value = scaleName;
    if (scaleValue) scaleValue.value = getScaleValue(scaleName);

    // Получаем parts из строки таблицы
    const row = document.querySelector<HTMLTableRowElement>(
        `#grid-data-rows tr[data-key="${CSS.escape(param.id)}"]`
    );
    let parts: string[] = [];
    if (row) {
        try { parts = JSON.parse(row.dataset.parts || '[]'); } catch {}
    }

    const dependsOn = (parts[8] ?? '').trim();
    const multiplier = (parts[9] ?? '').trim();

    // "Зависит от": выпадающий список с одним элементом, заблокированный
    // (пользователь не может изменить — зависимость задаётся только в INI)
    if (dependsSelect) {
        dependsSelect.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = dependsOn;
        opt.textContent = dependsOn || '—';
        dependsSelect.appendChild(opt);
        dependsSelect.value = dependsOn;
        dependsSelect.disabled = true;
        dependsSelect.style.backgroundColor = '#f0f0f0';
    }

    // Коэффициент: редактируемое поле
    if (coefficient) {
        coefficient.value = multiplier.replace('.', ',');
    }

    overlay.classList.remove('hidden');
}