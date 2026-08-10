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