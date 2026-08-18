---
name: "GRAM"
description: "Тёмная социальная система, где профиль, общение и коллекционные активы читаются как одна долговечная идентичность."
colors:
  ink: "#f7f7fa"
  muted: "#a4a5af"
  faint: "#7f818c"
  void: "#050506"
  canvas: "#09090b"
  surface: "#151519"
  surface-raised: "#1b1b20"
  surface-pressed: "#101013"
  line: "#29292f"
  line-strong: "#3a3a43"
  primary: "#6f60df"
  primary-hover: "#7564df"
  primary-strong: "#a294ff"
  primary-dim: "#28233f"
  link: "#56c9ff"
  online: "#20d875"
  stars: "#ffad32"
  stars-dim: "#342713"
  stars-ink: "#171006"
  danger: "#ff6f82"
  auth-surface: "#111114"
  auth-primary: "#8b78ea"
  auth-primary-hover: "#9c8bf2"
  auth-focus: "#66d9ee"
  auth-action-ink: "#0c0719"
  auth-danger: "#ff7b8d"
  auth-success: "#57d88b"
  chat-canvas: "#080b0d"
  chat-line: "#20292e"
  chat-incoming: "#151c20"
  chat-outgoing: "#12343d"
  selection-surface: "#26232f"
  dock-glass: "rgba(19, 19, 23, 0.94)"
typography:
  display:
    fontFamily: '"Onest Variable", "Segoe UI", sans-serif'
    fontSize: "clamp(2.7rem, 5.1vw, 4.8rem)"
    fontWeight: 770
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  headline:
    fontFamily: '"Onest Variable", "Segoe UI", sans-serif'
    fontSize: "clamp(1.65rem, 5vw, 2.35rem)"
    fontWeight: 810
    lineHeight: 1.04
    letterSpacing: "-0.035em"
  title:
    fontFamily: '"Onest Variable", "Segoe UI", sans-serif'
    fontSize: "1.05rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  body:
    fontFamily: '"Onest Variable", "Segoe UI", sans-serif'
    fontSize: "0.98rem"
    fontWeight: 480
    lineHeight: 1.62
    letterSpacing: "normal"
  label:
    fontFamily: '"Onest Variable", "Segoe UI", sans-serif'
    fontSize: "0.78rem"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "normal"
  action:
    fontFamily: '"Onest Variable", "Segoe UI", sans-serif'
    fontSize: "1rem"
    fontWeight: 730
    lineHeight: 1
    letterSpacing: "normal"
rounded:
  compact: "12px"
  control: "14px"
  field: "16px"
  card: "18px"
  panel: "20px"
  group: "22px"
  dialog: "24px"
  section: "26px"
  hero: "28px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "28px"
  "8": "32px"
components:
  button-auth-primary:
    backgroundColor: "{colors.auth-primary}"
    textColor: "{colors.auth-action-ink}"
    typography: "{typography.action}"
    rounded: "{rounded.field}"
    padding: "0 16px"
    height: "54px"
  button-quiet:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    padding: "0 19px"
    height: "46px"
  button-stars:
    backgroundColor: "{colors.stars}"
    textColor: "{colors.stars-ink}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    padding: "0 19px"
    height: "46px"
  field:
    backgroundColor: "{colors.surface-pressed}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 16px"
    height: "48px"
  surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.section}"
  inset-surface:
    backgroundColor: "{colors.surface-pressed}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  segmented-control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "4px"
    height: "48px"
  segmented-control-active:
    backgroundColor: "{colors.selection-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "40px"
  mobile-dock:
    backgroundColor: "{colors.dock-glass}"
    textColor: "{colors.muted}"
    rounded: "{rounded.section}"
    padding: "7px"
    height: "78px"
  avatar-default:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "44px"
---

# Design System: GRAM

## Overview

**Creative North Star: "The Rounded Identity Network"**

**Thesis.** GRAM — закруглённая сеть идентичности: человек, его разговоры, сообщества, юзернеймы, Stars и история коллекционных предметов должны восприниматься как одна долговечная социальная личность. Интерфейс намеренно не выглядит ни финансовой панелью, ни сервисом прямых эфиров.

