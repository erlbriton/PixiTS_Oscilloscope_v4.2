// src/ui/Resizer.ts

import { Settings, ColumnWidths } from '../config/Settings';

export class Resizer {
    private settings: Settings;
    private headerElement: HTMLElement;
    private isResizing: boolean = false;

    constructor(settings: Settings, headerElement: HTMLElement) {
        this.settings = settings;
        this.headerElement = headerElement;
    }

    public initialize(): void {
        const columns: { name: keyof ColumnWidths; selector: string }[] = [
            { name: 'name', selector: '.col-name' },
            { name: 'description', selector: '.col-description' },
            { name: 'value', selector: '.col-value' },
            { name: 'unit', selector: '.col-unit' }
        ];

        columns.forEach(col => {
            const headerCol = this.headerElement.querySelector(col.selector) as HTMLElement;
            if (headerCol) {
                const handle = document.createElement('div');
                handle.className = 'col-resizer';
                headerCol.appendChild(handle);

                this.bindColumnResize(handle, col.name);
            }
        });
    }

    private bindColumnResize(handle: HTMLElement, colKey: keyof ColumnWidths): void {
        handle.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            this.isResizing = true;
            handle.classList.add('resizing');

            const startX = e.clientX;
            const startWidth = this.settings.columnWidths[colKey];

            const onMouseMove = (moveEvent: MouseEvent) => {
                if (!this.isResizing) return;
                const deltaX = moveEvent.clientX - startX;
                const newWidth = Math.max(35, startWidth + deltaX);
                this.settings.updateColumnWidth(colKey, newWidth);
            };

            const onMouseUp = () => {
                this.isResizing = false;
                handle.classList.remove('resizing');
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }
}
