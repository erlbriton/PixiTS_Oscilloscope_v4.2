// src/main.ts
// This is the "Main Project" logic demonstrating how to embed the Oscilloscope module.

import { Oscilloscope } from '../index';

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Main Industrial Application Initialized');

    const connectBtn = document.getElementById('connect-btn');
    const toggleBtn = document.getElementById('toggle-osc-btn');
    const loadIniBtn = document.getElementById('load-ini-btn');
    const statusBadge = document.getElementById('conn-status');
    const oscContainer = document.getElementById('osc-container');

    let osc: Oscilloscope | null = null;
    let serialPort: any = null;
    let loadedFiles: any[] = [];

    if (connectBtn) {
        connectBtn.addEventListener('click', async () => {
            try {
                if (serialPort) {
                    await serialPort.close();
                    serialPort = null;
                    if (connectBtn) connectBtn.textContent = '🔌 Connect';
                    if (statusBadge) statusBadge.textContent = 'Disconnected';
                    return;
                }

                serialPort = await (navigator as any).serial.requestPort();
                await serialPort.open({ baudRate: 115200 });
                
                if (connectBtn) connectBtn.textContent = '🔌 Disconnect';
                if (statusBadge) {
                    statusBadge.textContent = 'Connected';
                    statusBadge.style.color = '#10b981';
                }

                // If osc is active, inject the port
                if (osc) {
                    osc.setSerialPort(serialPort);
                }
            } catch (err) {
                console.error('Serial error:', err);
                alert('Failed to connect serial');
            }
        });
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', async () => {
            if (!osc) {
                // First time initialization
                osc = new Oscilloscope();
                if (oscContainer) {
                    oscContainer.classList.remove('hidden');
                    await osc.initialize(oscContainer);
                    console.log('Oscilloscope Module Mounted');
                    
                    // Inject any files we already have
                    if (loadedFiles.length > 0) {
                        osc.setIniFiles(loadedFiles);
                    }
                    
                    // Inject the port if we already have it
                    if (serialPort) {
                        osc.setSerialPort(serialPort);
                    }
                }
                toggleBtn.textContent = '❌ Close Oscilloscope';
                toggleBtn.classList.remove('success');
                toggleBtn.classList.add('primary');
            } else {
                // Destroy and cleanup
                osc.destroy();
                osc = null;
                if (oscContainer) oscContainer.classList.add('hidden');
                toggleBtn.textContent = '📊 Oscilloscope';
                toggleBtn.classList.remove('primary');
                toggleBtn.classList.add('success');
            }
        });
    }

    if (loadIniBtn) {
        loadIniBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.ini';
            input.multiple = true;
            input.onchange = async (e) => {
                const fileList = (e.target as HTMLInputElement).files;
                if (fileList) {
                    for (const file of Array.from(fileList)) {
                        const content = await file.text();
                        loadedFiles.push({
                            id: `file-${Date.now()}-${Math.random()}`,
                            name: file.name,
                            size: file.size,
                            lastModified: file.lastModified,
                            content: content
                        });
                    }
                    
                    if (osc) {
                        osc.setIniFiles(loadedFiles);
                    } else {
                        alert('Oscilloscope is not open yet, but files are saved in Main Project memory.');
                    }
                }
            };
            input.click();
        });
    }
});