**Visual grammar.** Почти чёрный непрерывный холст держит плотный социальный контент. Матовые графитовые группы, мягкие внутренние линии, большие скругления и капсульные действия создают спокойную структуру; фиолетовый, голубой, золотой и зелёный появляются только с закреплённой семантикой. Насыщенный цвет и фактура принадлежат фотографиям, обложкам и коллекционным объектам, а не базовому chrome.

Система mobile-first, но не является растянутым мобильным экраном на desktop: центральный социальный канал остаётся ограниченным, слева постепенно раскрывается навигация, справа при достаточной ширине появляется контекст. Профиль — главная точка сборки мира: полноширинная обложка, перекрывающий её аватар, действия, идентификаторы и коллекционные слои читаются раньше вторичных данных.

**Key Characteristics:**

- Почти чёрный canvas и тонально разделённые графитовые поверхности.
- Один variable-шрифт Onest для кириллицы, display, UI и чисел.
- Широкие секционные радиусы, компактные функциональные радиусы и капсулы только там, где они несут действие или статус.
- Фиолетовый для главного действия, cyan для идентичности и фокуса, gold для Stars и редкости, green для присутствия и успеха.
- Аватары, обложки, юзернеймы и подарки образуют единую иерархию идентичности.
- Явные loading, empty, error, disabled, selected, success и confirmation states.

**The No Livestream Rule.** В GRAM нет функциональности «эфира» и нет её визуальной метафоры: никаких LIVE-бейджей, красных трансляционных рамок, счётчиков зрителей или broadcast-лексики. Stories, аудио- и видеозвонки могут существовать только как отдельные функции и не должны выглядеть как прямой эфир.

## Colors

Палитра строится от нейтрального почти чёрного пространства к редким семантическим сигналам. Значения во frontmatter нормативны; локальные градиенты обложек и collectible artwork не становятся глобальными цветами UI.

### Primary

- **Signal Violet** (`colors.primary`): главное действие, compose, выбранные и активные состояния.
- **Primary Hover** (`colors.primary-hover`): hover главного действия при сохранении AA для белого текста.
- **Lifted Violet** (`colors.primary-strong`): активная иконка и небольшие текстовые акценты на тёмном фоне.
- **Violet Well** (`colors.primary-dim`): спокойная подложка вокруг фиолетового сигнала.
- Auth использует подтверждённую локальную пару `colors.auth-primary` / `colors.auth-primary-hover`; это тот же смысловой голос, но более тёмный текст действия обеспечивает лучший контраст.

### Secondary

- **Identity Cyan** (`colors.link`): `@username`, ссылки на профиль и владельца, verification, typing state и глобальный focus ring.
- **Auth Cyan** (`colors.auth-focus`): фокус и текстовые ссылки внутри auth-world. Он не заменяет фиолетовое главное действие.

### Tertiary

- **Stars Gold** (`colors.stars`, `colors.stars-dim`, `colors.stars-ink`): баланс, точные суммы, ценность, редкость и Stars-действия. Gold не используется как общий warning.
- **Presence Green** (`colors.online`): присутствие, успешный результат и положительное направление операции — всегда вместе с текстом, знаком или иконкой.
- **Danger Coral** (`colors.danger`): ошибки, разрушительные предупреждения и невалидные поля. Auth имеет локальный вариант `colors.auth-danger`.

### Neutral

- **Void / Canvas** (`colors.void`, `colors.canvas`): внешний фон и рабочий центральный канал.
- **Graphite Stack** (`colors.surface-pressed`, `colors.surface`, `colors.surface-raised`): вложенная, базовая и поднятая поверхность; глубина читается прежде всего тоном.
- **Ink / Muted / Faint** (`colors.ink`, `colors.muted`, `colors.faint`): основной текст, вторичный текст и метаданные.
- **Hairlines** (`colors.line`, `colors.line-strong`): делители и внутренние контуры, не самостоятельные декоративные рамки.

### Contextual palettes

- Chat уходит в холодный сине-графитовый подмир (`colors.chat-canvas`, `colors.chat-line`, `colors.chat-incoming`, `colors.chat-outgoing`), сохраняя общие cyan-сигналы, Onest и радиусы.
- Gift artwork получает собственный accent/background из данных предмета. Этот цвет заполняет карточку, orbit или hero предмета, но не окрашивает соседний chrome.
- Stars и Creator Studio могут использовать локальный gold/orange gradient только в balance hero; списки, формы и аналитика возвращаются к графиту.

### Contrast and meaning

