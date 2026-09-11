import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';

/**
 * Потоковый парсер INI для CodeMirror 6.
 * Распознаёт:
 *  - комментарии: строки, начинающиеся с ';' или '#';
 *  - секции:      строки вида [SectionName];
 *  - ключи:       текст до знака '=';
 *  - оператор:    сам знак '=';
 *  - значения:    текст после '=' до конца строки.
 *
 * Возвращает строковые идентификаторы токенов, которые затем стилизуются через тему.
 */
const iniLanguage = StreamLanguage.define<{ seenEquals: boolean }>({
    name: 'ini',
    startState: () => ({ seenEquals: false }),
    token(stream, state) {
        if (stream.sol()) {
            state.seenEquals = false;
            const ch = stream.peek();
            // Комментарий
            if (ch === ';' || ch === '#') {
                stream.skipToEnd();
                return 'comment';
            }
            // Секция
            if (ch === '[') {
                stream.skipTo(']');
                stream.eat(']');
                return 'heading';
            }
        }
        // Знак '='
        if (stream.peek() === '=') {
            stream.next();
            state.seenEquals = true;
            return 'operator';
        }
        // Значение после '='
        if (state.seenEquals) {
            stream.skipToEnd();
            return 'string';
        }
        // Ключ до '='
        if (stream.match(/^[^=\[\];#]+/)) {
            return 'propertyName';
        }
        stream.next();
        return null;
    },
});

/** Цвета токенов INI: маппинг тегов подсветки на стили (тёмная тема VS Code). */
const iniHighlightStyle = HighlightStyle.define([
    { tag: tags.comment, color: '#6a9955', fontStyle: 'italic' },   // комментарии ; и #
    { tag: tags.heading, color: '#920373', fontWeight: 'bold' },    // секции [Section]
    { tag: tags.propertyName, color: '#310ff3ef' },                   // ключи до '='
    { tag: tags.operator, color: '#dd4b38' },                       // знак '='
    { tag: tags.string, color: '#035303' },                         // значения после '='
]);

/**
 * Оформление редактора: моноширинный шрифт, тёмный фон, перенос длинных строк.
 */
const iniTheme = EditorView.theme(
    {
        '&': {
            fontSize: '14px',
            height: '100%',
        },
        '.cm-scroller': {
            overflow: 'auto',
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            lineHeight: '1.5',
        },
        '.cm-content': { padding: '8px 0' },
        '.cm-line': { padding: '0 8px' },
                // Контейнер ВСЕХ панелей CodeMirror (у нас здесь только шапка поиска Ctrl+F)
        '.cm-panels': {
            backgroundColor: '#003366',      // Фон всей шапки поиска (тёмно-синий)
            color: '#d4d4d4',                // Цвет текста по умолчанию внутри шапки:
                                             // наследуют надписи чекбоксов (match case, regexp, by word)
                                             // и кнопки, у которых свой color не задан
            borderBottom: '3px solid #454545', // Линия внизу шапки: 1px, сплошная, цвет #454545
            minHeight: '100px',              // Минимальная высота всей шапки (сюда входят обе строки: Find и Replace)
            padding: '6px 8px',              // Внутренние отступы шапки: 6px сверху/снизу, 8px слева/справа
                                             // (вместе с minHeight влияет на итоговую высоту)
        },
        // Поля ввода "Find" и "Replace" (левая колонка шапки)
        '.cm-panel.cm-panel-search input': {
            backgroundColor: '#e0e0e0',      // Фон полей ввода (светло-серый)
            color: '#0a0909',                // Цвет текста, который печатает пользователь в поле
            border: '1px solid #555',        // Рамка поля ввода: 1px, сплошная, цвет #555
            height: '50px',                  // Высота каждого поля ввода
            fontSize: '20px',                // Кегль шрифта внутри полей ввода
        },
        // Кнопки next / previous / all / replace / replace all
        '.cm-panel.cm-panel-search button': {
            height: '50px',                  // Высота кнопок (выровнена с полями ввода)
            fontSize: '20px',                // Кегль надписей на кнопках
            // МОЖНО ДОБАВИТЬ:
            // backgroundColor: '#4a4a4a',   // Фон кнопок (сейчас наследуется от браузера/темы)
            // color: '#ffffff',             // Цвет надписей на кнопках (сейчас наследуется от .cm-panels: #d4d4d4)
        },
        // МОЖНО ДОБАВИТЬ ЦЕЛЫЙ БЛОК для надписей чекбоксов match case / regexp / by word:
        // '.cm-panel.cm-panel-search label': {
        //     fontSize: '20px',             // Кегль надписей чекбоксов (сейчас наследуется от .cm-panels)
        //     color: '#e0e0e0',             // Цвет надписей чекбоксов (сейчас наследуется от .cm-panels)
        // },
    },
    // Флаг тёмной темы: говорит CodeMirror использовать базовую палитру для тёмного фона
    { dark: true }
);

export interface IniEditorInstance {
    view: EditorView;
    getValue: () => string;
    destroy: () => void;
    focus: () => void;
}

/**
 * Создаёт instance CodeMirror 6 для редактирования INI-файлов.
 * Поддержка: подсветка синтаксиса, нумерация строк, история (Ctrl+Z/Y),
 * поиск (Ctrl+F, F3), подсветка совпадений выделения, автодополнение.
 */
export function createIniEditor(
    container: HTMLElement,
    initialContent: string
): IniEditorInstance {
    const state = EditorState.create({
        doc: initialContent,
        extensions: [
            lineNumbers(),
            history(),
            drawSelection(),
            iniLanguage,
            syntaxHighlighting(iniHighlightStyle),
            search({ top: true }),
            highlightSelectionMatches(),
            autocompletion(),
            EditorView.lineWrapping,
            keymap.of([
                ...defaultKeymap,
                ...historyKeymap,
                ...completionKeymap,
                ...searchKeymap,
            ]),
            iniTheme,
        ],
    });

    const view = new EditorView({
        state,
        parent: container,
    });

    return {
        view,
        getValue: () => view.state.doc.toString(),
        destroy: () => {
            view.destroy();
            container.innerHTML = '';
        },
        focus: () => view.focus(),
    };
}