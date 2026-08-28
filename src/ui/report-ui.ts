// src/ui/report-ui.ts
/**
 * UI для отчётов: окно создания, предпросмотр, сохранение .xlsx.
 * Не зависит от serial — готово к Tauri.
 */
import { collectReportData } from '../core/report-data.js';
import { buildReportBlob } from '../core/excel-report.js';
import type { ReportData } from '../core/excel-report.js';

const LS_KEY_ORG = 'report:organization';
const LS_KEY_NUM = 'report:lastNumber';
const LS_KEY_AUTO = 'report:autoIncrement';
const DEFAULT_FILE_NAME = 'template.xlsx';

interface ReportUIDeps {
    /** Возвращает appState для доступа к currentIniConfig */
    getAppState: () => { currentIniConfig: unknown };
    /** Возвращает fileStore (Map ключ -> {file, handle, ...}) */
    getFileStore: () => Map<string, { file: File; handle?: unknown }>;
}

let deps: ReportUIDeps | null = null;
let lastGeneratedBlob: Blob | null = null;
let lastGeneratedData: ReportData | null = null;

export function initReportUI(uiDeps: ReportUIDeps): void {
    deps = uiDeps;

    // Кнопка 📋 (открыть окно создания отчёта)
    document.getElementById('clipboardBtn')?.addEventListener('click', () => {
        openCreateWindow();
    });

    // Кнопка "Создать отчёт"
    document.getElementById('reportCreateBtn')?.addEventListener('click', () => {
        void createReport();
    });

    // Кнопка "Закрыть" в окне создания
    document.getElementById('reportCreateCloseBtn')?.addEventListener('click', () => {
        hideOverlay('reportCreateOverlay');
    });

    // Кнопка "Сохранить..." в окне предпросмотра
    document.getElementById('reportSaveBtn')?.addEventListener('click', () => {
        void saveReport();
    });

    // Кнопка "Закрыть" в окне предпросмотра
    document.getElementById('reportPreviewCloseBtn')?.addEventListener('click', () => {
        hideOverlay('reportPreviewOverlay');
        lastGeneratedBlob = null;
        lastGeneratedData = null;
    });

    // Восстановить предыдущие значения
    restoreSavedValues();
}

function restoreSavedValues(): void {
    const org = localStorage.getItem(LS_KEY_ORG);
    const num = localStorage.getItem(LS_KEY_NUM);
    const auto = localStorage.getItem(LS_KEY_AUTO);
    const orgInput = document.getElementById('reportOrgInput') as HTMLInputElement | null;
    const numInput = document.getElementById('reportNumInput') as HTMLInputElement | null;
    const autoCheck = document.getElementById('reportAutoIncCheck') as HTMLInputElement | null;

    if (orgInput && org) orgInput.value = org;
    if (numInput && num) {
        const n = parseInt(num, 10);
        if (auto === '1') {
            numInput.value = String(n + 1);
        } else {
            numInput.value = String(n);
        }
    }
    if (autoCheck && auto === '1') autoCheck.checked = true;
}

function openCreateWindow(): void {
    resetProgress();
    showOverlay('reportCreateOverlay');
    const orgInput = document.getElementById('reportOrgInput') as HTMLInputElement | null;
    setTimeout(() => orgInput?.focus(), 0);
}

function showOverlay(id: string): void {
    document.getElementById(id)?.classList.remove('hidden');
}

function hideOverlay(id: string): void {
    document.getElementById(id)?.classList.add('hidden');
}

function setStatus(text: string): void {
    const el = document.getElementById('reportStatus');
    if (el) el.textContent = text;
}