- `colors.ink`, `colors.muted` и `colors.faint` на `colors.canvas` имеют приблизительно 18.61:1, 8.13:1 и 5.14:1 и подходят для обычного текста по WCAG AA.
- `colors.link`, `colors.online` и `colors.danger` на `colors.canvas` имеют более 7:1, но цвет всё равно не заменяет подпись или иконку.
- White-on-`colors.primary` пара общего `.signal-button` проходит AA для обычного текста (около 4.76:1); `colors.primary-hover` также остаётся выше 4.5:1. Auth использует отдельную тёмную надпись на более светлом violet. Новые поверхности должны сохранять эти проверенные пары.

**The Color Has a Job Rule.** Один акцент — одна задача: violet = действие/выбор, cyan = идентичность/ссылка/фокус, gold = Stars/редкость, green = присутствие/успех, coral = ошибка.

**The Collectible Owns Its Color Rule.** Произвольный насыщенный цвет разрешён внутри медиа и rarity-world конкретного предмета; системный chrome вокруг остаётся нейтральным.

## Typography

**Display Font:** Onest Variable с fallback Segoe UI и sans-serif.  
**Body Font:** Onest Variable с тем же fallback.  
**Label/Mono Font:** отдельного семейства нет; коды, номера выпусков и суммы также набираются Onest.

**Character.** Onest даёт крупным заголовкам компактную современную массу, не ломая кириллицу и плотные служебные подписи. Весь продукт говорит одним типографическим голосом; `.display-font` намеренно указывает на то же семейство.

### Hierarchy

- **Display** (`typography.display`): только крупный auth-intro и редкие hero-формулировки; максимум около 11 знаков в строке.
- **Headline** (`typography.headline`): названия каналов и крупных поверхностей. Профильное имя использует близкую роль 1.8–2.1rem с extra-bold весом.
- **Title** (`typography.title`): заголовки секций, карточек, диалогов и ledger-групп.
- **Body** (`typography.body`): посты, bio и пояснения; комфортная длина обычно 65–72ch.
- **Label** (`typography.label`): подписи полей, статусы, метаданные, даты и compact counts.
- **Action** (`typography.action`): кнопки и выбранные сегменты; сила создаётся весом, не uppercase.

Рабочий диапазон весов: 480 для основного текста, 550–650 для вторичного UI, 680–730 для controls, 760–830 для имён, wordmark и headline. У крупных заголовков трекинг сжат до −0.03…−0.04em; body и labels остаются с normal tracking. Uppercase зарезервирован для короткого wordmark/канального ярлыка и компактных badges, но не для длинных действий или сообщений.

**The One-Family Rule.** Не вводить второй display-шрифт: текущая сборка импортирует и использует только Onest Variable.

**The Readable Density Rule.** Чем меньше кегль, тем короче строка и яснее роль: метаданные не заменяют body, а body не растягивается шире 72ch.

## Layout

Основная оболочка — один ограниченный социальный канал (`max-width: 780px`) с адаптивными боковыми зонами. Внутри канала мобильные горизонтальные отступы обычно 12–20px, desktop-поверхности — 20–28px; повторяющийся ритм следует 4px-шкале `spacing.1`–`spacing.8`. Профильные обложки, чат и некоторые sticky bars намеренно доходят до краёв канала.

| Режим | Диапазон | Структура и навигация |
|---|---:|---|
| **Mobile** | `<900px` | Один edge-to-edge канал. Sticky topbar 60px. Пятинаправленный dock высотой 78px закреплён с inset 10px и учитывает `safe-area-inset-bottom`; контент резервирует `dock + 28px + safe area`. Compose FAB стоит над dock. |
| **Compact** | `900–1179px` | Grid `88px + minmax(0, 780px)`, центрированный. Desktop rail становится icon-only; mobile topbar, dock и FAB скрываются. Центральный канал получает тонкие боковые hairlines. |
| **Full** | `1180–1419px` | Grid `236px + minmax(560px, 780px)`. В rail раскрываются labels, account copy и широкая compose-кнопка. |
| **Context** | `≥1420px` | Grid `236px + 780px + 320px`. Справа появляется sticky, независимо прокручиваемый context rail; центральный канал не расширяется. |

Локальные поверхности имеют собственные пороги, не меняющие главную оболочку:

- Chat на 880px переключается из списка/активного разговора в split `300px + 1fr`; открытый мобильный чат скрывает dock и убирает нижний reserve.
- Auth скрывает левый intro ниже 860px. Ниже 640px карточка превращается в полноширинную нижнюю поверхность с радиусом только сверху; onboarding становится одной колонкой.
- Gifts и profile collections: 3 колонки на mobile и 4 колонки от small breakpoint, с квадратными media cells.
- Communities и analytic metrics складывают actions/columns на узком экране, сохраняя тот же порядок содержимого.

**The Channel Stays Social Rule.** Desktop даёт место контексту, но никогда не растягивает пост, профиль или чат на всю ширину окна.

**The Dock Clearance Rule.** Ни один interactive или informational блок на mobile не может оказаться под dock/FAB; всегда учитывать 78px dock, его inset и safe area.

## Elevation & Depth

Система использует гибрид тонального слоя и мягкой ambient elevation. Базовая глубина идёт от `canvas → surface-pressed → surface → surface-raised`; тени добавляются только floating navigation, модалям, hero и важному action. Hairline чаще реализуется внутренней 1px-тенью, поэтому геометрия остаётся мягкой и не превращается в сетку рамок.

### Shadow Vocabulary

- **Inset hairline** (`inset 0 0 0 1px var(--line)`): внутренние карточки, grouped lists, segmented control и quiet fields.
- **Ambient surface** (`inset 0 0 0 1px var(--line), 0 18px 42px rgba(0,0,0,.20)`): самостоятельная `.surface` на canvas.
- **Violet action** (`0 10px 26px rgba(85,70,188,.22)`; hover `0 13px 32px rgba(85,70,188,.30)`): только главное действие, не каждый violet-элемент.
- **Floating dock** (`inset 0 0 0 1px rgba(66,66,76,.78), 0 18px 48px rgba(0,0,0,.48)`): mobile dock с blur 20px.
- **Modal** (`0 28px 80px rgba(0,0,0,.58)`): стандартные dialogs поверх overlay; крупный gift sheet усиливает глубину до 100px spread vocabulary.
- **Auth card** (`0 30px 90px rgba(0,0,0,.42)`): desktop auth; на mobile тень удаляется.

Overlay обычно 70–78% black с лёгким backdrop blur. Sticky topbars используют полупрозрачный почти чёрный фон и blur 18px, сохраняя читаемость прокручиваемого контента.

**The Tonal First Rule.** Если разницу поверхностей можно показать тоном и inset hairline, не добавлять наружную тень.

**The Floating Things Float Rule.** Сильная тень принадлежит dock, dialog, FAB, hero-object или главному действию; списки и обычные карточки остаются низкими.

## Shapes

Форма строится на последовательной 2px-лесенке от compact controls до hero surfaces. `rounded.compact`–`rounded.card` обслуживают внутренние controls, fields, message bubbles и media; `rounded.panel`–`rounded.hero` — grouped sections, dialogs, auth cards и balance heroes. `rounded.pill` применяется только к капсульным действиям, segmented controls, chips, badges, counters и круглым identity-объектам.

Аватары и presence dots всегда круглы. Cover — широкая прямоугольная media-plane без лишней карточной рамки. Post media имеет устойчивое соотношение 16:10, community media — 16:9, avatar/gift tiles — 1:1. Grouped list имеет один внешний силуэт и внутренние dividers; отдельные строки не получают собственные карточные контуры.

**The Broad Outside, Tight Inside Rule.** Чем выше уровень группировки, тем больше радиус: section/hero снаружи, field/control внутри.

**The Pill Has Meaning Rule.** Capsule — действие, компактный статус или выбор. Длинный текстовый контейнер не становится pill только ради декора.

## Components

### Buttons

- **Signal:** minimum 46px, capsule, horizontal padding 19px, icon gap 9px, violet background и ambient violet shadow. Hover усиливает тон и тень; active опускается на 1px и слегка сжимается; disabled теряет тень и использует нейтральный disabled tone. Текущая white-on-violet подпись не является контрастно одобренным образцом для новых экранов.
- **Auth primary:** 54px, радиус field, `colors.auth-primary` с `colors.auth-action-ink`; hover и focus заданы отдельно. Это доступная референсная пара для текста главного действия.
- **Quiet:** raised graphite, ink, inset strong hairline, capsule. Используется для secondary, cancel, edit и already-selected action.
- **Gold:** Stars Gold с тёмной надписью; только операция со Stars/collectible value.
- **Icon:** 44×44px круг, прозрачный в покое, raised на hover, scale 0.94 на active. Всегда имеет доступное имя.

