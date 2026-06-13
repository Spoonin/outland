#!/usr/bin/env python3
"""
PROTOTYPE — throwaway TUI shell over economy.py.

Run:  python3 prototype/sim.py

Drive the Outland economy by hand and watch whether autonomy plateaus below
100% and collapse arrives gradually. The logic lives in economy.py; this file
is just the screen + keystrokes and gets deleted once the question is answered.
"""

import sys
import termios
import tty

from economy import Params, State, step, mes, import_floor, autonomy_by_mass

B = "\x1b[1m"
D = "\x1b[2m"
R = "\x1b[0m"
G = "\x1b[32m"
Y = "\x1b[33m"
RED = "\x1b[31m"


def getch() -> str:
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        ch = sys.stdin.read(1)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
    return ch


def bar(frac: float, width: int = 24) -> str:
    frac = max(0.0, min(1.0, frac))
    n = int(round(frac * width))
    return "█" * n + "·" * (width - n)


def spark(vals, width=40) -> str:
    if not vals:
        return ""
    blocks = "▁▂▃▄▅▆▇█"
    lo, hi = min(vals), max(vals)
    rng = hi - lo or 1.0
    out = []
    for v in vals[-width:]:
        out.append(blocks[int((v - lo) / rng * (len(blocks) - 1))])
    return "".join(out)


class Sim:
    def __init__(self):
        self.p = Params()
        self.reset()

    def reset(self):
        self.s = State.new(self.p)
        self.history = []

    def run_to_end(self):
        while self.s.window < self.p.max_windows and not self.s.collapsed:
            self.history.append(step(self.s))

    def one(self):
        if self.s.window < self.p.max_windows and not self.s.collapsed:
            self.history.append(step(self.s))

    # ---- render ----
    def render(self):
        p, s = self.p, self.s
        print("\x1b[2J\x1b[H", end="")
        print(f"{B}OUTLAND — численная песочница экономики{R}  "
              f"{D}(прототип; вопрос: гнётся ли кривая к провалу постепенно?){R}\n")

        # knobs
        print(f"{B}Крутилки{R}  "
              f"c={p.c:,.0f}/кг  k={p.k:.2f}  износ(tail)={p.tail_max:.2f}  "
              f"M={p.M:,.0f}  pop0={p.pop0:,.0f}")
        print(f"{D}  [1/2] c-/+   [3/4] k-/+   [5/6] износ-/+   "
              f"[7/8] субсидия M-/+   [9/0] pop0-/+   (смена крутилки = сброс){R}\n")

        # tiers map
        tiers = []
        for t in range(p.tiers):
            m = mes(p, t)
            if m == float("inf"):
                mark = f"{RED}⚫{R}"
            elif s.localized[t]:
                mark = f"{G}🟢{R}"
            elif s.pop >= m:
                mark = f"{Y}🟡{R}"
            else:
                mark = f"{RED}🔴{R}"
            tiers.append(f"T{t+1}{mark}")
        print(f"{B}Тиры{R} (1=балк … {p.black_from}+=чёрные): " + " ".join(tiers))
        fus = {
            "none": f"{D}—{R}",
            "saving": f"{Y}копит {s.fusion_fund/p.M:.1f}/{p.fusion_cost_M:.0f}M{R}",
            "online": f"{G}ОНЛАЙН{R}",
        }[s.fusion]
        ev_on = f"{G}вкл{R}" if p.enable_events else f"{D}выкл{R}"
        fu_on = f"{G}вкл{R}" if p.enable_fusion else f"{D}выкл{R}"
        print(f"{B}Термояд{R}: {fus}   {B}события{R}[e]: {ev_on}   "
              f"{B}мегапроект{R}[f]: {fu_on}\n")

        # table
        print(f"{B}{'окно':>4} {'год':>5} {'насел':>7} {'автоном':>8} "
              f"{'F/M':>6} {'своб':>10}  события{R}")
        for r in self.history[-16:]:
            f_m = r["F"] / p.M
            col = G if f_m < 0.75 else (Y if f_m < 1.0 else RED)
            ev = [f"{Y}{e}{R}" for e in r.get("events", [])]
            if r["localized_this"]:
                ev.append(f"{G}+лок T{','.join(map(str, r['localized_this']))}{R}")
            if r["reverted"]:
                ev.append(f"{RED}-гаснет T{','.join(map(str, r['reverted']))}{R}")
            if r["mortality"]:
                ev.append(f"{RED}†{r['mortality']}{R}")
            if r["collapsed"]:
                ev.append(f"{RED}{B}КОЛЛАПС{R}")
            print(f"{r['window']:>4} {r['year']:>5} {r['pop']:>7} "
                  f"{r['autonomy']*100:>7.1f}% {col}{f_m:>6.2f}{R} "
                  f"{r['free']/1e9:>8.0f}Б  " + "  ".join(ev))

        # current derived
        aut = autonomy_by_mass(s)
        f = import_floor(s)
        print()
        print(f"{B}автономия{R} {bar(aut)} {aut*100:5.1f}%   "
              f"{D}(плато ниже 100% = тезис){R}")
        print(f"{B}F / M    {R} {bar(f/p.M)} {f/p.M*100:5.0f}%   "
              f"{D}(пол импорта съедает субсидию){R}")
        auts = [r["autonomy"] * 100 for r in self.history]
        print(f"{B}кривая   {R} {spark(auts)}")

        # verdict
        print()
        if s.collapsed:
            print(f"{RED}{B}► Колония схлопнулась на окне {s.window} "
                  f"(год ~{s.window*2.17:.0f}).{R}")
        elif s.plateaued_at > 0:
            print(f"{Y}► Автономия вышла на плато ~{aut*100:.0f}% с окна "
                  f"{s.plateaued_at}; 100% недостижимо.{R}")
        if s.window >= p.max_windows:
            print(f"{D}► Достигнут конец партии ({p.max_windows} окон).{R}")

        print(f"\n{D}[t] шаг   [r] до конца   [n] сброс   [q] выход{R}")

    # ---- knobs ----
    def knob(self, ch) -> bool:
        p = self.p
        if ch == "1": p.c = max(1e4, p.c * 0.8)
        elif ch == "2": p.c *= 1.25
        elif ch == "3": p.k = max(1.1, p.k - 0.1)
        elif ch == "4": p.k += 0.1
        elif ch == "5": p.tail_max = max(0.0, p.tail_max - 0.03)
        elif ch == "6": p.tail_max = min(0.9, p.tail_max + 0.03)
        elif ch == "7": p.M = max(1e10, p.M * 0.8)
        elif ch == "8": p.M *= 1.25
        elif ch == "9": p.pop0 = max(100, p.pop0 - 200)
        elif ch == "0": p.pop0 += 200
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
