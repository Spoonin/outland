# SDD — движок Outland (`src/engine/`)

> Software Design Document симуляционного ядра. Чистый TS, ноль UI-зависимостей (D-040).
> Истина по числам/механике — `mechanics.md`, `graph.md`, `references.md`; референс-реализация —
> `prototype/economy.py`. Этот документ — контракт движка для порта на TS через TDD.
> Статус: проектирование/порт (Фаза 1).

---

## 1. Роль и назначение

Движок — это **сам аргумент игры**: честный детерминированный расчёт, из которого эмёрджентно
встаёт тезис (автономия плато <100%, запас хода пригвождён, эфф. $/кг ~$1M). UI ничего не считает —
только отображает состояние и шлёт действия. Поэтому движок:

- **чистый** — никаких DOM/сети/таймеров; только данные → данные;
- **детерминированный** — при фиксированном сиде и решениях траектория воспроизводима (D-011);
- **полностью юнит-тестируем** — золотые тесты сверяют его с числами прототипа.

## 2. Принципы проектирования

- **Данные ⟂ логика.** Граф (`graph.ts`) и параметры (`Params`) — данные; функции (`sim.ts`) — чистые.
- **`step()` — единственная мутация.** Одно синодическое окно = один вызов `step(state) → report`.
  Состояние мутируется in-place (как в прототипе), но всё остальное — чистые функции от состояния.
- **Решение игрока инъектируется** (Фаза 3): `step(state, decision)`. До Фазы 3 жадная авто-политика
  (`policy.ts`) стоит за игрока — она же baseline-ИИ и оракул тестов.
