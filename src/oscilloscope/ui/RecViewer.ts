// src/oscilloscope/ui/RecViewer.ts
// Полноценный просмотрщик .rec файлов, повторяющий структуру основного осциллографа

import { Archive } from '../core/Archive';
import { Channel, ChannelConfig } from '../core/Channel';
import { Settings } from '../config/Settings';
import { Renderer } from '../graphics/Renderer';
import { PixiView } from '../graphics/PixiView';
import { TimelineScrollbar } from './TimelineScrollbar';
import { RecFileWriter, type RecParam, mapToRecDataType, recTypeByteCount } from '../core/RecFileWriter';
import type { RecFileData } from '../core/RecFileReader';
import type { IFileSaver } from '../../core/platform/fs';

export class RecViewer {
  private overlay: HTMLElement;
  private toolbar: HTMLElement;
  private graphContainer: HTMLElement;
  private timelineContainer: HTMLElement;
  private readoutPanel: HTMLElement;
  
  private settings: Settings;
  private archive: Archive;
  private renderer: Renderer;
  private channels: Channel[] = [];
  private pixiViews: Map<string, PixiView> = new Map();
  private scrollbar: TimelineScrollbar;
  
  private fileSaver: IFileSaver;
  private originalFilename: string;
  private recData: RecFileData;
  
  private isTimeZoomEnabled: boolean = false;
  private isAmplitudeMode: boolean = false;

