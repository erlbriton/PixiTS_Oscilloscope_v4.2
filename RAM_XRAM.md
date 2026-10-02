Перенос доработки RAM/XRAM в браузерный аджастер
Этот файл — пошаговый чек-лист переноса функциональности переключения секций INI (RAM/XRAM) из нативного Tauri-аджастера в браузерный.

Все изменения не используют Tauri-специфичный код — работают в браузере как есть.

Порядок переноса — от простого к сложному, чтобы после каждого шага проект оставался рабочим.

================================================================================
ШАГ 1. ДОБАВИТЬ XRAM В ПАРСИРУЕМЫЕ СЕКЦИИ
================================================================================

Файл: src/core/ini/IniParser.ts

Найти строку:
const PARAM_SECTIONS: ReadonlySet<string> = new Set(['RAM', 'CD', 'FLASH']);

Заменить на:
// Секции INI, содержащие параметры (строки формата "key=value/.../.../").
// XRAM — исторически отдельная секция для диагностики; формат идентичен RAM.
const PARAM_SECTIONS: ReadonlySet<string> = new Set(['RAM', 'XRAM', 'CD', 'FLASH']);

Зачем: без этого парсер не видит секцию [XRAM], и getSection('XRAM')
возвращает пустой массив.

================================================================================
ШАГ 2. ДОБАВИТЬ ПОЛЕ И МЕТОДЫ В КЛАСС OSCILLOSCOPE
================================================================================

Файл: src/oscilloscope/Oscilloscope.ts

2.1. Добавить импорт

Найти блок:
import {
setChannels as channelsSetChannels,
updateVisibleChannels as channelsUpdateVisible,
setIniFiles as channelsSetIniFiles,
applyChannelConfigs as channelsApplyConfigs,
loadIniContent as channelsLoadIniContent,
setActiveIni as channelsSetActiveIni,
} from "./scope/OscilloscopeChannels";

Заменить на:
import {
setChannels as channelsSetChannels,
updateVisibleChannels as channelsUpdateVisible,
setIniFiles as channelsSetIniFiles,
applyChannelConfigs as channelsApplyConfigs,
loadIniContent as channelsLoadIniContent,
setActiveIni as channelsSetActiveIni,
setSectionMode as channelsSetSectionMode,
getSectionChannels as channelsGetSectionChannels,
} from "./scope/OscilloscopeChannels";

2.2. Добавить поле currentSectionMode

Найти блок (у вас поля currentIniConfig / appState):
private onPollingStateChangeCallback?: (isPolling: boolean) => void;
public currentIniConfig: IniConfig | null = null;
private appState: AppState | null = null;

Заменить на:
private onPollingStateChangeCallback?: (isPolling: boolean) => void;
public currentIniConfig: IniConfig | null = null;
/**

Текущий режим отображения параметров: какая секция INI используется

для каналов осциллографа. Переключается кнопками RAM/XRAM в окне

«Свойства просмотра параметров». Значение читают loadIniContent

(при загрузке файла) и file-loader (при применении INI из контекста).
*/
public currentSectionMode: 'RAM' | 'XRAM' = 'RAM';
private appState: AppState | null = null;

2.3. Добавить два метода-обёртки

Найти блок:
public async loadIniContent(iniContent: string): Promise<void> {
return channelsLoadIniContent(this, iniContent);
}

public async applyChannelConfigs(configs: ChannelConfig[]): Promise<void> {
return channelsApplyConfigs(this, configs);
}

Заменить на:
public async loadIniContent(iniContent: string): Promise<void> {
return channelsLoadIniContent(this, iniContent);
}

/**

Устанавливает активный режим отображения параметров (RAM/XRAM).

Вся логика — в OscilloscopeChannels.
*/
public async setSectionMode(mode: 'RAM' | 'XRAM'): Promise<void> {
return channelsSetSectionMode(this, mode);
}