- **Float-совместимость с Python.** `Math.pow`/`Math.exp` (IEEE-754) → числа сходятся к прототипу
  до ~1e-12. Точки округления (`round`) сверяются с допуском ±1 (Python banker's vs JS round).

## 3. Карта модулей

| Модуль | Экспортирует | Чистота |
|--------|--------------|---------|
| `types.ts` | `Node`, `Params`, `GameState`, `StepReport`, `defaultParams()` | типы/фабрики |
| `graph.ts` | `GRAPH: Node[]`, `NODES: Record<name,Node>`, `CONSUMERS: Record<name,[name,qty][]>` | данные |
| `rng.ts` | `makeRng(seed) → { random(), choice(arr) }` | детерминированный |
| `sim.ts` | `mes`, `tailFrac`, `needs`, `importBreakdown`, `launchMaint`, `autonomyByMass`, `survivalRunway`, `newState`, `step` | чистые (кроме `step`, мутирующего `state`) |
| `policy.ts` | `greedyAllocate(state, capital, priceMult, nd)` — жадная локализация | чистая (мутирует state) |
| `index.ts` | barrel-реэкспорт | — |

## 4. Модель данных

```ts
interface Node {
  name: string;
  tier: number;          // глубина → MES = mes0 · k^(tier-1)
  mass: number;          // кг/ед. — автономия-по-массе + нагрузка на пусковую мощность
  earthCost: number;     // внутренняя $/ед. (без доставки)
  cons: number;          // подушевое потребление (0 = чистый промежуточный)
  inputs: [string, number][];  // BOM: [имя входа, кол-во на ед.]
  black: boolean;        // MES = ∞, не локализуется
  crit: number;          // вес критичности (для запаса хода); ≥0.5 учитывается законом Либиха
}

interface Params { /* все дефолты — §6, дублируют economy.py Params */ }

interface GameState {
  p: Params;
  window: number;
  pop: number;
  localized: Record<string, boolean>;
  age: Record<string, number>;
  collapsed: boolean;
  plateauedAt: number;       // -1 пока не плато
  lastAutonomy: number;
  rng: Rng;
  fusion: 'none' | 'saving' | 'online';
  fusionFund: number;
  launchK: number;           // построенная пусковая мощность (кг/окно), сунк + содержится
}

interface StepReport { window, year, pop, autonomy, runway, F, Meff, free,
  localizedThis[], reverted[], mortality, events[], fusion, collapsed,
  launchK, launchCapex, effPerKg }
```

## 5. Граф

27 узлов, зеркалит `graph.md`/`economy.py GRAPH`. `NODES` — индекс по имени; `CONSUMERS[n]` —
список `(потребитель, кол-во)`, кто использует `n` входом (строится из `inputs` один раз).
Инвариант: чёрные узлы имеют пустой `inputs` (их вход не порождает производный спрос, т.к. не
локализуются). Граф — DAG (входы всегда «глубже/выше по тиру»; циклов нет).

## 6. Ключевые функции (контракт)

- **`mes(p, node)`** → `node.black ? Infinity : p.mes0 · p.k^(tier-1)`. Спот: tier1=300, tier5=4800, black=∞.
- **`tailFrac(p, age)`** → `p.tailMax · (1 - e^(-age/p.tailRamp))`. Хвост обслуживания: локализованный
  узел всё равно импортирует долю (растёт с возрастом до `tailMax`). Спот: `tailFrac(·,3)=0.113782`.
- **`needs(state)`** → `Record<name, demand>`. Спрос = потребление (`cons·pop`) + **производный**
  (для каждого локализованного потребителя: `qty · need(потребитель)`). Импорт готового товара
  производного спроса НЕ даёт. DAG, мемоизация (D-029).
- **`importBreakdown(state, nd, priceMult)`** → `{ fImp, shipMass }`. По всем узлам: импортируемые
  единицы = `nd · (localized ? tailFrac(age) : 1)`; `fImp += units·(earthCost + mass·fuelPerKg)·priceMult`;
  `shipMass += units·mass`. Если термояд online — `fImp·(1-discount) + fusionMaint·M·(pop/pop0)`. (D-038)
- **`launchMaint(state)`** → `launchMaintFrac · launchCapexPerKg · launchK`. Платится даже вхолостую.
- **`autonomyByMass(state, nd)`** → доля массы спроса, покрытая локально: `Σ loc·(1-tail)·mass / Σ nd·mass` (D-025).
- **`survivalRunway(state, nd)`** → `round(0.5 + worst·3, 1)`, где `worst` = мин. по критическим
  (`crit≥0.5`) узлам доли локального покрытия. Чёрные критичные (фарма/чипы) → worst≈0 → запас ≈0.5 (закон Либиха).

## 7. Конвейер `step()` — порядок стадий (сердце движка)

`step(state)` ⇒ `state.window++`, затем строго по порядку:

1. **Инфляция (D-031):** `priceMult = (1+inflation)^window`; `mEff = M`.
2. **Земное событие (D-031, если events):** бросок `< earthEventProb` → 50/50 урезание субсидии
   (`mEff·=earthCut`) или скачок цен (`priceMult·=earthSpike`).
3. **Поломка (§12.4, если events):** `nd=needs`; `fPre=importBreakdown+launchMaint`;
   `bd=breakdownBase+breakdownMargin·min(2,fPre/M)`; бросок `<bd` → откат случайного локализованного
   узла (`localized=false, age=0`).
4. **Импорт и мощность (D-038):** `nd=needs`; `{fImp,shipMass}=importBreakdown`. Если
   `shipMass>launchK` → `launchCapexNow=(shipMass-launchK)·launchCapexPerKg`, `launchK=shipMass`.
   `F=fImp+launchMaint`; `free=mEff-F-launchCapexNow`.
5. **Термояд (D-033):** если плато достигнуто и fusion=none → `saving`; в `saving` копит
   `free·fusionSaveFrac` в фонд до `fusionCostM·M` → `online`.
6. **Локализация / население** (если `free≥0`): жадная локализация (§8), затем завоз колонистов
   из остатка сверх резерва, затем рождения если `medical_infra` локализован. Иначе (`free<0`):
   смертность `pop·min(0.9, mortFactor·(-free)/F)`.
7. **Откат по MES (§5.6/§6.5):** локализованный узел с `pop < mes·revertHysteresis` → гаснет.
8. **Старение:** `age++` для локализованных.
9. **Метрики:** `nd=needs`; `autonomy`, `runway`; детект плато (`window>3 && autonomy≤lastAutonomy && !localizedThis`);
   `collapsed` если `pop < pop0·0.2`. Сбор `StepReport` (вкл. `effPerKg=(fImp+launchMaint)/shipMass`).

## 8. Политика (жадный baseline, `policy.ts`)

Пока за игрока: цикл — среди приемлемых (`!localized && !black && nd≥mes && capitalCost≤capital`)
выбрать узел с макс. `saved/cap`, где `cap=capitalFactor·mes`, `saved=nd·(1-tailMax)·(earthCost+mass·fuelPerKg)·priceMult`;
локализовать, вычесть `cap`, повторять пока есть приемлемые. В Фазе 3 заменяется решением игрока,
но остаётся как ИИ/оракул.

## 9. Детерминизм и RNG

- `rng.ts` — сид-генератор (mulberry32 или аналог): `random()∈[0,1)`, `choice(arr)`.
- ⚠️ **Python `random` точно не воспроизводится** в TS. Поэтому:
  - **events-OFF траектория полностью детерминирована** (RNG не вызывается) → золотые тесты с
    точными числами (см. §10).
  - **events-ON** проверяется инвариантами/статистикой по сидам, не точной последовательностью.

## 10. Стратегия тестирования (золотые тесты)

Эталон снят из `prototype/economy.py` (events OFF, дефолтные Params, fusion ON):

| Окно | autonomy | runway | F/M | effPerKg | launchK | fusion |
|-----:|---------:|-------:|----:|---------:|--------:|--------|
| 1 | 0.546488 | 0.5 | 0.024635 | 60959 | 404125 | none |
| 5 | 0.786136 | 0.5 | 0.092698 | 237461 | 436858 | none |
| 11 | 0.750135 | 0.5 | 0.156678 | 225916 | 693526 | online |
| 12 | 0.748537 | 0.5 | 0.627446 | 869288 | 721793 | online |
| 20 | 0.773809 | 0.5 | 0.782396 | 893081 | 876064 | online |
| 40 | 0.771335 | 0.5 | 0.958015 | 1145871 | 876064 | online |

`plateauedAt=5`, `collapsed=false`. Инварианты (на всех окнах, любой сид/настройки):
**`runway==0.5`** (чёрные критичные), **`autonomy<0.81`** (плато <100%), **`effPerKg ≫ fuelPerKg`**
(капитал мощности доминирует). Допуски: `autonomy` — `toBeCloseTo(·,5)`; округлённые поля — ±1.

Порядок порта (TDD, тест→код по частям): A `types`+`mes`/`tailFrac` → B `graph`+`CONSUMERS` →
C `needs` → D `importBreakdown`/`launchMaint`/`autonomyByMass`/`survivalRunway` → E `rng` →
F `step`+`policy`+золотая траектория.

## 11. Связь с решениями и упрощения

Реализует: D-025 (две метрики), D-026 (граф узлов), D-027 (единый ledger), D-029 (производный спрос),
D-030 (население-рычаг), D-031 (инфляция/события), D-033 (термояд), D-038 (мощность-капитал).
**Упрощения среза (за скоупом):** D-035 платная разведка (туман — UI-слой, не движок), D-028
конвейер навыков свёрнут в единый MES-гейт, D-039 лестница запуска (одна ручка `K`), D-034 пулы
специалистов. Жадная политика — заглушка под игрока (Фаза 3).
