# PixiTS Oscilloscope Integration Guide (v4.3)

This guide provides detailed instructions on how to embed the Oscilloscope module into a **Large Main Project** and control it externally. The oscilloscope no longer contains internal "Connect" or "File Open" buttons; it relies entirely on the main project to provide resources.

---

## 🚀 1. Quick Integration

### Step 1: Initialize the Module
Create the instance and mount it to your container.

```typescript
import { Oscilloscope } from './oscilloscope';

const osc = new Oscilloscope();
const container = document.getElementById('osc-container');
await osc.initialize(container);
```

---

## 🔌 2. Connecting the COM Port

The oscilloscope now waits for you to provide a `SerialPort` object. This allows your main project to manage the connection state.

### How to detect/wait for a port:
When your main project opens a COM port using the Web Serial API, simply pass the `SerialPort` object to the oscilloscope.

```typescript
// Example from your main project
async function onConnectSerial() {
    // 1. Request port from user
    const port = await navigator.serial.requestPort();
    
    // 2. Open the port with required baudRate
    await port.open({ baudRate: 115200 });

    // 3. Inject the port into the oscilloscope
    // The oscilloscope will automatically start reading data and polling Modbus
    osc.setSerialPort(port);
}
```

---

## 📑 3. Loading INI Files

The oscilloscope UI contains a panel on the right that displays loaded INI files. Since the "Select Files" button was removed, your main project must "push" these files into the module.

### How to load files:
You should prepare an array of `IniFileItem` objects and pass them to `setIniFiles`.

```typescript
// Prepare your files (e.g. from an <input type="file"> in main project)
const myFiles = [
    {
        id: 'file-1',
        name: 'motor_params.ini',
        size: 1234,
        lastModified: Date.now(),
        content: `[RAM]\np00600 = Speed / Actual Speed / TFloat / r0006 / RPM / 1.0`
    },
    {
        id: 'file-2',
        name: 'io_status.ini',
        size: 567,
        lastModified: Date.now(),
        content: `[RAM]\np00100 = Digital_In / DI Status / TFloat / r0020 / hex / 1.0`
    }
];

// Inject them into the oscilloscope
osc.setIniFiles(myFiles);
```

---

## 🎯 4. Switching Active INI Files

When the user clicks on a file in your main project's sidebar or list, you can tell the oscilloscope to switch its current configuration to match.

### How to switch:
Call `setActiveIni(id)` using the unique ID you provided in the `setIniFiles` step.

```typescript
// When user highlights a file in your main project UI
function onFileHighlighted(fileId: string) {
    // This will immediately update the oscilloscope table and graphs
    osc.setActiveIni(fileId);
}
```

---

## 🛠️ 5. Complete API Reference

| Method | Description |
| :--- | :--- |
| `initialize(container)` | Starts the oscilloscope and builds the UI. |
| `setSerialPort(port)` | **[NEW]** Injects an open `SerialPort`. Starts data acquisition immediately. |
| `setIniFiles(files)` | **[NEW]** Replaces the list of INI files in the right panel. |
| `setActiveIni(id)` | **[NEW]** Programmatically selects an INI file by its ID. |
| `loadIniContent(text)` | Manually parses and applies a raw INI string (bypasses the file list). |
| `destroy()` | Stops the engine and removes the UI. |

---

## 💡 6. Implementation Tips

1. **State Synchronization**: It is recommended to keep a reference to the `id` of your files in the main project that matches the `id` passed to the oscilloscope. This makes `setActiveIni` calls seamless.
2. **Reconnection**: If the serial port disconnects, the oscilloscope will show an error overlay. Your main project should re-call `setSerialPort` with a new (or re-opened) port object once available.
3. **Z-Index**: The oscilloscope uses fixed and relative positioning. Ensure your main project container has `position: relative` or `overflow: hidden` if you want to constrain it.

Кнопка "Свойства", стили - файл src/css/oscilloscope.css

Частота подачи записи при проверке цифровых выходов -  await new Promise(resolve => setTimeout(resolve, 100));  в файле src\oscilloscope\Oscilloscope.ts

------------------------------------------Кодировка файлов .rec---------------------------------------------------------------------------------------