/**

Возвращает каналы указанной секции (RAM/XRAM) без изменения состояния

осциллографа. Используется окном «Свойства просмотра параметров» для

предварительного показа списка параметров до нажатия «Применить».
*/
public getSectionChannels(mode: 'RAM' | 'XRAM'): Channel[] {
return channelsGetSectionChannels(this, mode);
}

public async applyChannelConfigs(configs: ChannelConfig[]): Promise<void> {
return channelsApplyConfigs(this, configs);
}

================================================================================
ШАГ 3. ДОБАВИТЬ ФУНКЦИИ В OSCILLOSCOPECHANNELS
================================================================================

Файл: src/oscilloscope/scope/OscilloscopeChannels.ts

3.1. Исправить loadIniContent — заменить хардкод 'RAM'

Найти:
const ramParams = iniConfig.getSection("RAM");
const channelConfigs = iniParamsToChannelConfigs(ramParams);

Заменить на:
// Секция берётся из текущего режима (RAM/XRAM), переключаемого
// кнопками в окне «Свойства просмотра параметров».
const sectionParams = iniConfig.getSection(osc.currentSectionMode);
const channelConfigs = iniParamsToChannelConfigs(sectionParams);

3.2. Добавить две новые функции (после loadIniContent, до setActiveIni)

/**

Устанавливает активный режим отображения (RAM/XRAM) и, если INI уже

загружен, пересобирает каналы из соответствующей секции.

Источник данных — osc.currentIniConfig (распарсенный INI-конфиг).

Если ни один из путей его не заполнил — переключается только флаг,

каналы останутся прежними до следующей загрузки INI.
*/
export async function setSectionMode(osc: Oscilloscope, mode: 'RAM' | 'XRAM'): Promise<void> {
if (osc.isDestroyed) return;
if (osc.currentSectionMode === mode) return;
osc.currentSectionMode = mode;
if (osc.currentIniConfig) {
const sectionParams = osc.currentIniConfig.getSection(mode);
const channelConfigs = iniParamsToChannelConfigs(sectionParams);
await osc.applyChannelConfigs(channelConfigs);
}
}

/**

Возвращает каналы указанной секции (RAM/XRAM) из уже распарсенного

конфига осциллографа, НЕ трогая сам осциллограф.

Используется окном «Свойства просмотра параметров»: когда пользователь

кликает RAM/XRAM, окно перезаполняет свои списки, но фактическое

переключение осциллографа происходит только по кнопке «Применить».
*/
export function getSectionChannels(osc: Oscilloscope, mode: 'RAM' | 'XRAM'): Channel[] {
if (osc.isDestroyed) return [];
const iniConfig = osc.currentIniConfig;
if (!iniConfig) return [];
const params = iniConfig.getSection(mode);
const configs = iniParamsToChannelConfigs(params);
return configs
.filter((c) => c && c.id)
.map((c) => new Channel(c));
}

================================================================================
ШАГ 4. ПРАВКА FILE-LOADER — СОХРАНЯТЬ CONFIG И БРАТЬ СЕКЦИЮ ИЗ РЕЖИМА
================================================================================

Файл: src/ini-manager/file-loader.ts

4.1. Внутри processSingleFileContent найти блок применения INI к осциллографу.

