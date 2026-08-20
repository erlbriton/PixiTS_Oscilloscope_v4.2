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

  const PALETTE = [
    '#00d2ff', '#ff0055', '#00ff88', '#ffaa00', '#aa00ff', 
    '#00ffcc', '#ff5500', '#55ff00', '#0055ff', '#ff00aa'
  ];
  let bitIndex = 0;
  let paletteIdx = 0;

  const channels: Channel[] = recData.params.map((p: any) => {
    const isBit = p.recType === 'TBit';
    
    // Алгоритм цветов точно как в ini-to-channels.ts
    let color: string;
    if (isBit) {
      color = (bitIndex % 2 === 0) ? '#00d2ff' : '#d2a679';
      bitIndex++;
    } else {
      color = PALETTE[paletteIdx % PALETTE.length];
      paletteIdx++;
    }

    const config: ChannelConfig = {
      id: p.id,
      name: p.name,
      description: p.description,
      dataType: p.recType,
      // Жёстко убираем UNIT для бинарных параметров
      unit: isBit ? '' : (p.unit || ''),
      scale: p.scale,
      isBit: isBit,
      modbusReg: p.modbusReg,
      rawDecValue: 0,
      hexValue: 'x0000',
      min: isBit ? 0 : -50,
      max: isBit ? 1 : 500,
      autoScale: true,
      rowHeight: 25,
      color: color, // Применяем правильный цвет
      recRawParts: p.rawParts,
    };
    return new Channel(config);
  });

  await oscilloscope.setChannels(channels);

    const archive = oscilloscope.getArchive();
  const N = recData.timestamps.length;
  
  // Сортируем все данные по времени (старый аджастер делает то же самое)
  const indices = Array.from({ length: N }, (_, i) => i);
  indices.sort((a, b) => recData.timestamps[a] - recData.timestamps[b]);
  
  console.log(`[RecViewer] N=${N}, first_time=${recData.timestamps[indices[0]].toFixed(0)}, last_time=${recData.timestamps[indices[N-1]].toFixed(0)}, duration=${(recData.timestamps[indices[N-1]] - recData.timestamps[indices[0]]).toFixed(0)}ms`);
  
  // Добавляем в архив в отсортированном порядке
  for (let idx = 0; idx < N; idx++) {
    const i = indices[idx];
    const time = recData.timestamps[i];
    for (let pIdx = 0; pIdx < recData.params.length; pIdx++) {
      const val = recData.values[pIdx][i];
      archive.addSample(channels[pIdx].id, time, val, val);
    }
  }

  const range = oscilloscope.getArchive().getTimeRange();
  console.log(`[RecViewer] range.min=${range.min.toFixed(0)}, range.max=${range.max.toFixed(0)}`);
  console.log(`[RecViewer] range: min=${range.min.toFixed(0)}, max=${range.max.toFixed(0)}, duration=${(range.max - range.min).toFixed(0)}ms`);
  oscilloscope.setViewTime(range.max);
  console.log(`[RecViewer] frozenTime after setViewTime: ${oscilloscope.getArchive().getTimeRange().max.toFixed(0)}`);

  console.log(`[RecViewer] Загружено сэмплов: ${N}`);
}

// При старте создаем просмотрщик с тулбаром (файл открываем по клику на 📂)
void setupViewer();

console.log('[RecViewer] Страница просмотра загружена');