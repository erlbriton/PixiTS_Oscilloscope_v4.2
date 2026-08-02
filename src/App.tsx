/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Code2, Terminal, ShieldCheck, Cpu } from 'lucide-react';

export default function App() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col font-sans">
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 text-white rounded-lg">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-zinc-900">TypeScript Architect Workspace</h1>
              <p className="text-xs text-zinc-500">React 19 • Express • Tailwind CSS • Strict Mode</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full">
            <ShieldCheck className="w-4 h-4" />
            <span>Strict Type Checker Active</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-6 flex flex-col justify-center">
        <div className="bg-white border border-zinc-200 rounded-xl p-8 shadow-xs space-y-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-zinc-100 text-zinc-700 rounded-lg shrink-0 mt-1">
              <Terminal className="w-6 h-6" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-medium text-zinc-900">Готов к работе над проектом</h2>
              <p className="text-sm text-zinc-600 leading-relaxed">
                Среда разработки настроена в соответствии с требованиями TypeScript, React 19 и Tailwind CSS. Опишите задачу, функциональность или модули, которые необходимо спроектировать или доработать.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-zinc-100">
            <div className="p-4 rounded-lg bg-zinc-50 border border-zinc-100">
              <div className="flex items-center gap-2 text-zinc-800 text-sm font-medium mb-1">
                <Cpu className="w-4 h-4 text-blue-600" />
                <span>Архитектура</span>
              </div>
              <p className="text-xs text-zinc-500">Разработка масштабируемых типов, интерфейсов и паттернов.</p>
            </div>
            <div className="p-4 rounded-lg bg-zinc-50 border border-zinc-100">
              <div className="flex items-center gap-2 text-zinc-800 text-sm font-medium mb-1">
                <Code2 className="w-4 h-4 text-blue-600" />
                <span>Компоненты & API</span>
              </div>
              <p className="text-xs text-zinc-500">Интеграция UI компонентов, REST/Express эндпоинтов и состояния.</p>
            </div>
            <div className="p-4 rounded-lg bg-zinc-50 border border-zinc-100">
              <div className="flex items-center gap-2 text-zinc-800 text-sm font-medium mb-1">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                <span>Типобезопасность</span>
              </div>
              <p className="text-xs text-zinc-500">Строгая проверка типов без неопределенностей `any`.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

