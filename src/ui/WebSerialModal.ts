// src/ui/WebSerialModal.ts

import { Serial } from '../comm/Serial';

export class WebSerialModal {
    private serial: Serial;
    private modalOverlay: HTMLElement | null = null;
    private onConnectSuccessCallback?: () => void;

    constructor(serial: Serial) {
        this.serial = serial;
    }

    public onConnectSuccess(cb: () => void): void {
        this.onConnectSuccessCallback = cb;
    }

    public open(errorMessage?: string): void {
        if (this.modalOverlay) return;

        const isIframe = window.self !== window.top;
        const isSupported = this.serial.isWebSerialSupported();

        this.modalOverlay = document.createElement('div');
        this.modalOverlay.className = 'modal-overlay';

        let statusNoticeHtml = '';

        if (!isSupported) {
            statusNoticeHtml = `
                <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; border-radius: 8px; padding: 12px; margin-bottom: 16px; color: #fca5a5; font-size: 13px; line-height: 1.5;">
                    ❌ <strong>Web Serial API не поддерживается вашим браузером.</strong><br>
                    Для подключения к реальным COM-портам (USB-UART / RS485 / STM32 / Arduino) используйте браузер <strong>Google Chrome</strong>, <strong>Microsoft Edge</strong> или <strong>Opera</strong>.
                </div>
            `;
        } else if (isIframe) {
            statusNoticeHtml = `
                <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; border-radius: 8px; padding: 14px; margin-bottom: 16px; color: #fcd34d; font-size: 13px; line-height: 1.5;">
                    ⚠️ <strong>Ограничение фрейма предварительного просмотра (iframe)</strong><br>
                    Браузеры блокируют прямой доступ к железу (COM-портам) внутри встроенных окон. <br><br>
                    👉 <strong>Чтобы подключить COM-порт:</strong><br>
                    Нажмите на кнопку ниже, чтобы открыть осциллограф в <strong>новой вкладке браузера</strong>. В новой вкладке нажмите <strong>🔌 Web Serial</strong> — появится диалог выбора портов вашей системы!
                    
                    <div style="margin-top: 12px; text-align: center;">
                        <button class="toolbar-btn primary" id="open-tab-btn" style="padding: 8px 16px; font-weight: 600;">
                            🚀 Открыть в новой вкладке браузера
                        </button>
                    </div>
                </div>
            `;
        } else if (errorMessage) {
            statusNoticeHtml = `
                <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; border-radius: 8px; padding: 12px; margin-bottom: 16px; color: #fca5a5; font-size: 13px; line-height: 1.5;">
                    ℹ️ ${errorMessage}
                </div>
            `;
        }

        this.modalOverlay.innerHTML = `
            <div class="modal-content" style="max-width: 540px;">
                <div class="modal-header">
                    <span class="modal-title">🔌 Подключение к COM-порту (Web Serial API)</span>
                    <button class="modal-close" id="serial-modal-close-btn">&times;</button>
                </div>

                ${statusNoticeHtml}

                <div class="form-group" style="font-size: 13px; color: #cbd5e1; line-height: 1.6;">
                    <strong>Поддерживаемые форматы данных:</strong>
                    <ul style="margin: 6px 0 12px 20px; padding: 0;">
                        <li><strong>ASCII текст:</strong> Числа через запятую, пробел или двоеточие (например <code>12.5, 3.14, -0.8\\n</code>). Автоматически распределяются по каналам CH1..CH4.</li>
                        <li><strong>Modbus RTU:</strong> Стандартный ответ функции 0x03 / 0x04.</li>
                    </ul>
                </div>

                <div class="form-group">
                    <label style="font-size: 12px; color: #94a3b8; display: block; margin-bottom: 4px;">Скорость передачи (Baud Rate):</label>
                    <select id="modal-baud-select" class="toolbar-select" style="width: 100%; padding: 8px;">
                        <option value="9600">9600 Baud</option>
                        <option value="19200">19200 Baud</option>
                        <option value="38400">38400 Baud</option>
                        <option value="57600">57600 Baud</option>
                        <option value="115200" selected>115200 Baud (Стандарт)</option>
                        <option value="230400">230400 Baud</option>
                    </select>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px;">
                    <span style="font-size: 12px; color: #64748b;">
                        Текущий статус: <strong style="color: ${this.serial.getState() === 'connected' ? '#10b981' : '#f59e0b'}">${this.serial.getState().toUpperCase()}</strong>
                    </span>
                    <div style="display: flex; gap: 8px;">
                        ${this.serial.getState() === 'connected' ? `
                            <button class="toolbar-btn" id="modal-disconnect-btn" style="background: #ef4444; color: white;">
                                🔌 Отключить
                            </button>
                        ` : `
                            <button class="toolbar-btn primary" id="modal-request-port-btn" style="padding: 8px 16px;">
                                ⚡ Выбрать COM-порт в системе
                            </button>
                        `}
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(this.modalOverlay);

        const closeBtn = this.modalOverlay.querySelector('#serial-modal-close-btn');
        const openTabBtn = this.modalOverlay.querySelector('#open-tab-btn');
        const requestPortBtn = this.modalOverlay.querySelector('#modal-request-port-btn');
        const disconnectBtn = this.modalOverlay.querySelector('#modal-disconnect-btn');

        closeBtn?.addEventListener('click', () => this.close());

        openTabBtn?.addEventListener('click', () => {
            window.open(window.location.href, '_blank');
        });

        disconnectBtn?.addEventListener('click', async () => {
            await this.serial.disconnect();
            this.close();
        });

        requestPortBtn?.addEventListener('click', async () => {
            const baudSelect = this.modalOverlay?.querySelector('#modal-baud-select') as HTMLSelectElement;
            const baud = baudSelect ? parseInt(baudSelect.value, 10) : 115200;

            const success = await this.serial.connect(baud);
            if (success) {
                if (this.onConnectSuccessCallback) this.onConnectSuccessCallback();
                this.close();
            } else {
                this.close();
                this.open(this.serial.getState() === 'connected' ? undefined : 'Не удалось подключиться к порту или доступ заблокирован браузером.');
            }
        });
    }

    public close(): void {
        if (this.modalOverlay && this.modalOverlay.parentElement) {
            this.modalOverlay.parentElement.removeChild(this.modalOverlay);
            this.modalOverlay = null;
        }
    }
}