📘 СПЕЦИФИКАЦИЯ ФОРМАТА ФАЙЛОВ .rec
(формат записи осциллографа старого аджастера ESM, www.intmash.ru)
Документ составлен по результатам побайтового анализа шести эталонных файлов, записанных старым аджастером, и подтверждён перекрёстной проверкой всех типов данных.
0. Общие сведения
Файл .rec состоит из двух частей, идущих строго последовательно:
Текстовый заголовок — INI-подобная структура из семи секций в фиксированном порядке.
Бинарная секция — сырые байты сразу после строки [binarydata].
Назначение файла — перенос временного окна графиков между приложениями: удалённый пользователь открывает .rec в своём аджастере и видит те же графики за тот же промежуток времени.
1. Текстовая часть
1.1 Кодировка и оформление
Кодировка текста — CP1251 (кириллица: CD E0 F1 EE F1 = «Насос»). Латиница и цифры — обычные однобайтовые коды.
Переводы строк — CRLF (0D 0A).
Секции разделяются пустой строкой (0D 0A 0D 0A).
Десятичный разделитель в числах с дробной частью — запятая (0,001, 0,118).
Файл начинается со строки [records].
1.2 Секция [records]
Единственная строка:

1
x — литеральный префикс.
8 цифр — число сэмплов N в верхнем регистре, с ведущими нулями.
Пример: counter=x000000A8 → N = 0xA8 = 168.
N — это количество временных меток и одновременно количество значений каждого параметра.
1.3 Секция [DEVICE]
Служебная информация об устройстве. Строки в наблюдавшемся порядке:

12345
Важно: LastDateTime — служебная дата устройства/конфигурации, она не совпадает с временем записи. Реальное время записи хранится только в бинарных временных метках.
1.4 Секция [window]
Настройки окна старого аджастера (положение, размеры, опции). Формат — числа, разделённые /, с / в конце:

12
На данные не влияет. При генерации файла допустимо копировать эталонные значения или писать свои.
1.5 Секция [viewoption]
Настройки отображения (ось Y) для каждого параметра:

1
Примеры: p04500=0,045455/50/, p03800=1/16/.
На данные не влияет; при чтении может игнорироваться, при записи — воспроизводиться.
1.6 Секция [paralist] — ключевая
Одна строка на параметр. Порядок строк определяет порядок блоков значений в бинарной части.
Общий шаблон (поля разделены /, в конце /):

1
Поле
Значение
ид
идентификатор вида p04500
имя
латиница, напр. DEX_STATE(TEST), Ssg
описание
CP1251, напр. «Состояние возбудителя»
тип
TWORD / TFloat / TBit / TInteger (других не бывает)
hex
x + 4 HEX-цифры — адрес параметра в протоколе
адрес
Modbus-адрес: r002D (слово) или r0005.D (регистр.бит у TBit)
ед
единицы измерения или --
scale
множитель с запятой (0,001, 0,118, 1)
размер
размер значения в байтах: 1 (TBit), 2 (TWORD/TInteger), 4 (TFloat)
доп1/доп2
служебные числа (0/0, 1/1 и т.п.), смысл неизвестен, на данные не влияют
Примеры строк:

1234
Особенность TBit: между hex и Modbus-адресом присутствует дополнительное поле (предположительно номер бита), из-за чего строка сдвинута; на бинарные данные это не влияет.
Максимальное число параметров — порядка 200.
1.7 Секция [vars]
Коэффициенты аналоговых входов устройства:

123
Частота дискретизации здесь не хранится (период выводится из временных меток). На декодирование Modbus-параметров не влияет.
1.8 Завершение текстовой части

1
Сразу после 0D 0A этой строки начинаются сырые байты. Пустой строки между заголовком и бинаром нет.
2. Бинарная часть
Состоит из двух блоков, идущих подряд без разделителей.
2.1 Блок А — временная шкала (общая для всех параметров)
N записей по 9 байт:

