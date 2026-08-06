export interface UsbVendorInfo {
  name: string;
  pids: Record<string, string>;
}

export interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

export const USB_VENDORS: Record<string, UsbVendorInfo> = {
  '10c4': {
    name: 'Silicon Labs (CP210x)',
    pids: {
      'ea60': 'CP2102/CP2109',
      'ea70': 'CP2105',
      'ea71': 'CP2108'
    }
  },
  '0403': {
    name: 'FTDI',
    pids: {
      '6001': 'FT232R',
      '6010': 'FT2232H',
      '6015': 'FT230X'
    }
  },
  '1a86': {
    name: 'QinHeng Electronics (WCH)',
    pids: {
      '7523': 'CH340',
      '5523': 'CH341'
    }
  },
  '067b': {
    name: 'Prolific Technology',
    pids: {
      '2303': 'PL2303'
    }
  }
};

export function identifyUsbChip(info: SerialPortInfo): string {
  if (!info || typeof info.usbVendorId !== 'number') {
    return 'Неизвестное устройство (нет VID)';
  }

  const vidStr: string = info.usbVendorId.toString(16).padStart(4, '0').toLowerCase();
  const pidStr: string = typeof info.usbProductId === 'number' 
    ? info.usbProductId.toString(16).padStart(4, '0').toLowerCase() 
    : '';

  const vendor = USB_VENDORS[vidStr];
  if (!vendor) {
    return `Неизвестный производитель (VID: 0x${vidStr})`;
  }

  const chipName = vendor.pids[pidStr];
  if (chipName) {
    return `${vendor.name} - ${chipName}`;
  }

  return `${vendor.name} (PID: 0x${pidStr || 'н/д'})`;
}