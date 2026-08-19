// src/rec-viewer.ts
// Точка входа для страницы просмотра .rec файлов (отдельная вкладка)

import { RecFileReader } from './oscilloscope/core/RecFileReader.js';
import { RecFileWriter } from './oscilloscope/core/RecFileWriter.js';
import { Oscilloscope } from './oscilloscope/Oscilloscope.js';
import { Channel, ChannelConfig } from './oscilloscope/core/Channel.js';

let oscilloscope: Oscilloscope | null = null;
let currentRecData: any = null;
let currentFilename: string = '';

const container = document.getElementById('rec-viewer-container') as HTMLElement;
const filePicker = document.getElementById('filePicker') as HTMLInputElement;

// === Сохранение .rec ===
async function saveRec(): Promise<void> {
  if (!currentRecData) {
    alert('Нет данных для сохранения');
    return;
  }
  try {
    const writer = new RecFileWriter();
    const bytes = writer.write(currentRecData);
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFilename;
    a.click();
    URL.revokeObjectURL(url);
    alert('Файл сохранён!');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alert(`Ошибка сохранения: ${msg}`);
  }
}

// === Обработчик выбора файла ===
filePicker.addEventListener('change', async () => {
  if (!filePicker.files || filePicker.files.length === 0) return;
  const file = filePicker.files[0];
  try {
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const reader = new RecFileReader();
    const recData = reader.parse(uint8Array);

    currentRecData = recData;
    currentFilename = file.name;

    await loadRecData(recData);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[RecViewer] Ошибка:', err);
    alert(`Не удалось открыть файл:\n${message}`);
  }
});

// === Создание просмотрщика (вызывается один раз при старте) ===
async function setupViewer(): Promise<void> {
  container.innerHTML = '';

  oscilloscope = new Oscilloscope({ skipSerial: true, skipRecorder: true, viewerMode: true });
  await oscilloscope.initialize(container);

  // Файловые кнопки в ЕДИНОМ тулбаре осциллографа
  oscilloscope.addViewerButton('✕', 'Закрыть', () => window.close());
  oscilloscope.addViewerButton('📂', 'Открыть .rec', () => filePicker.click());
  oscilloscope.addViewerButton('💾', 'Сохранить .rec', () => { void saveRec(); });

  // Применяем финальное выравнивание и перемещение кнопок в конец
  oscilloscope.finalizeViewerToolbar();
}

// === Загрузка данных .rec в уже созданный осциллограф ===
async function loadRecData(recData: any): Promise<void> {
  if (!oscilloscope) return;

  const channels: Channel[] = recData.params.map((p: any) => {
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
      rowHeight: 25,
      recRawParts: p.rawParts,
    };
    return new Channel(config);
  });

  await oscilloscope.setChannels(channels);

  const archive = oscilloscope.getArchive();
  const N = recData.timestamps.length;
  for (let i = 0; i < N; i++) {
    const time = recData.timestamps[i];
    for (let pIdx = 0; pIdx < recData.params.length; pIdx++) {
      const val = recData.values[pIdx][i];
      archive.addSample(channels[pIdx].id, time, val, val);
    }
  }

  // Фиксируем время на конце записанных данных — маркеры застывают
  const range = oscilloscope.getArchive().getTimeRange();
  oscilloscope.setViewTime(range.max);

  console.log(`[RecViewer] Загружено сэмплов: ${N}`);
}

// При старте создаем просмотрщик с тулбаром (файл открываем по клику на 📂)
void setupViewer();

console.log('[RecViewer] Страница просмотра загружена');