  constructor(data: RecFileData, filename: string, fileSaver: IFileSaver) {
    this.recData = data;
    this.originalFilename = filename;
    this.fileSaver = fileSaver;
    this.settings = new Settings();
    this.archive = new Archive();
    this.renderer = new Renderer(this.settings, this.archive);

    // 1. DOM-структура
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: #050505; z-index: 9999; display: flex; flex-direction: column;
      font-family: sans-serif; color: #fff;
    `;

    this.toolbar = document.createElement('div');
    this.toolbar.style.cssText = `
      display: flex; align-items: center; padding: 8px 16px; 
      background: #111827; border-bottom: 1px solid #374151; gap: 8px;
    `;

    this.graphContainer = document.createElement('div');
    this.graphContainer.style.cssText = `
      flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 4px;
      position: relative;
    `;

    this.readoutPanel = document.createElement('div');
    this.readoutPanel.style.cssText = `
      height: 24px; background: #1f2937; border-top: 1px solid #374151; 
      display: flex; align-items: center; padding: 0 16px; font-size: 12px; color: #9ca3af;
    `;

    this.timelineContainer = document.createElement('div');
    this.timelineContainer.style.cssText = `
      height: 30px; background: #111827; border-top: 1px solid #374151;
    `;

    this.overlay.append(this.toolbar, this.graphContainer, this.readoutPanel, this.timelineContainer);
    this.scrollbar = new TimelineScrollbar(this.timelineContainer);
  }

  public open(): void {
    document.body.appendChild(this.overlay);
    this.initData();
    this.initUI();
    this.render(); // Отрисовываем один раз при открытии
  }

  private initData(): void {
    this.channels = this.recData.params.map((p: any) => {
      const config: ChannelConfig = {
        id: p.id,
        name: p.name,
        description: p.description,
        dataType: p.recType,
        unit: p.unit,
        scale: p.scale,
        isBit: p.recType === 'TBit',
        modbusReg: p.modbusReg,
        rawDecValue: 0,
        hexValue: '0x0000',
        min: p.recType === 'TBit' ? 0 : -50,
        max: p.recType === 'TBit' ? 1 : 500,
        autoScale: true,
        rowHeight: 100,
        recRawParts: p.rawParts,
      };
      return new Channel(config);
    });

    const N = this.recData.timestamps.length;
    for (let i = 0; i < N; i++) {
      const time = this.recData.timestamps[i];
      for (let pIdx = 0; pIdx < this.recData.params.length; pIdx++) {
        const val = this.recData.values[pIdx][i];
        const chId = this.channels[pIdx].id;
        this.archive.addSample(chId, time, val, val);
      }
    }

    const range = this.archive.getTimeRange();
    this.scrollbar.setRange(range.min, range.max);
    
    // ВАЖНО: Устанавливаем viewTime на конец диапазона, чтобы график был виден сразу
    this.settings.setViewTime(range.max);
    this.scrollbar.setPosition(range.max);
    
    const duration = range.max - range.min;
    const estimatedWidth = 1000;
    const pixelsPerDivision = 40;
    const divisions = estimatedWidth / pixelsPerDivision;
    this.settings.timeScale = duration > 0 ? duration / (divisions * 1000) : 1;
    
    this.performAutoScale();
  }

  private performAutoScale(): void {
    this.channels.forEach(ch => {
      const samples = this.archive.getAllSamples(ch.id);
      if (samples.length === 0) return;
      
      let min = Infinity;
      let max = -Infinity;
      for (const sample of samples) {
        if (sample.value < min) min = sample.value;
        if (sample.value > max) max = sample.value;
      }
      
      const range = max - min;
      const padding = range > 0 ? range * 0.1 : 1;
      
      ch.min = min - padding;
      ch.max = max + padding;
      ch.autoScale = true;
    });
  }

  private initUI(): void {
    // 1. Кнопка Закрыть
    const closeBtn = this.createToolBtn('✕ Закрыть', '#ef4444', () => this.close());
    
    // 2. Кнопка Развертка (Зум колесом)
    const zoomBtn = this.createToolBtn('🔍 Развертка', '#374151', () => {
      this.isTimeZoomEnabled = !this.isTimeZoomEnabled;
      zoomBtn.style.backgroundColor = this.isTimeZoomEnabled ? '#2563eb' : '#374151';
    });

    // 3. Кнопка Авто-масштаб
    const autoBtn = this.createToolBtn('📐 Авто', '#374151', () => {
      this.performAutoScale();
      this.render();
    });

    // 4. Кнопка Измерение величины сигнала
    const ampBtn = this.createToolBtn('📏 Измерение величины сигнала', '#374151', () => {
      this.isAmplitudeMode = !this.isAmplitudeMode;
      ampBtn.style.backgroundColor = this.isAmplitudeMode ? '#2563eb' : '#374151';
      if (!this.isAmplitudeMode) {
        this.readoutPanel.textContent = '';
      }
    });

    // 5. Кнопка Сохранить
    const saveBtn = this.createToolBtn('💾 Сохранить', '#2563eb', () => this.save());

    this.toolbar.append(closeBtn, zoomBtn, autoBtn, ampBtn, saveBtn);

    // Обработчик колеса мыши (работает ТОЛЬКО если включена Развертка)
    this.graphContainer.addEventListener('wheel', (e) => {
      if (!this.isTimeZoomEnabled) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      this.settings.timeScale *= factor;
      this.render();
    }, { passive: false });

    // Обработчик клика для маркера амплитуды
    this.graphContainer.addEventListener('click', (e) => {
      if (!this.isAmplitudeMode) return;
      const target = e.target as HTMLElement;
      const graphDiv = target.closest('[data-channel-id]');
      if (!graphDiv) return;
      
      const chId = graphDiv.getAttribute('data-channel-id');
      if (!chId) return;
      const channel = this.channels.find(c => c.id === chId);
      if (!channel) return;

      const rect = graphDiv.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      
      const viewTime = this.settings.getCurrentViewTime();
      const spacing = 40 * this.settings.timeScale;
      const duration = (width / spacing) * 1000;
      const startTime = viewTime - duration;
      const clickTime = startTime + (x / width) * duration;

      const val = this.archive.getValueAtTime(chId, clickTime);
      if (val !== null) {
        this.readoutPanel.textContent = `${channel.name}: ${val.toFixed(4)} ${channel.unit} @ ${new Date(clickTime).toLocaleTimeString()}`;
      }
    });

    // Обработчик скроллбара (перерисовываем только при скролле)
    this.scrollbar.onChange((position: number) => {
      this.settings.setViewTime(position);
      this.render();
    });
  }

  private createToolBtn(text: string, color: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = `background: ${color}; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; white-space: nowrap;`;
    btn.onclick = onClick;
    return btn;
  }

  private render(): void {
    // Если каналы еще не созданы в DOM, создаем их с полной структурой колонок
    if (this.pixiViews.size !== this.channels.length) {
      this.graphContainer.innerHTML = '';
      this.pixiViews.clear();

      this.channels.forEach(ch => {
        const row = document.createElement('div');
        // Сетка колонок: Имя(150px), Min(80px), Max(80px), Scale(80px), Ед(60px), График(1fr), Значение(100px)
        row.style.cssText = `
          display: grid; 
          grid-template-columns: 150px 80px 80px 80px 60px 1fr 100px; 
          align-items: center; 
          height: ${ch.rowHeight || 100}px; 
          background: #0f172a; 
          border-radius: 4px; 
          overflow: hidden; 
          margin-bottom: 4px;
          border: 1px solid #1e293b;
        `;
        
        // 1. Имя и описание
        const nameCol = document.createElement('div');
        nameCol.style.cssText = `padding: 0 8px; font-size: 12px; color: ${ch.color}; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-right: 1px solid #1e293b;`;
        nameCol.innerHTML = `<div>${ch.name}</div><div style="font-size:10px; color:#94a3b8; font-weight:normal;">${ch.description}</div>`;
        
        // 2. Min
        const minCol = document.createElement('div');
        minCol.style.cssText = `text-align: center; font-size: 11px; color: #cbd5e1; border-right: 1px solid #1e293b;`;
        minCol.textContent = ch.min.toFixed(2);
        
        // 3. Max
        const maxCol = document.createElement('div');
        maxCol.style.cssText = `text-align: center; font-size: 11px; color: #cbd5e1; border-right: 1px solid #1e293b;`;
        maxCol.textContent = ch.max.toFixed(2);
        
        // 4. Scale
        const scaleCol = document.createElement('div');
        scaleCol.style.cssText = `text-align: center; font-size: 11px; color: #cbd5e1; border-right: 1px solid #1e293b;`;
        scaleCol.textContent = ch.scale.toString();
        
        // 5. Ед. изм.
        const unitCol = document.createElement('div');
        unitCol.style.cssText = `text-align: center; font-size: 11px; color: #cbd5e1; border-right: 1px solid #1e293b;`;
        unitCol.textContent = ch.unit || '--';
        
        // 6. График
        const graphDiv = document.createElement('div');
        graphDiv.style.cssText = 'height: 100%; position: relative; min-width: 0;';
        graphDiv.setAttribute('data-channel-id', ch.id);
        
        // 7. Значение (Readout)
        const readoutCol = document.createElement('div');
        readoutCol.id = `readout-${ch.id}`;
        readoutCol.style.cssText = `text-align: right; padding-right: 12px; font-size: 14px; font-weight: bold; color: ${ch.color}; border-left: 1px solid #1e293b;`;
        readoutCol.textContent = '---';
        
        row.append(nameCol, minCol, maxCol, scaleCol, unitCol, graphDiv, readoutCol);
        this.graphContainer.appendChild(row);

        const pixiView = new PixiView(graphDiv);
        pixiView.init().then(() => {
          this.pixiViews.set(ch.id, pixiView);
          this.renderer.renderChannelGraph(ch, pixiView);
        });
      });
    } else {
      // Обновляем существующие графики и значения
      this.channels.forEach(ch => {
        const view = this.pixiViews.get(ch.id);
        if (view) {
          try {
            this.renderer.renderChannelGraph(ch, view);
            const val = this.archive.getValueAtTime(ch.id, this.settings.getCurrentViewTime());
            const readoutEl = document.getElementById(`readout-${ch.id}`);
            if (readoutEl && val !== null) {
              readoutEl.textContent = val.toFixed(4);
            }
          } catch (e) { /* ignore */ }
        }
      });
    }
  }

  private async save(): Promise<void> {
    try {
      const params: RecParam[] = this.channels.map(ch => {
        const recType = mapToRecDataType(ch.dataType) || 'TWORD';
        return {
          id: ch.id,
          name: ch.name,
          description: ch.description,
          recType,
          hexAddress: '',
          modbusReg: ch.modbusReg,
          unit: ch.unit || '--',
          scale: ch.scale,
          byteCount: recTypeByteCount(recType),
          rawParts: ch.recRawParts,
        };
      });

      const writer = new RecFileWriter();
      const bytes = writer.write({
        params,
        timestamps: this.recData.timestamps,
        values: this.recData.values,
        device: {
          id: this.recData.device.id,
          location: this.recData.device.location,
          description: this.recData.device.description,
          mcu: this.recData.device.mcu,
        }
      });

      await this.fileSaver.saveBinaryFile(this.originalFilename, bytes, 'application/octet-stream');
      alert('Файл успешно сохранён!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Ошибка сохранения .rec:', err);
      alert(`Ошибка при сохранении: ${msg}`);
    }
  }

  public close(): void {
    this.pixiViews.forEach(view => {
      try { view.destroy(); } catch (e) { /* ignore */ }
    });
    this.pixiViews.clear();
    this.overlay.remove();
  }
}