### Inputs / Fields

- App fields: minimum 48px, field radius, pressed graphite и strong inset line. Focus заменяет линию на cyan.
- Auth inputs: 54px, радиус 15px, локальная field surface; hover поднимает тон, focus добавляет violet border и 3px halo.
- Error никогда не выражается одной рамкой: coral border/halo сопровождаются сообщением, `aria-invalid` и связью через `aria-describedby`.
- Textarea наследует material и focus vocabulary, растёт до установленного max/resize поведения, не ломая action row.

### Segmented controls, tabs and switches

- Segmented control — outer pill с 4px padding и minimum 40px segments. Активный сегмент получает `colors.selection-surface`, светлый текст и внутренний violet-grey hairline.
- Tabs используют `role="tab"`, `aria-selected` и текст/иконку; sticky profile tabs не полагаются на underline, которого нет в текущей системе.
- Switch — 50–52×30–31px capsule с белым 24–25px thumb; active violet и смещение 20–21px. Disabled визуально и семантически недоступен.

### Cards / Containers

- `.surface`: section radius, `colors.surface`, inset hairline и низкая ambient shadow; стандартный внутренний padding 16–20px.
- `.inset-surface`: card radius, `colors.surface-pressed`, только inset hairline.
- Directory, ledger и settings groups используют единый внешний контейнер, dividers между rows и нулевую отдельную elevation строк.
- Dialog: 24–30px, 70–78% overlay, visible close action, semantic title/description. На mobile крупный gift/comment dialog ведёт себя как inset bottom sheet; desktop центрирует его.

### Navigation

- Mobile dock всегда содержит пять главных destinations; active item получает graphite-violet fill, white label и violet icon. Badge числовой и ограничивается `9+`.
- Desktop rail использует те же Lucide icons и порядок. На compact остаются иконки; на full раскрываются labels и account block.
- `aria-current="page"` дублирует visual active state. Stars icon остаётся gold даже рядом с violet navigation language.
- Context rail — вторичный, появляется только при 1420px и не содержит критически единственного действия.

### Avatars and media

- User avatar: круг, `object-fit: cover`, default crop `50% 50%`, configurable object-position. Нет изображения — инициалы на violet-graphite fallback, без broken-image state.
- Типовые размеры: 24px в mobile profile tab, 38–48px в navigation/lists/chat, 96–120px в profile/settings, 104–142px в onboarding picker.
- Online presence: 12–22px green dot, 3px ring цветом непосредственной поверхности. В профиле точка сопровождается текстом «В сети/Не в сети»; в списках есть доступное имя.
- Cover и avatar — разные assets. Profile cover: 232px на mobile и 272px от small breakpoint; 120px avatar перекрывает её на 58px. Community cover масштабируется 170–248px; 98px avatar перекрывает её на 42px.
- Meaningful identity/gift media получает alt; чисто повторяющее текстовую подпись artwork может быть decorative. Crop не должен скрывать лицо или сам collectible-object.

### Profile and collectible identity

- Иерархия: cover → overlapping avatar/actions → display name + verification → `@username` → presence → related usernames → bio → badges/meta/counters → grouped content tabs.
- Verification — отдельный cyan круг с check и доступной подписью. Collectible-marker и premium/badge никогда его не заменяют.
- Один featured gift может жить в cover как главный 76px orbit; до двух вторичных предметов — 52/46px и приглушённее. Один name gift — 22px image внутри 32px gold-tinted pill рядом с именем.
- Gift tile — 1:1 artwork в собственном accent-world, serial number поверх изображения, затем name + rarity. Gallery: 3 колонки mobile, 4 колонки wider, радиус field.
- Gift detail сначала показывает предмет и номер, затем owner, model, symbol, background, edition/supply, точную Star value и provenance. Transfer/purchase требует отдельного confirmation state; irreversible copy остаётся прямым.
- Collectible может украшать идентичность, но не становится аватаром, verification или единственным носителем ownership state.

### Chat

