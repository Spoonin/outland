#!/usr/bin/env python3
"""
PROTOTYPE — throwaway TUI shell over the refined economy.py (node graph).

Run:  python3 prototype/sim.py

Drive the colony window-by-window and watch the two metrics diverge: autonomy
(by mass, seductive) climbs while self-sufficiency (survival runway) stays pinned
near the floor — the D-025 gap. Logic lives in economy.py; this shell is throwaway.
"""

import sys
import termios
import tty

from economy import (
    Params, State, step, GRAPH, mes,
    needs, autonomy_by_mass, survival_runway,
)

B = "\x1b[1m"; D = "\x1b[2m"; R = "\x1b[0m"
G = "\x1b[32m"; Y = "\x1b[33m"; RED = "\x1b[31m"


def getch() -> str:
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        ch = sys.stdin.read(1)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
    return ch


def bar(frac, width=24):
    frac = max(0.0, min(1.0, frac))
    n = int(round(frac * width))
    return "█" * n + "·" * (width - n)


def spark(vals, width=40):
    if not vals:
        return ""
    blocks = "▁▂▃▄▅▆▇█"
    lo, hi = min(vals), max(vals)
    rng = hi - lo or 1.0
    return "".join(blocks[int((v - lo) / rng * (len(blocks) - 1))] for v in vals[-width:])


class Sim:
    def __init__(self):
        self.p = Params()
        self.reset()

    def reset(self):
        self.s = State.new(self.p)
        self.history = []

    def one(self):
        if self.s.window < self.p.max_windows and not self.s.collapsed:
            self.history.append(step(self.s))

    def run_to_end(self):
        while self.s.window < self.p.max_windows and not self.s.collapsed:
            self.history.append(step(self.s))

    def render(self):
        p, s = self.p, self.s
        nd = needs(s)
        print("\x1b[2J\x1b[H", end="")
        print(f"{B}OUTLAND — песочница экономики (граф узлов){R}  "
              f"{D}вопрос: автономия растёт, самодостаточность — нет?{R}\n")

        eff = self.history[-1]["eff_per_kg"] if self.history else 0
        print(f"{B}Крутилки{R}  топливо={p.fuel_per_kg:,.0f}/кг  эфф.$/кг={eff:,.0f}  "
              f"пуск.K={s.launch_K:,.0f}кг/окно  k={p.k:.2f}  инфл={p.inflation:.0%}  M={p.M:,.0f}")
        ev_on = f"{G}вкл{R}" if p.enable_events else f"{D}выкл{R}"
        fu_on = f"{G}вкл{R}" if p.enable_fusion else f"{D}выкл{R}"
        fus = {"none": f"{D}—{R}", "saving": f"{Y}копит {s.fusion_fund/p.M:.1f}/{p.fusion_cost_M:.0f}M{R}",
               "online": f"{G}ОНЛАЙН{R}"}[s.fusion]
        print(f"{D}[1/2]топл [3/4]k [5/6]инфл [7/8]M{R}   "
              f"термояд[f]:{fu_on} {fus}   события[e]:{ev_on}\n")

        # nodes
        cells = []
        for n in GRAPH:
            if n.black:
                glyph = f"{RED}⚫{R}"
            elif s.localized[n.name]:
                glyph = f"{G}🟢{R}"
            elif nd[n.name] >= mes(p, n):
                glyph = f"{Y}🟡{R}"
            else:
                glyph = f"{RED}🔴{R}"
            cells.append(f"{glyph}{n.name[:9]:<9}")
        for i in range(0, len(cells), 5):
            print("  " + " ".join(cells[i:i + 5]))
        print(f"  {D}🟢лок 🟡можно 🔴импорт ⚫чёрный (нелокализуемо){R}\n")

        # table
        print(f"{B}{'ок':>3}{'насел':>7}{'автон':>7}{'запас':>6}{'F/M':>6}  события{R}")
        for r in self.history[-12:]:
            fm = r["F"] / p.M
            col = G if fm < 0.75 else (Y if fm < 1.0 else RED)
            ev = [f"{Y}{e}{R}" for e in r["events"]]
            if r["localized_this"]:
                ev.append(f"{G}+{','.join(x[:5] for x in r['localized_this'])}{R}")
            if r["reverted"]:
                ev.append(f"{RED}-{','.join(x[:5] for x in r['reverted'])}{R}")
            if r["mortality"]:
                ev.append(f"{RED}†{r['mortality']}{R}")
            if r["collapsed"]:
                ev.append(f"{RED}{B}КРАХ{R}")
            print(f"{r['window']:>3}{r['pop']:>7}{r['autonomy']*100:>6.0f}%{r['runway']:>6}"
                  f"{col}{fm:>6.2f}{R}  " + "  ".join(ev))

        aut = autonomy_by_mass(s, nd)
        rw = survival_runway(s, nd)
        print()
        print(f"{B}автономия      {R}{bar(aut)} {aut*100:5.1f}%  {D}(соблазн — по массе){R}")
        print(f"{B}самодостат-сть {R}{bar(rw/4.0)} {rw} окон  {D}(правда — запас хода при обрыве){R}")
        auts = [r["autonomy"] * 100 for r in self.history]
        rws = [r["runway"] for r in self.history]
        print(f"{B}кривая автон   {R}{spark(auts)}")
        print(f"{B}кривая запаса  {R}{spark(rws)}")

        print()
        if s.collapsed:
            print(f"{RED}{B}► Колония схлопнулась на окне {s.window}.{R}")
        elif s.plateaued_at > 0:
            print(f"{Y}► Автономия на плато ~{aut*100:.0f}% (с окна {s.plateaued_at}); "
                  f"самодостаточность ~{rw} окон — разрыв и есть тезис.{R}")
        if s.window >= p.max_windows:
            print(f"{D}► Конец партии ({p.max_windows} окон).{R}")
        print(f"\n{D}[t] шаг   [r] до конца   [n] сброс   [q] выход{R}")

    def knob(self, ch):
        p = self.p
        if ch == "1": p.fuel_per_kg = max(100, p.fuel_per_kg * 0.8)
        elif ch == "2": p.fuel_per_kg *= 1.25
        elif ch == "3": p.k = max(1.1, p.k - 0.1)
        elif ch == "4": p.k += 0.1
        elif ch == "5": p.inflation = max(0.0, p.inflation - 0.01)
        elif ch == "6": p.inflation += 0.01
        elif ch == "7": p.M = max(1e10, p.M * 0.8)
        elif ch == "8": p.M *= 1.25
        elif ch == "e": p.enable_events = not p.enable_events
        elif ch == "f": p.enable_fusion = not p.enable_fusion
        else:
            return False
        self.reset()
        return True


def main():
    sim = Sim()
    while True:
        sim.render()
        ch = getch()
        if ch in ("q", "\x03"):
            print("\x1b[2J\x1b[H", end="")
            break
        elif ch == "t":
            sim.one()
        elif ch == "r":
            sim.run_to_end()
        elif ch == "n":
            sim.reset()
        else:
            sim.knob(ch)


if __name__ == "__main__":
    main()