function setProgress(percent: number): void {
    const bar = document.getElementById('reportProgressBar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function resetProgress(): void {
    setStatus('');
    setProgress(0);
}

function setButtonsLocked(locked: boolean): void {
    const createBtn = document.getElementById('reportCreateBtn') as HTMLButtonElement | null;
    const closeBtn = document.getElementById('reportCreateCloseBtn') as HTMLButtonElement | null;
    if (createBtn) createBtn.disabled = locked;
    if (closeBtn) closeBtn.disabled = locked;
}

async function createReport(): Promise<void> {
    if (!deps) return;

    const orgInput = document.getElementById('reportOrgInput') as HTMLInputElement | null;
    const numInput = document.getElementById('reportNumInput') as HTMLInputElement | null;
    const autoCheck = document.getElementById('reportAutoIncCheck') as HTMLInputElement | null;

    const organization = (orgInput?.value ?? '').trim() || 'ООО Интеллектуальные машины';
    const reportNumber = (numInput?.value ?? '1').trim() || '1';
    const autoInc = !!autoCheck?.checked;

    // Сохраняем настройки в localStorage
    localStorage.setItem(LS_KEY_ORG, organization);
    localStorage.setItem(LS_KEY_NUM, reportNumber);
    localStorage.setItem(LS_KEY_AUTO, autoInc ? '1' : '0');

    setButtonsLocked(true);
    try {
        setStatus('Сбор данных отчёта...');
        setProgress(10);

        const data = await collectReportData({
            appState: deps.getAppState() as never,
            fileStore: deps.getFileStore(),
            organization,
            reportNumber,
        });

        setProgress(40);
        setStatus('Формирование файла xlsx...');

        const blob = await buildReportBlob(data);

        setProgress(90);
        setStatus('Построение предпросмотра...');

        lastGeneratedBlob = blob;
        lastGeneratedData = data;
        renderPreview(data);

        setProgress(100);
        setStatus('Готово.');

        // Закрываем окно создания и показываем предпросмотр
        setTimeout(() => {
            hideOverlay('reportCreateOverlay');
            showOverlay('reportPreviewOverlay');
            resetProgress();
        }, 250);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus('Ошибка: ' + msg);
        setProgress(0);
        console.error('[report-ui] createReport error:', err);
    } finally {
        setButtonsLocked(false);
    }
}

function renderPreview(data: ReportData): void {
    const body = document.getElementById('reportPreviewBody');
    if (!body) return;

    const lines: string[] = [];
    lines.push('<table>');

    // Титул
    lines.push(`<tr><td colspan="8" class="report-title-cell">Отчёт о наладке оборудования</td></tr>`);
    lines.push('<tr><td colspan="8">&nbsp;</td></tr>');

    // Шапка
    lines.push(labelValueRow('№', data.reportNumber));
    lines.push(labelValueRow('Дата', data.reportDate));
    lines.push(labelValueRow('Организация', data.organization));
    lines.push('<tr><td colspan="8">&nbsp;</td></tr>');

    // Описание объекта
    lines.push(`<tr><td colspan="8" style="font-weight:bold">Описание объекта</td></tr>`);
    lines.push(labelValueRow('Механизм', data.mechanism));
    lines.push(labelValueRow('Место установки', data.installLocation));
    lines.push(labelValueRow('Тип устройства', data.deviceType));
    lines.push(labelValueRow('Серийный номер', data.serialNumber));
    lines.push(labelValueRow('Версия ПО', data.softwareVersion));
    lines.push(labelValueRow('Сектор памяти', data.memorySector));
    lines.push(labelValueRow('Файл базы', data.baseFile));
    lines.push(labelValueRow('Дата изменения базы', data.baseChangeDate));
    lines.push('<tr><td colspan="8">&nbsp;</td></tr>');

    // Уставки параметров
    lines.push(`<tr><td colspan="8" style="font-weight:bold">Уставки параметров</td></tr>`);
    lines.push('<tr><th>№</th><th>Параметр</th><th>Регистр</th><th>Коэфф</th><th>Комментарий</th><th>HEX</th><th>Physical</th><th>Ед.Изм.</th></tr>');
    for (const r of data.rows) {
        lines.push(
            `<tr><td>${esc(r.id)}</td><td>${esc(r.name)}</td><td>${esc(r.reg)}</td><td>${esc(r.scale)}</td>` +
            `<td>${esc(r.comment)}</td><td>${esc(r.hex)}</td><td>${esc(r.physical)}</td><td>${esc(r.unit)}</td></tr>`,
        );
    }
    lines.push('<tr><td colspan="8">&nbsp;</td></tr>');

    // Коэффициенты
    lines.push(`<tr><td colspan="8" style="font-weight:bold">Коэффициенты</td></tr>`);
    for (const c of data.coefficients) {
        lines.push(labelValueRow(c.name, c.value));
    }

    lines.push('</table>');
    body.innerHTML = lines.join('');
}

function labelValueRow(label: string, value: string): string {
    return (
        `<tr><td colspan="2" style="font-weight:bold">${esc(label)}</td>` +
        `<td colspan="6">${esc(value)}</td></tr>`
    );
}

function esc(s: string): string {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function saveReport(): Promise<void> {
    if (!lastGeneratedBlob) {
        setStatus('Нет данных для сохранения.');
        return;
    }

    const picker = (window as { showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;

    if (typeof picker === 'function') {
        try {
            const handle = await picker({
                suggestedName: DEFAULT_FILE_NAME,
                types: [
                    {
                        description: 'Excel Workbook',
                        accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
                    },
                ],
            });
            const writable = await handle.createWritable();
            await writable.write(lastGeneratedBlob);
            await writable.close();
            setStatus('Файл сохранён.');
            return;
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                // Пользователь отменил диалог
                return;
            }
            // Fallback — если picker упал (например, не поддерживается)
            console.warn('[report-ui] showSaveFilePicker failed, fallback to download:', err);
        }
    }

    // Fallback — скачать через <a download>
    const url = URL.createObjectURL(lastGeneratedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = DEFAULT_FILE_NAME;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Файл скачан.');
}