- Список и conversation используют холодный contextual palette. Incoming и outgoing bubbles различаются и положением, и фоном; хвост формируется уменьшенным нижним углом, а не отдельной графикой.
- Bubble max-width 82%, body 0.94rem/1.5, time и delivery icon остаются внутри. Own message имеет double-check и текстовую/позиционную семантику, не только цвет.
- Composer закреплён снизу, учитывает safe area, имеет minimum 44px controls. Недоступные attachment/call/video actions остаются disabled и честно помечены «скоро».

### Stars, communities and studio

- Stars balance hero объединяет gold orb, крупное число и явную demo/local-economy подпись. Ledger всегда показывает signed amount, resulting balance, kind icon/text и timestamp.
- Community profile повторяет user-profile grammar: cover, overlapping avatar, owner/member action, identity copy, counters, members и posts. Роль owner/member/paid access выражается текстом и иконкой.
- Creator Studio остаётся social surface, а не generic BI dashboard: один balance hero, компактные metric tiles, простой bar chart, grouped monetization settings и top-post rows.

### States, motion and accessibility

- Loading: shimmer 1.4s или pulse 1.2s в форме будущего контента; `aria-label`/busy copy объясняет процесс.
- Empty: спокойная иконка, точный заголовок, пояснение и один следующий шаг. Error: сообщение + retry. Success: текстовый notice или polite live region. Disabled: сниженный тон, отсутствие тени и корректный disabled state.
- Базовые state transitions — 150–180ms ease; list/card reveal — около 280ms; auth reveal — 480ms с ease `[0.16,1,0.3,1]`; first post media reveal — 580ms. Длительная 5.2s float-анимация допустима только для featured collectible, не для chrome.
- `:focus-visible` — 2px cyan с offset 3px; auth использует локальный cyan. Минимальные target sizes: 44px icon control, 46px primary/secondary action, 48–54px field.
- Global reduced-motion rule сводит CSS animation/transition к практически нулевой длительности, auth и collectible orbit дополнительно используют `useReducedMotion`. Все новые Framer loops должны получать такой же guard.
- Status, verification, rarity, transaction direction и membership нельзя кодировать только цветом: использовать icon, text, sign или accessible label.

**The State Is Content Rule.** Loading, empty, error, disabled, success и confirmation — часть компонента, а не поздняя заглушка.

**The Motion Confirms Rule.** Анимация подтверждает появление, выбор или пространственную связь; она не создаёт постоянный шум вокруг обычного контента.

## Do's and Don'ts

### Do:

- **Do** держать идентичность в одном визуальном стеке: cover, avatar, имя, verification, `@username`, статус и collectible layers.
- **Do** использовать точные Star amounts, edition/supply, owner и provenance рядом с любым экономическим или scarcity-действием.
- **Do** писать Russian-first, sentence-case и коротко; закладывать переносы, 65–72ch для длинного текста и будущую локализацию без фиксированной ширины labels.
- **Do** честно маркировать локальную/demo-экономику и недоступные функции; disabled control должен объяснять «скоро» или причину.
- **Do** сопровождать цвет статусом, иконкой, знаком суммы или доступной подписью.
- **Do** сохранять touch targets, focus-visible, safe-area clearance и reduced-motion поведение на каждой новой поверхности.
- **Do** проверять WCAG AA для каждой новой text/background пары; использовать уже подтверждённые neutral и auth пары как baseline.

### Don't:

- **Don't** добавлять прямые эфиры, слово «эфир», LIVE-бейджи, красные broadcast rings, audience counters или другую livestream-грамматику.
- **Don't** превращать GRAM в fintech/dashboard chrome: Stars, ownership и analytics остаются встроенными в социальный контекст и объясняют результат человеку.
- **Don't** выдавать локальные Stars/collectibles за real-money settlement, Telegram/TON/blockchain minting, E2EE или официальные Telegram assets без реальной интеграции.
- **Don't** заменять аватар или verification коллекционным предметом; featured gift и name marker — дополнительные, ограниченные слоты.
- **Don't** разносить случайные яркие цвета по UI: произвольная насыщенность живёт внутри media/collectible world, системные сигналы сохраняют свои роли.
- **Don't** возвращать white-on-light-violet normal-size labels: системный `colors.primary` намеренно затемнён и обеспечивает AA, а светлый violet разрешён как акцентный текст на тёмной поверхности.
- **Don't** скрывать необратимость transfer/purchase или показывать интерактивный control без завершённого flow, disabled state или честной unavailable-copy.
