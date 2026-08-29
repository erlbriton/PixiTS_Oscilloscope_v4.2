// src/ui/param-properties-ui.ts
/**
 * Окно "Свойства параметра": открывается по двойному клику на строке таблицы
 * параметров. Заполняет поля данными параметра, даёт редактировать шкалу и
 * зависимость. "Применить" пока просто закрывает окно — логика сохранения
 * будет добавлена следующим шагом.
 */

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
    applyBtn?.addEventListener('click', hide); // Заглушка: просто закрываем
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

    const nameInput = document.getElementById('paramPropsName') as HTMLInputElement | null;
    const descInput = document.getElementById('paramPropsDescription') as HTMLInputElement | null;
    const unitInput = document.getElementById('paramPropsUnit') as HTMLInputElement | null;
    const scaleSelect = document.getElementById('paramPropsScaleSelect') as HTMLSelectElement | null;
    const scaleValue = document.getElementById('paramPropsScaleValue') as HTMLInputElement | null;
    const dependsSelect = document.getElementById('paramPropsDependsSelect') as HTMLSelectElement | null;
    const dependsSide = document.getElementById('paramPropsDependsSide') as HTMLInputElement | null;
    const coefficient = document.getElementById('paramPropsCoefficient') as HTMLInputElement | null;
    const yx = document.getElementById('paramPropsYX') as HTMLInputElement | null;

    if (nameInput) nameInput.value = param.name ?? '';
    if (descInput) descInput.value = param.description ?? '';
    if (unitInput) unitInput.value = (param.unit ?? '').replace('*', '—');

    // Шкала: выбираем по имени, число справа — эквивалент.
    const scaleName = scaleNameFromParam(param.scale);
    if (scaleSelect) scaleSelect.value = scaleName;
    if (scaleValue) scaleValue.value = getScaleValue(scaleName);

    // "Зависит от": все id других параметров секции, кроме текущего.
    if (dependsSelect) {
        dependsSelect.innerHTML = '';
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '—';
        dependsSelect.appendChild(emptyOpt);
        for (const sibling of allSiblings) {
            if (sibling.id === param.id) continue;
            const opt = document.createElement('option');
            opt.value = sibling.id;
            opt.textContent = sibling.id;
            dependsSelect.appendChild(opt);
        }
        dependsSelect.value = '';
    }
    if (dependsSide) dependsSide.value = ''; // Заглушка
    if (coefficient) coefficient.value = ''; // Заглушка
    if (yx) yx.value = ''; // Заглушка

    overlay.classList.remove('hidden');
}