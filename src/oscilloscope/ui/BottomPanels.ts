// oscilloscope/ui/BottomPanels.ts

/**
 * Нижние панели осциллографа.
 *
 * Класс единолично владеет DOM-элементами нижних панелей
 * (командная строка + строка индикаторов) и предоставляет
 * наружу только типизированный API. Внешний код не обращается
 * к этим элементам через document.getElementById(...).
 */

/** Ячейки строки индикаторов (только чтение). */
export enum ReadoutSlot {
    /** Зарезервировано под будущие алгоритмы. */
    Reserved1 = 0,
    /** Зарезервировано под будущие алгоритмы. */
    Reserved2 = 1,
    /** Зарезервировано под будущие алгоритмы. */
    Reserved3 = 2,
    /** Процент горизонтальной развертки. */
    TimeScale = 3
}

export class BottomPanels {
    public static readonly READOUT_COUNT = 4;

    private readonly commandInput: HTMLInputElement;
    private readonly readCells: HTMLElement[];

    private onCommandInputCallback?: (text: string) => void;
    private onCommandSubmitCallback?: (text: string) => void;

    /**
     * @param root Контейнер #bottom-panels, переданный из Layout.createSkeleton().
     * @throws Ошибка сразу (fail-fast), если скелет разметки не содержит ожидаемых элементов.
     */
    constructor(root: HTMLElement) {
        const input = root.querySelector<HTMLInputElement>('#bottom-edit-input');
        if (!input) {
            throw new Error('[BottomPanels] В скелете не найден #bottom-edit-input.');
        }
        this.commandInput = input;

        this.readCells = [];
        for (let i = 0; i < BottomPanels.READOUT_COUNT; i++) {
            const cell = root.querySelector<HTMLElement>(`#read-cell-${i + 1}`);
            if (!cell) {
                throw new Error(`[BottomPanels] В скелете не найден #read-cell-${i + 1}.`);
            }
            this.readCells.push(cell);
        }

        this.commandInput.addEventListener('input', () => {
            if (this.onCommandInputCallback) {
                this.onCommandInputCallback(this.commandInput.value);
            }
        });

        this.commandInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && this.onCommandSubmitCallback) {
                this.onCommandSubmitCallback(this.commandInput.value);
            }
        });
    }

    // ---------------------------------------------------- Подписки

    /** Вызывается при каждом изменении текста командной строки. */
    public onCommandInput(cb: (text: string) => void): void {
        this.onCommandInputCallback = cb;
    }

    /** Вызывается при нажатии Enter в командной строке. */
    public onCommandSubmit(cb: (text: string) => void): void {
        this.onCommandSubmitCallback = cb;
    }

    // ---------------------------------------------------- Командная строка

    public setCommandText(text: string): void {
        this.commandInput.value = text;
    }

    public getCommandText(): string {
        return this.commandInput.value;
    }

    /** Фокус на командной строке, курсор — в конец текста. */
    public focusCommand(caretAtEnd: boolean = true): void {
        this.commandInput.focus();
        if (caretAtEnd) {
            const len = this.commandInput.value.length;
            this.commandInput.setSelectionRange(len, len);
        }
    }

    // ---------------------------------------------------- Индикаторы

    public setReadout(slot: ReadoutSlot, text: string): void {
        const cell = this.readCells[slot];
        if (cell) {
            cell.textContent = text;
        }
    }

    public getReadout(slot: ReadoutSlot): string {
        return this.readCells[slot]?.textContent ?? '';
    }
}