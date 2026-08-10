// src/core/platform/fs.ts
// Платформенно-независимый контракт файловой системы.
// Браузер:  File API (input type="file"), File.arrayBuffer()
// Tauri:    @tauri-apps/plugin-fs → readTextFile / readDir
// Нативный: std::fs через IPC (Rust/C++)
//
// Правило: бизнес-логика зависит ТОЛЬКО от этих интерфейсов.

export interface SelectedFile {
  readonly name: string;
  readonly path: string;          // полный путь (в браузере — имя)
  readonly size: number;
  readonly lastModified: number;
  readonly content: string;       // уже декодированный текст
}

export interface FileFilter {
  readonly name: string;
  readonly extensions: string[];  // ['ini', 'txt']
}

export interface IFileSystem {
  /** Открыть диалог выбора файлов */
  selectFiles(options?: {
    multiple?: boolean;
    filters?: FileFilter[];
  }): Promise<SelectedFile[]>;

  /** Открыть диалог выбора папки */
  selectDirectory(): Promise<SelectedFile[] | null>;

  /** Прочитать файл по пути (нативный режим) */
  readTextFile(path: string): Promise<string>;

  /** Сохранить текст в файл (нативный режим) */
  writeTextFile(path: string, content: string): Promise<void>;
}

/**
 * Платформенно-независимый контракт последовательного порта.
 * Дублирует ISerialPort для наглядности в контексте платформы.
 * Реализации:
 *   браузер → SerialConnection (Web Serial API)
 *   Tauri   → TauriSerialAdapter (IPC → Rust crate `serialport`)
 */
export interface ISerialPortPlatform {
  readonly isConnected: boolean;
  connect(baudRate?: number): Promise<void>;
  readChunk(): Promise<Uint8Array | null>;
  write(data: Uint8Array): Promise<void>;
  getPortInfo(): { usbVendorId?: number; usbProductId?: number };
  onDisconnect(cb: () => void): void;
  release(): void;
}

/**
 * Контракт сохранения файлов (CSV, INI).
 * Браузер:  Blob + URL.createObjectURL + <a download>
 * Нативный: диалог сохранения через FS-плагин
 */
export interface IFileSaver {
  saveTextFile(filename: string, content: string, mimeType?: string): Promise<void>;
}