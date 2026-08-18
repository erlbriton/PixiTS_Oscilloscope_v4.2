// src/oscilloscope/ui/RecViewer.ts
//
// Модальное окно для просмотра и сохранения файлов .rec

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
  
  private settings: Settings;
  private archive: Archive;
  private renderer: Renderer;
  private channels: Channel[] = [];
  private pixiViews: Map<string, PixiView> = new Map();
  private scrollbar: TimelineScrollbar;
  
  private fileSaver: IFileSaver;
  private originalFilename: string;
  private recData: RecFileData;

  constructor(data: RecFileData, filename: string, fileSaver: IFileSaver) {
    this.recData = data;
    this.originalFilename = filename;
    this.fileSaver = fileSaver;
    this.settings = new Settings();
    this.archive = new Archive();
    this.renderer = new Renderer(this.settings, this.archive);

    // 1. Создаём DOM-структуру
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: #050505; z-index: 9999; display: flex; flex-direction: column;
    `;

    // Toolbar
    this.toolbar = document.createElement('div');
    this.toolbar.style.cssText = `
      display: flex; align-items: center; padding: 8px 16px; 
      background: #111827; border-bottom: 1px solid #374151; gap: 8px;
    `;

    // Графики
    this.graphContainer = document.createElement('div');
    this.graphContainer.style.cssText = `
      flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 4px;
    `;

    // Скроллбар
    this.timelineContainer = document.createElement('div');
    this.timelineContainer.style.cssText = `
      height: 30px; background: #111827; border-top: 1px solid #374151;
    `;

    this.overlay.append(this.toolbar, this.graphContainer, this.timelineContainer);
    this.scrollbar = new TimelineScrollbar(this.timelineContainer);
  }

  public open(): void {
    document.body.appendChild(this.overlay);
    this.initData();
    this.initUI();
    this.render();
  }

    private initData(): void {
    // ВАЖНО: Создаём каналы ТОЛЬКО из распарсенных данных .rec файла
    // Не берём все каналы из INI!
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
        autoScale: true, // Включаем автомасштаб по умолчанию
        rowHeight: 100, // Увеличиваем высоту строки для нормального отображения
        recRawParts: p.rawParts,
      };
      return new Channel(config);
    });

    // Заполняем архив только для каналов из .rec
    const N = this.recData.timestamps.length;
    for (let i = 0; i < N; i++) {
      const time = this.recData.timestamps[i];
      for (let pIdx = 0; pIdx < this.recData.params.length; pIdx++) {
        const val = this.recData.values[pIdx][i];
        const chId = this.channels[pIdx].id;
        this.archive.addSample(chId, time, val, val);
      }
    }

    // Настраиваем скроллбар на диапазон данных
    const range = this.archive.getTimeRange();
    this.scrollbar.setRange(range.min, range.max);
    this.scrollbar.setPosition(range.max);
  }

  private initUI(): void {
    // Кнопка Закрыть
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Закрыть';
    closeBtn.style.cssText = 'background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; margin-right: auto;';
    closeBtn.onclick = () => this.close();

    // Кнопка Авто-масштаб
    const autoBtn = document.createElement('button');
    autoBtn.textContent = '📐 Авто';
    autoBtn.style.cssText = 'background: #374151; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;';
    autoBtn.onclick = () => {
      this.channels.forEach(ch => { ch.autoScale = true; });
      this.render();
    };

    // Кнопка Сохранить
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 Сохранить .rec';
    saveBtn.style.cssText = 'background: #2563eb; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;';
    saveBtn.onclick = () => this.save();

    this.toolbar.append(closeBtn, autoBtn, saveBtn);
  }

   private render(): void {
    this.graphContainer.innerHTML = '';
    this.pixiViews.clear();

    this.channels.forEach(ch => {
      const row = document.createElement('div');
      // Увеличиваем высоту строки до 100px для нормального отображения
      row.style.cssText = `
        display: flex; 
        align-items: center; 
        height: ${ch.rowHeight || 100}px; 
        background: #0f172a; 
        border-radius: 4px; 
        overflow: hidden;
        margin-bottom: 4px;
      `;
      
      // Метка канала
      const label = document.createElement('div');
      label.style.cssText = `
        width: 150px; 
        padding: 0 12px; 
        font-size: 13px; 
        color: ${ch.color}; 
        font-weight: bold; 
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis;
        flex-shrink: 0;
      `;
      label.textContent = `${ch.name} (${ch.unit})`;
      
      // Контейнер графика
      const graphDiv = document.createElement('div');
      graphDiv.style.cssText = 'flex: 1; height: 100%; position: relative; min-width: 0;';
      
      row.append(label, graphDiv);
      this.graphContainer.appendChild(row);

      const pixiView = new PixiView(graphDiv);
      pixiView.init().then(() => {
        this.pixiViews.set(ch.id, pixiView);
        this.renderer.renderChannelGraph(ch, pixiView);
      });
    });
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