Было:
const osc = window.osc;
if (osc && typeof osc.applyChannelConfigs === 'function') {
try {
const ramParams = iniConfig.getSection('RAM');
const channelConfigs = iniParamsToChannelConfigs(ramParams);
await osc.applyChannelConfigs(channelConfigs);
} catch (oscErr: unknown) {
const msg = oscErr instanceof Error ? oscErr.message : String(oscErr);
console.error('[file-loader] applyChannelConfigs error:', oscErr);
showIdModal('Ошибка применения INI к осциллографу: ' + msg);
}
} else if (osc && typeof osc.loadIniContent === 'function') {

Стало:
// Осциллограф: используем уже распарсенный iniConfig.
// Секция берётся из текущего режима (RAM/XRAM), переключаемого
// кнопками в окне «Свойства просмотра параметров».
const osc = window.osc;
if (osc && typeof osc.applyChannelConfigs === 'function') {
try {
const sectionParams = iniConfig.getSection(osc.currentSectionMode);
const channelConfigs = iniParamsToChannelConfigs(sectionParams);
await osc.applyChannelConfigs(channelConfigs);
// Сохраняем распарсенный конфиг в осциллографе: по нему
// setSectionMode будет пересобирать каналы при переключении RAM/XRAM.
osc.currentIniConfig = iniConfig;
} catch (oscErr: unknown) {
const msg = oscErr instanceof Error ? oscErr.message : String(oscErr);
console.error('[file-loader] applyChannelConfigs error:', oscErr);
showIdModal('Ошибка применения INI к осциллографу: ' + msg);
}
} else if (osc && typeof osc.loadIniContent === 'function') {

================================================================================
ШАГ 5. HTML — ДОБАВИТЬ КНОПКИ RAM/XRAM В ОКНО СВОЙСТВ
================================================================================

Файл: index.html (или где лежит разметка окна «Свойства просмотра параметров»)

Найти футер окна (что-то вроде):

<div class="properties-modal-footer"> <div class="prop-settings-group"> <label class="prop-settings-label" for="prop-poll-delay">Пауза (мс):</label> <input class="prop-settings-input" type="number" id="prop-poll-delay" min="1" max="200" value="20" /> </div> <button class="toolbar-btn primary" id="prop-apply-btn">Применить</button> <button class="toolbar-btn" id="prop-cancel-btn">Отмена</button> </div>
Заменить на:

<div class="properties-modal-footer"> <div class="prop-settings-group"> <label class="prop-settings-label" for="prop-poll-delay">Пауза (мс):</label> <input class="prop-settings-input" type="number" id="prop-poll-delay" min="1" max="200" value="20" /> </div> <div class="prop-mode-group"> <button class="toolbar-btn prop-mode-btn primary" id="prop-mode-ram" type="button">RAM</button> <button class="toolbar-btn prop-mode-btn" id="prop-mode-xram" type="button">XRAM</button> </div> <div class="prop-footer-actions"> <button class="toolbar-btn primary" id="prop-apply-btn">Применить</button> <button class="toolbar-btn" id="prop-cancel-btn">Отмена</button> </div> </div>
Замечание: если разметка окна строится в TS через innerHTML (в
PropertiesModal.renderSkeleton), правьте там, а не в HTML.

================================================================================
ШАГ 6. CSS — ПЕРЕДЕЛАТЬ ФУТЕР ПОД GRID И ДОБАВИТЬ СТИЛИ КНОПОК
================================================================================

Файл: src/oscilloscope/styles/components.css

Найти:
.properties-modal-footer {
display: flex;
align-items: center;
justify-content: flex-end;
gap: 12px;
padding: 12px 20px;
background: #1a1a1d;
border-top: 1px solid #333;
}

.prop-settings-group {
display: flex;
align-items: center;
gap: 8px;
margin-right: auto;
}

Заменить на:
/* Футер окна «Свойства просмотра параметров».
Grid из трёх колонок: слева — «Пауза», по центру — RAM/XRAM,
справа — «Применить / Отмена». Центральная колонка auto по ширине
своего содержимого, крайние — по 1fr, что гарантирует центрирование
RAM/XRAM независимо от ширины левого и правого блоков. */
.properties-modal-footer {
display: grid;
grid-template-columns: 1fr auto 1fr;
align-items: center;
gap: 12px;
padding: 12px 20px;
background: #1a1a1d;
border-top: 1px solid #333;
}

.prop-settings-group {
display: flex;
align-items: center;
gap: 8px;
justify-self: start;
}

/* Группа кнопок RAM/XRAM — по центру футера. */
.prop-mode-group {
display: flex;
gap: 12px;
justify-self: center;
}

/* Кнопки RAM/XRAM: ширина такая же, как у «Применить». */
.prop-mode-btn {
min-width: 100px;
}

/* Правая группа: «Применить» и «Отмена» — в правом углу футера. */
.prop-footer-actions {
display: flex;
gap: 12px;
justify-self: end;
}

================================================================================
ШАГ 7. PROPERTIESMODAL — ЛОГИКА КНОПОК RAM/XRAM И «ПРИМЕНИТЬ»
================================================================================

Файл: src/oscilloscope/ui/PropertiesModal.ts

7.1. Добавить поле currentMode

Найти блок:
private onApplyCallback?: (newVisibleChannels: Channel[]) => void;
private onSettingsApplyCallback?: (settings: { pollDelayMs: number }) => void;

Заменить на:
private onApplyCallback?: (newVisibleChannels: Channel[]) => void;
private onSettingsApplyCallback?: (settings: { pollDelayMs: number }) => void;

/**

Текущий активный режим отображения параметров: RAM или XRAM.

Влияет на подсветку кнопок RAM/XRAM в футере и на то, какая секция

используется для заполнения списков. Состояние живёт в памяти:

переживает открытие/закрытие окна, но сбрасывается при перезапуске

приложения на значение по умолчанию (RAM).
*/
private currentMode: 'RAM' | 'XRAM' = 'RAM';

7.2. В конце конструктора применить начальное состояние

Найти:
this.renderSkeleton();
this.bindEvents();
}

Заменить на:
this.renderSkeleton();
this.bindEvents();

// Применяем текущее состояние (RAM по умолчанию) к уже отрисованным
// кнопкам. Разметка в renderSkeleton всегда создаёт RAM с классом primary,
// а currentMode может быть переключён (в том числе при будущей загрузке
// из настроек).
this.setMode(this.currentMode);
}

