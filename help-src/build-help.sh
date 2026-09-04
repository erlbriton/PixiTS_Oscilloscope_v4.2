#!/bin/bash
# Сборка справки из Markdown-исходников: help-src/*.md -> public/help/*.html
set -e

SRC="help-src"
OUT="public/help"

mkdir -p "$OUT/images"

# Копируем картинки (если есть)
if [ -d "$SRC/images" ]; then
  cp -f "$SRC"/images/* "$OUT"/images/ 2>/dev/null || true
fi

# Список глав в алфавитном порядке имён файлов
mapfile -t files < <(ls "$SRC"/ch*.md 2>/dev/null | sort)
count=${#files[@]}

if [ "$count" -eq 0 ]; then
  echo "Не найдено ни одной главы ($SRC/ch*.md)"
  exit 1
fi

# Собираем главы
for i in "${!files[@]}"; do
  f="${files[$i]}"
  base=$(basename "$f" .md)
  title=$(grep -m1 '^# ' "$f" | sed 's/^# //')
  prev=""; next=""
  if [ "$i" -gt 0 ]; then
    prev=$(basename "${files[$((i-1))]}" .md).html
  fi
  if [ "$i" -lt $((count-1)) ]; then
    next=$(basename "${files[$((i+1))]}" .md).html
  fi

  pandoc "$f" -o "$OUT/$base.html" \
    --template="$SRC/template.html" \
    -M title="$title" \
    ${prev:+-M prev="$prev"} \
    ${next:+-M next="$next"}

  echo "  собрано: $base.html  ($title)"
done

# Собираем index.html (оглавление) автоматически
{
  cat <<'HEADER'
<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>WEB Ajuster — руководство пользователя</title>
  <link rel="stylesheet" href="help.css" />
</head>
<body>
<main>
  <h1>WEB Ajuster — руководство пользователя</h1>
  <p>Версия 0.1 &middot; info@intmash.ru &middot; www.intmash.ru &middot; Бердск, 2026</p>

  <h2>Оглавление</h2>
  <ul class="toc">
HEADER

  for f in "${files[@]}"; do
    base=$(basename "$f" .md)
    title=$(grep -m1 '^# ' "$f" | sed 's/^# //')
    echo "    <li><a href=\"$base.html\">$title</a></li>"
  done

  cat <<'FOOTER'
  </ul>

  <h2>Как работать со справкой</h2>
  <p>Справка состоит из отдельных страниц-глав. Переходите по ссылкам оглавления,
     а возвращайтесь через ссылку «Оглавление» вверху каждой главы.</p>
  <p>Любую главу можно распечатать или сохранить в PDF: нажмите <kbd>Ctrl+P</kbd>
     в браузере — навигация при печати скрывается автоматически.</p>
</main>
</body>
</html>
FOOTER
} > "$OUT/index.html"

echo "Готово: глав: $count + index.html"