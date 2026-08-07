// src/core/IniParser.ts
export interface ParsedRamParam {
    id: string;          // p00600
    name: string;        // Ustat
    description: string; // Напряжение статора
    type: string;        // TWORD, TBit, TInteger, TFloat, etc.
    modbusReg: string;   // r0006
    unit: string;        // B, A, Hz, etc.
    scale: number;       // Множитель (из vars или числовой)
    rawHex: string;      // Например '0x008C'
    rawDec: number;      // Сырое десятичное значение
    isBit: boolean;      // Признак дискретного сигнала TBit
}

export interface ParsedIniResult {
    vars: Record<string, number>;
    ramParams: ParsedRamParam[];
}

export class IniParser {
    public static parse(content: string): ParsedIniResult {
        const lines = content.split(/\r?\n/);
        const vars: Record<string, number> = {};
        const ramParams: ParsedRamParam[] = [];

        let currentSection: string | null = null;

        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith(';')) {
                continue; // Игнорируем комментарии и пустые строки
            }

            if (line.startsWith('[') && line.endsWith(']')) {
                currentSection = line.substring(1, line.length - 1).toUpperCase();
                continue;
            }

            if (currentSection === 'VARS') {
                const eqIdx = line.indexOf('=');
                if (eqIdx !== -1) {
                    const key = line.substring(0, eqIdx).trim();
                    const valStr = line.substring(eqIdx + 1).trim().replace(',', '.');
                    const numVal = parseFloat(valStr);
                    if (!isNaN(numVal)) {
                        vars[key] = numVal;
                    }
                }
            } else if (currentSection === 'RAM') {
                const eqIdx = line.indexOf('=');
                if (eqIdx !== -1) {
                    const paramId = line.substring(0, eqIdx).trim(); // p00600
                    const right = line.substring(eqIdx + 1).trim();
                    const parts = right.split('/');
                    if (parts.length >= 3) {
                        const name = parts[0]?.trim() || paramId;
                        const description = parts[1]?.trim() || '';
                        const type = parts[2]?.trim() || 'TWORD';
                        const isBit = type.toUpperCase() === 'TBIT';

                        let modbusReg = '';
                        let unit = '';
                        let scale = 1.0;

                        if (isBit) {
                            // TBit: AddrHex(3) и 1(4) - рудименты. 5-й элемент - r0000.0
                            modbusReg = parts[5]?.trim() || '';
                            unit = '';
                            scale = 1.0;
                        } else {
                            // Аналоговый параметр:
                            // AddrHex(3) - рудимент
                            // parts[4] - r0006 (Modbus)
                            // parts[5] - Unit (B, A, Hz...)
                            // parts[6] - Scale (1, 0,01, CINScale...)
                            modbusReg = parts[4]?.trim() || '';
                            unit = parts[5]?.trim() || '';
                            const scaleStr = parts[6]?.trim() || '1';
                            if (scaleStr in vars) {
                                scale = vars[scaleStr];
                            } else {
                                const parsedScale = parseFloat(scaleStr.replace(',', '.'));
                                scale = isNaN(parsedScale) ? 1.0 : parsedScale;
                            }
                        }

                        // Начальное значение параметров до опроса Modbus
                        const rawDec = 0;
                        const rawHex = '0x0000';

                        ramParams.push({
                            id: paramId,
                            name,
                            description,
                            type,
                            modbusReg,
                            unit,
                            scale,
                            rawHex,
                            rawDec,
                            isBit
                        });
                    }
                }
            }
        }

        return { vars, ramParams };
    }
}