7.3. Добавить/заменить методы setMode и rebuildListsForMode

Найти существующий метод setMode:
private setMode(mode: 'RAM' | 'XRAM'): void {
this.currentMode = mode;
const ramBtn = this.modal.querySelector('#prop-mode-ram') as HTMLButtonElement | null;
const xramBtn = this.modal.querySelector('#prop-mode-xram') as HTMLButtonElement | null;
if (ramBtn) {
ramBtn.classList.toggle('primary', mode === 'RAM');
}
if (xramBtn) {
xramBtn.classList.toggle('primary', mode === 'XRAM');
}
}

Заменить на:
private setMode(mode: 'RAM' | 'XRAM', rebuildLists: boolean = false): void {
const modeChanged = this.currentMode !== mode;
this.currentMode = mode;
const ramBtn = this.modal.querySelector('#prop-mode-ram') as HTMLButtonElement | null;
const xramBtn = this.modal.querySelector('#prop-mode-xram') as HTMLButtonElement | null;
if (ramBtn) {
ramBtn.classList.toggle('primary', mode === 'RAM');
}
if (xramBtn) {
xramBtn.classList.toggle('primary', mode === 'XRAM');
}
if (rebuildLists && modeChanged) {
this.rebuildListsForMode(mode);
}
}

/**

Пересобирает списки «Все параметры» / «Просмотр» из указанной секции

текущего INI-конфига осциллографа. Осциллограф НЕ трогает — это

предварительный показ, фактическое переключение происходит по «Применить».
*/
private rebuildListsForMode(mode: 'RAM' | 'XRAM'): void {
const osc = (window as unknown as {
osc?: { getSectionChannels?: (m: 'RAM' | 'XRAM') => Channel[] };
}).osc;
if (!osc?.getSectionChannels) return;

const channels = osc.getSectionChannels(mode);
this.allChannels = channels;
this.currentRight = [...channels];
this.currentLeft = [];
this.selectedLeftIds.clear();
this.selectedRightIds.clear();
this.lastClickedLeftIndex = null;
this.lastClickedRightIndex = null;
this.updateLists();
}

