# Design: KidTasks

Запертая система. Каждый Hallmark-запуск читает этот файл первым, страницы делят систему. Менять — осознанно; файл — правило.

Genre: playful (ярко-игровое, направление А из docs/03-design-references.md). Первая страница: app screen. Тема: своя (vibe: «тёплый игровой UI за референс Emote Agency»).

## System
- Genre: playful
- Shape: app screen (PWA, две роли: подросток и родитель по PIN, tabbar внизу)
- Theme: свой (палитра снята с референса Emote Agency, tools/palette.py)
- Axes: бумага #EDF3FA / системный SF Pro / полный набор ролей (accent, coin, pink, violet, danger) · posture: full palette — у каждой роли своя работа: зелёный = действие, янтарный = валюта, фиолетовый = «ждёт родителя», розовый = убрать/мягкое, красный = опасное
- Поверхности: светлые карточки с мягкой тенью на голубоватой бумаге; радиусы 22/16/12 (--r-lg/md/sm); тёмная тема через prefers-color-scheme или data-theme="dark" (tokens.css)
- Подписи — строчными, обычным начертанием, без трекинга и капса (13px, 600, --muted-strong)
- Знак валюты — типографская звезда ★ (цвет --coin), не эмодзи; иконки интерфейса — инлайн-SVG в стиле tabbar (stroke 2, round)

## Tokens
`styles/tokens.css` — источник истины: --bg, --surface, --ink, --muted (+--muted-strong), --accent (+-soft/-ink), --coin (+-soft/-ink-strong), --pink, --violet, --blue-soft, --line, --lock, --danger, --r-lg/md/sm, --shadow, --font-body, --btn-ink. Правило проекта: цвета — только через токены, никаких литералов в правилах. Отступы — сетка 4px.

## Controls
- Primary: заливка --accent-ink (светлая) / --accent с текстом --btn-ink (тёмная) · радиус --r-sm · высота 44px (тач)
- Secondary: .btn-ghost (surface + линия --line) и .btn-text · те же радиус и высота
- Disabled: opacity .55 + cursor not-allowed + native disabled
- Кольцо фокуса: outline 2px --accent, offset 2px, мгновенно; тач-зоны от 44px (подувеличение через ::before)

## Motion
- Character: brisk; только transform/opacity, durations 120ms; всё гаснет под prefers-reduced-motion
- Никаких reveal-при входе: данные локальные, экран должен быть готов сразу

## Exports
`styles/tokens.css` в этом проекте. Прочие форматы (Tailwind, DTCG) — по запросу.

## Variants
- Экран магазина: styles/shop.css (штамп в первой строке) — образец для новых экранов
