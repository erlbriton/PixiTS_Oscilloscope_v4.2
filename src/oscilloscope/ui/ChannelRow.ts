// src/ui/ChannelRow.ts

import { Channel } from '../core/Channel';
import { ContextMenu } from './ContextMenu';
import { ChannelPropertiesModal } from './ChannelPropertiesModal';

export class ChannelRow {
    private readonly element: HTMLDivElement;
    private readonly nameElement: HTMLDivElement;
    private readonly hexElement: HTMLDivElement;
    private readonly unitElement: HTMLDivElement;
    private readonly valueElement: HTMLDivElement;
    private readonly graphElement: HTMLDivElement;
    private readonly colorIndicator: HTMLSpanElement;
    private isVisible: boolean = true;
    private lastHex: string = "";
    private lastValue: string = "";

    public onChannelUpdated?: (channel: Channel) => void;
    public onDelete?: (channel: Channel) => void;
    public onSelect?: (channel: Channel) => void;
    public onToggleBit?: (channel: Channel) => void;

    constructor(public readonly channel: Channel) {
        this.element = document.createElement('div');
        this.element.className = 'channel-row';
        this.element.style.height = `${this.channel.rowHeight}px`;
        this.element.dataset.channelId = channel.id;

        // 1. Колонка Имя (Name)
        this.nameElement = document.createElement('div');
        this.nameElement.className = 'col-name';

        this.colorIndicator = document.createElement('span');
        this.colorIndicator.className = 'channel-color-indicator';
        this.colorIndicator.style.backgroundColor = channel.color;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'channel-title';
        titleSpan.textContent = channel.name;
        titleSpan.title = `${channel.name} (${channel.description})`;

        this.nameElement.append(this.colorIndicator, titleSpan);

        // 2. Колонка HEX значение (hex)
        this.hexElement = document.createElement('div');
        this.hexElement.className = 'col-description';
        this.hexElement.textContent = channel.hexValue;
        this.hexElement.style.fontFamily = 'monospace';
        this.hexElement.style.color = '#38bdf8';

        // 3. Колонка Unit
        this.unitElement = document.createElement('div');
        this.unitElement.className = 'col-unit';
        this.unitElement.textContent = channel.unit;

        // 4. Колонка Physical (Value)
        this.valueElement = document.createElement('div');
        this.valueElement.className = 'col-value';

        // 5. Колонка Graph
        this.graphElement = document.createElement('div');
        this.graphElement.className = 'col-graph';

        this.element.append(
            this.nameElement,
            this.hexElement,
            this.valueElement,
            this.unitElement,
            this.graphElement,
        );

        this.updateValue();

        this.element.addEventListener("click", () => {
            const container = this.element.parentElement;
            if (container) {
                container
                    .querySelectorAll(".channel-row.selected")
                    .forEach((el) => {
                        if (el !== this.element) el.classList.remove("selected");
                        this.element.addEventListener("dblclick", () => {
                            if (this.channel.isBit && this.onToggleBit) {
                                this.onToggleBit(this.channel);
                            }
                        });
                    });
            }
            this.element.classList.add("selected");
            if (this.onSelect) {
                this.onSelect(this.channel);
            }
        });

        this.element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const container = this.element.parentElement;
            if (container) {
                container.querySelectorAll('.channel-row.selected').forEach(el => {
                    if (el !== this.element) el.classList.remove('selected');
                });
            }
            this.element.classList.add('selected');
            if (this.onSelect) {
                this.onSelect(this.channel);
            }
            ContextMenu.getInstance().show(e.clientX, e.clientY, [
                {
                    label: 'Удалить',
                    danger: true,
                    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
                    onClick: () => {
                        this.setVisible(false);
                        if (this.onDelete) {
                            this.onDelete(this.channel);
                        }
                    }
                },
                {
                    label: 'Свойства',
                    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
                    onClick: () => {
                        this.openProperties();
                    }
                }
            ]);
        });
    }

    public openProperties(): void {
        const modal = new ChannelPropertiesModal(this.channel, (updatedChannel, visible) => {
            this.updateHeaderUI();
            this.setVisible(visible);
            if (this.onChannelUpdated) {
                this.onChannelUpdated(updatedChannel);
            }
        });
        modal.open(this.isVisible);
    }

    public updateHeaderUI(): void {
        this.colorIndicator.style.backgroundColor = this.channel.color;
        const titleSpan = this.nameElement.querySelector('.channel-title');
        if (titleSpan) {
            titleSpan.textContent = this.channel.name;
            titleSpan.setAttribute('title', `${this.channel.name} (${this.channel.description})`);
        }
        this.unitElement.textContent = this.channel.unit;
        this.element.style.height = `${this.channel.rowHeight}px`;
    }

    public setVisible(visible: boolean): void {
        this.isVisible = visible;
        this.element.style.display = visible ? '' : 'none';
    }

    public getIsVisible(): boolean {
        return this.isVisible;
    }

    public attach(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    public remove(): void {
        if (this.element.parentElement) {
            this.element.parentElement.removeChild(this.element);
        }
    }

    private getContrastColor(hexColor: string): string {
        if (!hexColor || !hexColor.startsWith('#')) return '#000000';
        let hex = hexColor.replace('#', '');
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join('');
        }
        const r = parseInt(hex.substring(0, 2), 16) || 0;
        const g = parseInt(hex.substring(2, 4), 16) || 0;
        const b = parseInt(hex.substring(4, 6), 16) || 0;
        const yiq = (r * 299 + g * 587 + b * 114) / 1000;
        return yiq >= 128 ? '#0a0a0b' : '#ffffff';
    }

    public updateValue(): void {
        if (!this.isVisible) return;

        if (this.channel.dataType.toUpperCase() === 'TIPADDR') {
            const num = Math.floor(this.channel.rawDecValue) >>> 0;
            const hex = 'x' + num.toString(16).toUpperCase().padStart(8, '0');
            const ip = `${(num >>> 24) & 0xFF}.${(num >>> 16) & 0xFF}.${(num >>> 8) & 0xFF}.${num & 0xFF}`;
            this.applyHexText(hex);
            this.applyValueText(ip);
            return;
        }

        const isDiscrete = this.channel.isBit || this.channel.type === 'digital';

        if (isDiscrete) {
            const val = this.channel.scaledValue;
            const displayVal = typeof val === 'number' ? val.toString() : String(val);
            const textColor = this.getContrastColor(this.channel.color);
            this.applyHexHtml(`<span class="discrete-value-square" style="background-color: ${this.channel.color}; color: ${textColor};">${displayVal}</span>`);
            this.applyValueText('');
        } else {
            const val = this.channel.scaledValue;
            const valueText = typeof val === 'number'
                ? (Number.isInteger(val) ? val.toString() : val.toFixed(3))
                : String(val);
            this.applyHexText(this.channel.hexValue);
            this.applyValueText(valueText);
        }
    }

    private applyHexText(text: string): void {
        if (text === this.lastHex) return;
        this.lastHex = text;
        this.hexElement.textContent = text;
    }

    private applyHexHtml(html: string): void {
        if (html === this.lastHex) return;
        this.lastHex = html;
        this.hexElement.innerHTML = html;
    }

    private applyValueText(text: string): void {
        if (text === this.lastValue) return;
        this.lastValue = text;
        this.valueElement.textContent = text;
    }

    public getGraphContainer(): HTMLElement {
        return this.graphElement;
    }

    public getElement(): HTMLElement {
        return this.element;
    }
}