7.4. В open() — синхронизировать подсветку с режимом осциллографа

Найти конец метода open():
this.selectedLeftIds.clear();
this.selectedRightIds.clear();
this.lastClickedLeftIndex = null;
this.lastClickedRightIndex = null;

this.updateLists();
this.overlay.style.display = 'flex';
}

Заменить на:
this.selectedLeftIds.clear();
this.selectedRightIds.clear();
this.lastClickedLeftIndex = null;
this.lastClickedRightIndex = null;

// Синхронизируем подсветку кнопок RAM/XRAM с текущим режимом
// осциллографа (единственный источник истины). Так при повторном
// открытии окна подсветка соответствует реальному состоянию.
const osc = (window as unknown as { osc?: { currentSectionMode?: 'RAM' | 'XRAM' } }).osc;
if (osc?.currentSectionMode) {
this.setMode(osc.currentSectionMode);
}

this.updateLists();
this.overlay.style.display = 'flex';
}

7.5. Переписать обработчики RAM/XRAM

Найти (если ещё нет — добавить в конце bindEvents):
this.modal.querySelector('#prop-mode-ram')?.addEventListener('click', () => this.setMode('RAM'));
this.modal.querySelector('#prop-mode-xram')?.addEventListener('click', () => this.setMode('XRAM'));

Заменить на:
// Кнопки выбора режима RAM/XRAM: переключают подсветку и пересобирают
// списки параметров из соответствующей секции (для предварительного
// выбора). Осциллограф пока не трогаем — фактическое переключение
// секции и закрытие окна происходят по кнопке «Применить».
this.modal.querySelector('#prop-mode-ram')?.addEventListener('click', () => this.setMode('RAM', true));
this.modal.querySelector('#prop-mode-xram')?.addEventListener('click', () => this.setMode('XRAM', true));

7.6. Переписать обработчик кнопки «Применить»

Найти:
this.modal.querySelector('#prop-apply-btn')?.addEventListener('click', () => {
const pollDelayInput = this.modal.querySelector('#prop-poll-delay') as HTMLInputElement;
let pollDelayMs = 20;
if (pollDelayInput) {
const val = parseInt(pollDelayInput.value, 10);
if (!isNaN(val) && val >= 1 && val <= 200) {
pollDelayMs = val;
}
}

if (this.onApplyCallback) {
this.onApplyCallback(this.currentRight);
}
if (this.onSettingsApplyCallback) {
this.onSettingsApplyCallback({ pollDelayMs });
}
this.close();
});

Заменить на:
this.modal.querySelector('#prop-apply-btn')?.addEventListener('click', async () => {
const pollDelayInput = this.modal.querySelector('#prop-poll-delay') as HTMLInputElement;
let pollDelayMs = 20;
if (pollDelayInput) {
const val = parseInt(pollDelayInput.value, 10);
if (!isNaN(val) && val >= 1 && val <= 200) {
pollDelayMs = val;
}
}

// Если режим изменился — сначала переключаем секцию осциллографа:
// это пересоберёт полный список каналов из новой секции и по
// умолчанию покажет все. После этого применяем пользовательский
// выбор видимых каналов (по id из новой секции).
const osc = (window as unknown as {
osc?: {
currentSectionMode?: 'RAM' | 'XRAM';
setSectionMode?: (m: 'RAM' | 'XRAM') => Promise<void>;
};
}).osc;
const modeChanged = osc?.currentSectionMode !== this.currentMode;
if (modeChanged) {
await osc?.setSectionMode?.(this.currentMode);
}
if (this.onApplyCallback) {
this.onApplyCallback(this.currentRight);
}
if (this.onSettingsApplyCallback) {
this.onSettingsApplyCallback({ pollDelayMs });
}
this.close();
});

