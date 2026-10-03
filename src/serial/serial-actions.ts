// src/serial/serial-actions.ts
// Фасад для обратной совместимости импортов.
//
// Раньше этот модуль содержал всё: SerialManager, CRC, подключение, цикл опроса
// и Modbus-функции. Сейчас код разнесён по файлам:
//   - serial-manager.ts       — центральный менеджер порта;
//   - modbus-crc.ts           — CRC16 и оптимизация батчей;
//   - device-connection.ts    — подключение и идентификация (ID);
//   - modbus-functions.ts     — декодеры и FC03/FC16;
//   - read-loop.ts            — главный цикл опроса.
//
// Этот файл реэкспортирует публичные символы, чтобы внешние модули
// (modbus-scanner, table-editor, device_updater, cmdline-ui, controller-write,
// copy-ops, main) продолжали импортировать их из './serial-actions.js'
// без изменений.

export { serialManager } from './serial-manager.js';
export type { CheckCompleteFn, TransactionResult } from './serial-manager.js';

export { calculateCRC, getOptimizedBatches } from './modbus-crc.js';
export type { RegisterBatch } from './modbus-crc.js';

export {
    updateComInterfaceName,
    executeDeviceIdentification,
} from './device-connection.js';

export { writeRegistersFC16, readHoldingRegistersFC03 } from './modbus-functions.js';

export { readLoop } from './read-loop.js';
export type { ChannelBuffer } from './read-loop.js';