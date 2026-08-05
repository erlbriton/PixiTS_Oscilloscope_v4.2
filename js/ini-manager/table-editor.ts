export function clearAnyActiveCellEditors(): void {
    document.querySelectorAll<HTMLElement>('.is-editing-cell').forEach(el => {
        if ((el as any).blurEditor) (el as any).blurEditor();
    });
}

export function initHexCellEditor(cellHex, tr, parts, hexIndex, updateRowValues, dataType, scale, originalHexLen, prmListOptions): void {
    cellHex.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
    });
}

export function initPhysicalCellEditor(cellPhysical, tr, parts, dataType, scale, hexIndex, originalHexLen, prmListOptions, updateRowValues, hexToFloat32, float32ToHex): void {
    cellPhysical.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
    });
}