================================================================================
ШАГ 8. READ-LOOP — ОПРОС ПО РЕГИСТРАМ ТЕКУЩЕЙ СЕКЦИИ
================================================================================

Файл: src/serial/read-loop.ts

8.1. В начале while — читать текущий режим

Найти:
while (serial && serial.isConnected && stateObj.isPolling) {
// Явная проверка на случай, если флаг изменился во время await
if (!stateObj.isPolling) {
console.log("[readLoop] Остановка цикла: isPolling стал false");
break;
}

Заменить на:
while (serial && serial.isConnected && stateObj.isPolling) {
// Явная проверка на случай, если флаг изменился во время await
if (!stateObj.isPolling) {
console.log("[readLoop] Остановка цикла: isPolling стал false");
break;
}

// Текущий режим отображения (RAM/XRAM) читаем из осциллографа
// на каждой итерации: пользователь может переключить его
// через «Свойства просмотра параметров» без перезапуска цикла.
// Опрос должен идти по регистрам той секции, из которой
// построены текущие каналы, иначе графики XRAM будут пустыми.
const sectionMode: 'RAM' | 'XRAM' =
(window as unknown as { osc?: { currentSectionMode?: 'RAM' | 'XRAM' } })
.osc?.currentSectionMode ?? 'RAM';

8.2. Заменить хардкод в getOptimizedBatches

Найти:
// 1. Формируем оптимальные батчи запросов Modbus
const batches = getOptimizedBatches(iniConfig, 'RAM', 10, 125);

Заменить на:
// 1. Формируем оптимальные батчи запросов Modbus
// по регистрам текущей секции (RAM или XRAM).
const batches = getOptimizedBatches(iniConfig, sectionMode, 10, 125);

8.3. Заменить хардкод в обходе параметров

Найти:
const ramParams: IniParameter[] = iniConfig.getSection('RAM');

Заменить на:
const ramParams: IniParameter[] = iniConfig.getSection(sectionMode);

================================================================================
ПРОВЕРКА
================================================================================

После переноса всех шагов:

npm run lint (или соответствующий скрипт) — 0 ошибок.

npm run tauri dev (или браузерная сборка) — приложение запускается.

Сценарий:

Открыть устройство из дерева — осциллограф показывает каналы RAM.

Открыть окно свойств — в правой половине «Просмотр» параметры RAM.

Кликнуть XRAM — окно НЕ закрывается, подсветка переключается,
списки перезаполняются параметрами XRAM (все в правой половине).

Убрать часть параметров в левую половину.

Нажать «Применить» — окно закрывается, осциллограф показывает XRAM
и только те каналы, что остались в правой половине.

Графики XRAM отображаются (при наличии секции [XRAM] в INI-файле).

Открыть окно свойств снова — кнопка XRAM подсвечена.

Нажать RAM → «Применить» — осциллограф вернётся к RAM.

Проверка «Отмена» после смены режима:

Открыть окно (режим RAM).

Кликнуть XRAM (списки пересобрались).

Нажать «Отмена» — осциллограф остался на RAM (переключение не
применяется, потому что setSectionMode не вызывался).

================================================================================
ОБЩИЕ ЗАМЕЧАНИЯ
================================================================================

Все правки не используют Tauri-специфичный код: нет window.TAURI,
нет @tauri-apps/*, нет Rust-команд. Работает в браузере как есть.

Единственная точка соприкосновения с внешним миром — window.osc.
В браузерном аджастере этот объект уже существует.

Если в браузерном аджастере структура функций в file-loader отличается
(например, INI применяется не через applyChannelConfigs, а через
loadIniContent), правку из Шага 4 нужно адаптировать: важно сохранить
iniConfig в osc.currentIniConfig, иначе setSectionMode не сможет
пересобрать каналы.

================================================================================
КОНЕЦ ФАЙЛА
================================================================================


