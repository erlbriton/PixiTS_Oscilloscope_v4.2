export const deviceRegistry = {};
export let currentDeviceConfig = null;

export function setCurrentDeviceConfig(config) {
    currentDeviceConfig = config;
}
// Вспомогательная функция для парсинга адресов
export function parseRegisterAddress(addrString) {
    if (!addrString || addrString === '*') return { reg: null, sub: null };
    const cleanStr = addrString.toLowerCase().replace('r', '');
    const parts = cleanStr.split('.');
    
    let valStr = parts[0];
    let base = 16; // Default to hex
    
    if (valStr.startsWith('x')) {
        valStr = valStr.substring(1);
    } else if (valStr.startsWith('0x')) {
        valStr = valStr.substring(2);
    }
    
    return {
        reg: parseInt(valStr, base),
        sub: parts[1] ? parts[1].toUpperCase() : null
    };
}

// Вспомогательная функция для HEX -> Float32
export function hexToFloat32(hexStr) {
    if (!hexStr) return NaN;
    const intVal = parseInt(hexStr, 16);
    if (isNaN(intVal)) return NaN;
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, intVal, false);
    return view.getFloat32(0, false);
}

// Вспомогательная функция для Float32 -> HEX
export function float32ToHex(floatVal, padLen = 8) {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setFloat32(0, floatVal, false);
    const intVal = view.getUint32(0, false);
    return 'x' + intVal.toString(16).toUpperCase().padStart(padLen, '0');
}

export function getSectionRange(config: any, sectionName: string) {
    if (!config || !config[sectionName]) return { start: 0, count: 0 };
    const section = config[sectionName];
    let minReg = Infinity;
    let maxReg = -Infinity;
    
    Object.values(section).forEach((parts: any) => {
        if (Array.isArray(parts)) {
            const dataType = String(parts[2] || '').toUpperCase();
            const regAddrString = String(dataType === 'TBIT' ? (parts[5] ?? '') : (parts[4] ?? ''));
            const parsed = parseRegisterAddress(regAddrString);
            if (parsed.reg !== null && !isNaN(parsed.reg)) {
                minReg = Math.min(minReg, parsed.reg);
                
                // For 32-bit types, we need to read 2 registers
                const is32Bit = dataType.toUpperCase().includes('FLOAT') || 
                                dataType.toUpperCase().includes('DWORD') || 
                                dataType.toUpperCase().includes('LONG') || 
                                dataType.toUpperCase().includes('INT32');
                
                maxReg = Math.max(maxReg, parsed.reg + (is32Bit ? 1 : 0));
            }
        }
    });

    if (minReg === Infinity) return { start: 0, count: 0 };
    return { start: minReg, count: maxReg - minReg + 1 };
}

// Регистрация устройства
export function addDeviceToRegistry(config) {
    if (!config || !config['DEVICE']) return false;
    const dev = config['DEVICE'];
    const location = dev['Location'] || 'Неизвестное место';
    const id = dev['ID'] || dev['Id'] || dev['id'] || 'Без ID';
    const version = dev['Version'] || ''; 
    const date = dev['Date'] || '';
    const displayComponents = [id, version, date].filter(Boolean);
    const deviceDisplayText = displayComponents.join(' ');

    if (!deviceRegistry[location]) deviceRegistry[location] = [];
    const isDuplicate = deviceRegistry[location].some(item => item.id === id);
    if (!isDuplicate) {
        deviceRegistry[location].push({ id: id, displayText: deviceDisplayText, fullConfig: config });
        return true; 
    }
    return false; 
}
