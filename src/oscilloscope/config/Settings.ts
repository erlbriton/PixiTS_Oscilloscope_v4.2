// src/config/Settings.ts

export interface ColumnWidths {
    name: number;
    description: number;
    value: number;
    unit: number;
}

export class Settings {
    public columnWidths: ColumnWidths = {
        name: 130,
        description: 80,
        value: 70,
        unit: 40,
    };

    public minRowHeight: number = 25; // minimum line height in px
    public rowHeight: number = 25; // height in px of each channel row (min 25px)
    public fontSize: number = 14; // font height/size in px corresponding to 25px row height
    public timeWindowMs: number = 2000; // total duration visible on screen (ms) (2s default)
    private baseTimeWindowMs: number = 2000;
    // Горизонтальная развертка: коэффициент масштаба времени (1 = норма)
    public timeScale: number = 1;
    public readonly minTimeScale: number = 0.1;  // «−» в 2 раза
    public readonly maxTimeScale: number = 10;    // «+» в 3 раза
    // Включена ли регулировка развертки колесом мыши (кнопка «Развертка»)
    public timeZoomEnabled: boolean = false;
    public setTimeScale(z: number): void {
        this.timeScale = Math.min(this.maxTimeScale, Math.max(this.minTimeScale, z));
        this.timeWindowMs = Math.round(this.baseTimeWindowMs / this.timeScale);
    }
    public showGrid: boolean = true;
    public gridDivisionsX: number = 10;
    public gridDivisionsY: number = 4;
    public autoScale: boolean = true;

    // Cursors
    public enableCursors: boolean = false;
    public cursorX1Percent: number = 25; // % of graph width
    public cursorX2Percent: number = 75; // % of graph width

    // Color theme
    public backgroundColor: string = '#050505';
    public gridColor: string = '#1f293d';
    public textColor: string = '#94a3b8';

    // Half window mode (default: true - occupy left half of browser)
        // Half window mode (default: true - occupy left half of browser)
    public isHalfWindow: boolean = true;

    // Timebase options in ms (100ms, 200ms, 500ms, 1s, 2s, 5s, 10s, 20s)
    public availableTimeWindows: number[] = [200, 500, 1000, 2000, 5000, 10000, 20000];

    // === УПРАВЛЕНИЕ ЗАПИСЬЮ И ПРОСМОТРОМ ИСТОРИИ ===
    
    // Идёт ли опрос контроллера (false = стоп, true = пуск)
    public isPolling: boolean = true;
    
    // Момент времени, относительно которого показываем данные (timestamp в мс)
    // null = следим за реальным временем (живой режим)
    public viewTime: number | null = null;
    
    // Следим ли за реальным временем (true = автопрокрутка, false = ручной просмотр)
    public isFollowingLive: boolean = true;

    /**
     * Переключает в режим просмотра истории
     * @param timestamp - момент времени для просмотра
     */
    public setViewTime(timestamp: number): void {
        this.viewTime = timestamp;
        this.isFollowingLive = false;
    }

    /**
     * Возвращает в режим слежения за реальным временем
     */
    public followLive(): void {
        this.viewTime = null;
        this.isFollowingLive = true;
    }

    /**
     * Возвращает текущий момент времени для отрисовки
     * Если следим за реальным временем - возвращает Date.now()
     */
                     public getCurrentViewTime(): number {
        // Если мы следим за реальным временем — показываем текущее время
        if (this.isFollowingLive) {
            return Date.now();
        }
        // Иначе показываем зафиксированное время (из скроллбара или кнопки Стоп)
        return this.viewTime ?? Date.now();
    }

    public updateColumnWidth(column: keyof ColumnWidths, width: number): void {
        this.columnWidths[column] = Math.max(30, width);
        this.applyCSSTemplateVariables();
    }

    public setRowHeight(height: number): void {
        this.rowHeight = Math.max(this.minRowHeight, height);
        this.applyCSSTemplateVariables();
    }

    public setFontSize(size: number): void {
        this.fontSize = Math.max(11, size);
        this.applyCSSTemplateVariables();
    }

    public applyCSSTemplateVariables(): void {
        document.documentElement.style.setProperty('--col-name', `${this.columnWidths.name}px`);
        document.documentElement.style.setProperty('--col-description', `${this.columnWidths.description}px`);
        document.documentElement.style.setProperty('--col-value', `${this.columnWidths.value}px`);
        document.documentElement.style.setProperty('--col-unit', `${this.columnWidths.unit}px`);
        document.documentElement.style.setProperty('--row-height', `${this.rowHeight}px`);
        document.documentElement.style.setProperty('--font-size', `${this.fontSize}px`);
    }
}
