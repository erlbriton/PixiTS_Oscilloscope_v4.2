// src/core/Channel.ts

export interface ChannelConfig {
    id: string;          // p00600
    name: string;        // Ustat
    description: string; // Напряжение статора
    dataType?: string;   // TFloat, TBit, TWORD, TDWORD, etc.
    value?: number | string;
    unit: string;        // B, A, Hz
    scale?: number;      // Множитель
    color?: string;
    min?: number;
    max?: number;
    customMax?: number;  // Ручной максимум
    rowHeight?: number;  // Высота строки в px
    autoScale?: boolean; // Флаг авто масштаба
    type?: 'analog' | 'digital';
    hexValue?: string;
    rawDecValue?: number;
    isBit?: boolean;
    modbusReg?: string;
}

const PALETTE = [
    '#38bdf8', '#34d399', '#f43f5e', '#fbbf24', '#a855f7',
    '#06b6d4', '#4ade80', '#f472b6', '#eab308', '#c084fc',
    '#60a5fa', '#a3e635', '#fb7185', '#f97316', '#818cf8'
];

let paletteIndex = 0;

export class Channel {
    public readonly id: string;
    public name: string;
    public description: string;
    public value: number | string;
    public hexValue: string;
    public rawDecValue: number;
    public scaledValue: number;
    public unit: string;
    public color: string;
    public min: number;
    public max: number;
    public type: 'analog' | 'digital';
    public dataType: string;
    public scale: number;
    public customMax: number;
    public rowHeight: number;
    public autoScale: boolean;
    public isBit: boolean;
    public modbusReg: string;
    public currentDisplayMin?: number;
    public currentDisplayMax?: number;

    constructor(config: ChannelConfig) {
        this.id = config.id;
        this.name = config.name;
        this.description = config.description || '';
        this.unit = config.unit || '';
        this.scale = config.scale !== undefined ? config.scale : 1.0;
        this.isBit = config.isBit || false;
        this.type = this.isBit ? 'digital' : 'analog';
        this.dataType = config.dataType || (this.isBit ? 'TBit' : 'TWORD');
        this.modbusReg = config.modbusReg || '';
        this.rowHeight = Math.max(25, config.rowHeight || 25);
        this.autoScale = config.autoScale !== undefined ? config.autoScale : true;

        this.rawDecValue = config.rawDecValue !== undefined ? config.rawDecValue : 0;
        this.hexValue = config.hexValue || ('0x' + (this.rawDecValue & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'));
        this.scaledValue = this.isBit ? this.rawDecValue : (this.rawDecValue * this.scale);
        this.value = this.scaledValue;

        this.color = config.color || PALETTE[(paletteIndex++) % PALETTE.length];
        this.min = config.min !== undefined ? config.min : (this.isBit ? 0 : -50);
        this.max = config.max !== undefined ? config.max : (this.isBit ? 1 : 500);
        this.customMax = config.customMax !== undefined ? config.customMax : this.max;
    }

    public updateRawValue(rawDec: number): void {
        this.rawDecValue = rawDec;
        if (this.isBit) {
            this.rawDecValue = rawDec > 0 ? 1 : 0;
            this.hexValue = this.rawDecValue === 1 ? '0x0001' : '0x0000';
            this.scaledValue = this.rawDecValue;
        } else {
            const typeUpper = (this.dataType || '').toUpperCase();
            if (typeUpper === 'TFLOAT' || typeUpper === 'TFLOAT32' || typeUpper === 'FLOAT' || typeUpper === 'REAL') {
                this.scaledValue = Math.round((rawDec * this.scale) * 1000) / 1000;
                const buf = new ArrayBuffer(4);
                const view = new DataView(buf);
                view.setFloat32(0, rawDec, false);
                const uintVal = view.getUint32(0, false);
                this.hexValue = '0x' + uintVal.toString(16).toUpperCase().padStart(8, '0');
            } else if (typeUpper === 'TDWORD' || typeUpper === 'TLONG' || typeUpper === 'TINT32') {
                this.scaledValue = Math.round((rawDec * this.scale) * 1000) / 1000;
                this.hexValue = '0x' + (rawDec >>> 0).toString(16).toUpperCase().padStart(8, '0');
            } else {
                this.scaledValue = Math.round((rawDec * this.scale) * 1000) / 1000;
                this.hexValue = '0x' + (Math.round(rawDec) & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
            }
        }
        this.value = this.scaledValue;
    }

    public getNumericValue(): number {
        return this.scaledValue;
    }
}
