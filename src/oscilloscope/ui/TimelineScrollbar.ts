// src/oscilloscope/ui/TimelineScrollbar.ts

export class TimelineScrollbar {
    private container: HTMLElement;
    private slider: HTMLInputElement;
    private onChangeCallback?: (timestamp: number) => void;
    
    // Диапазон времени в архиве (в миллисекундах)
    private minTime: number = 0;
    private maxTime: number = 0;
    
    constructor(container: HTMLElement) {
        this.container = container;
        this.slider = document.createElement('input');
        this.slider.type = 'range';
        this.slider.min = '0';
        this.slider.max = '100';
        this.slider.value = '100'; // По умолчанию — самый правый край (текущее время)
        this.slider.step = '1';
        
        this.slider.className = 'timeline-slider';
        
        // Событие изменения позиции ползунка
        this.slider.addEventListener('input', () => {
            this.handleSliderChange();
        });
        
        this.container.appendChild(this.slider);
    }

    /**
     * Обновляет диапазон скроллбара на основе архива
     * @param minTime - самый старый timestamp в архиве
     * @param maxTime - самый новый timestamp в архиве
     */
    public setRange(minTime: number, maxTime: number): void {
        this.minTime = minTime;
        this.maxTime = maxTime;
        
        // Устанавливаем диапазон слайдера
        this.slider.min = String(minTime);
        this.slider.max = String(maxTime);
        
        // Если ползунок был на максимуме (живой режим), оставляем его там
        if (parseInt(this.slider.value) === this.maxTime) {
            this.slider.value = String(maxTime);
        }
    }

    /**
     * Устанавливает текущую позицию просмотра
     * @param timestamp - момент времени для отображения
     */
    public setPosition(timestamp: number): void {
        if (timestamp >= this.minTime && timestamp <= this.maxTime) {
            this.slider.value = String(timestamp);
        }
    }

    /**
     * Регистрирует callback при изменении позиции
     */
    public onChange(callback: (timestamp: number) => void): void {
        this.onChangeCallback = callback;
    }

    /**
     * Обрабатывает изменение позиции ползунка
     */
    private handleSliderChange(): void {
        const timestamp = parseInt(this.slider.value);
        if (this.onChangeCallback) {
            this.onChangeCallback(timestamp);
        }
    }

    /**
     * Возвращает true, если ползунок находится в самом правом краю (живой режим)
     */
    public isAtLivePosition(): boolean {
        return parseInt(this.slider.value) >= this.maxTime - 100; // Допуск 100мс
    }

    public destroy(): void {
        this.container.innerHTML = '';
    }
}