1
Время — Delphi TDateTime: количество дней с 30.12.1899 00:00:00.
Целая часть — дата, дробная — время суток.
Преобразование в Unix-миллисекунды: unix_ms = (T − 25569) × 86400000.
Обратное: T = unix_ms / 86400000 + 25569.
Пример: байты 29 F9 61 DB 58 95 E6 40 → T ≈ 46250.78 → 16.08.2026 ≈ 18:43.
Флаг — битовая маска служебных отметок:
0x80 — встречается на первой и/или последней записи;
0x01 — периодическая отметка (каждые ~20–30 записей), назначение неизвестно;
комбинации (0x81) возможны.
Наблюдения по шести файлам показали, что набор флагов не постоянен и старый аджастер читает файлы независимо от них.
Стратегия: при чтении флаг игнорируется; при записи ставится 0x80 первой записи и 0x00 остальным; окончательная проверка — кросс-тест открытием в старом аджастере.
2.2 Блок Б — значения параметров
Для каждого параметра в порядке [paralist] пишется подряд N значений фиксированной для типа длины. Блоки идут последовательно: сначала все N значений параметра 1, затем все N параметра 2 и т.д. Чередования нет.
Тип
Длина
Формат
Что хранится
TBit
1 байт
uint8
состояние бита: 0 или 1
TWORD
2 байта
uint16 LE
сырое слово регистра (raw, беззнаковое)
TInteger
2 байта
int16 LE, знаковый
сырое значение регистра (raw, со знаком)
TFloat
4 байта
float32 LE, IEEE 754
физическое значение (scale уже применён)
Физическое значение при чтении raw-типов: physical = raw × scale (scale из [paralist], запятая→точка).
Для TFloat physical читается как есть.
2.3 Формула размера бинарной части

1
где Sk — размер типа k-го параметра (1/2/4). Это даёт встроенную проверку целостности файла.
Пример (файл с 4 параметрами, N=261): 261×9 + 261×(2+4+4+4) = 2349 + 3654 = 6003 байта.
3. Побайтовые примеры декодирования
uint16 (TWORD): F1 01 → 0x01F1 = 497 (raw).
int16 (TInteger): B5 FB → 0xFBB5 → знаковое −1099; при scale 0,001 → −1.099.
float32 (TFloat): 4E 02 F0 C1 → 0xC1F0024E → ≈ −30.001 (physical).
uint8 (TBit): 01 → бит = 1.
float64 (время): см. п. 2.1.
4. Алгоритм ЧТЕНИЯ файла
Прочитать байты до строки [binarydata]\r\n; всё после — бинарь до конца файла.
Из [records] взять N = parseInt(после x, 16).
Из [paralist] по порядку взять список параметров: тип, scale, размер.
Проверка: файл_бинар_размер == N×9 + N×Σ(размеры). При несовпадении — ошибка формата.
Блок А: для i = 0..N−1 прочитать флаг (пропустить) и float64 LE → время[i].
Блок Б: для каждого параметра прочитать N значений его типа → массив значений.
Преобразовать: raw-типы × scale → physical; TBit как есть; TFloat как есть.
Построить графики по парам (время[i], значение[i]).
5. Алгоритм ЗАПИСИ файла
Сформировать текстовый заголовок: CP1251, CRLF, пустые строки между секциями; counter = x + N в HEX (8 цифр, верхний регистр).
[paralist] — в том же порядке, в котором будут писаться блоки значений; размеры 1/2/4 по типу.
Бинарь: сначала N меток времени (флаг 0x80 первой, 0x00 остальным + float64 LE TDateTime), затем блоки значений по порядку paralist.
Значения: TBit → uint8; TWORD → uint16 LE raw; TInteger → int16 LE raw (знаковое!); TFloat → float32 LE physical.
Все числа little-endian.
6. Неизвестные поля и принятые допущения
Элемент
Статус
Принято
Флаг 0x01 в метках
назначение неизвестно
при чтении игнорировать, при записи не ставить
доп1/доп2 в paralist
смысл неизвестен
воспроизводить как в исходном ini
«32» в строке TBit
предположительно номер бита
воспроизводить как есть
[window], [viewoption], [vars]
отображение/коэффициенты
копировать эталонные значения
LastDateTime
не время записи
писать текущую дату формирования файла
7. Чек-лист совместимости
CP1251 для кириллицы, запятая как разделитель.
CRLF везде, пустая строка между секциями.
counter в HEX с x, 8 цифр.
Порядок блоков = порядок paralist.
Времена — общий блок float64 LE TDateTime.
Размеры значений 1/2/4 по типу; int16 знаковый для TInteger.
Little-endian для всех многобайтовых чисел.
Контроль размера бинаря по формуле п. 2.3.
Кросс-тест: наш файл открывается старым аджастером; чужой файл — нашим приложением.
Готово. Если хотите, сохраним этот документ в проект (например, docs/REC_FORMAT.md), чтобы он был первоисточником при реализации. Скажите — и начнём планировать код чтения/записи, шаг за шагом.