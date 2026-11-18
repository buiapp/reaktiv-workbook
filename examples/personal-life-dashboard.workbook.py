# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
#   "pandas",
#   "matplotlib",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from reaktiv import computed, field
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["PersonalLifeDashboardWorkbook"]):
    # ── Profile & controls ────────────────────────────────────────────────
    owner_name = cell(
        "A1", field("Alex"), label="owner_name", view={"widget": {"type": "text"}}
    )

    @cell("B1", label="cashflow")
    @computed
    def cashflow(self):
        months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        rows = []
        for index, income in enumerate(self.net_income()):
            spent = sum(values[index] for values in self.expenses().values())
            rows.append(
                {
                    "month": months[index],
                    "income": income,
                    "spent": spent,
                    "saved": income - spent,
                    "rate": (income - spent) / income if income else 0.0,
                }
            )
        return rows

    @cell("C1", label="cashflow_chart")
    @computed
    def cashflow_chart(self):
        import matplotlib.pyplot as plt

        style = self.chart_style()
        rows = self.cashflow()
        months = [row["month"] for row in rows]
        with plt.rc_context(style["rc"]):
            figure, axes = plt.subplots(figsize=(8.4, 3.8))
            bottom = [0] * len(rows)
            for slot, (category, values) in enumerate(self.expenses().items()):
                axes.bar(
                    months, values, bottom=bottom, width=0.62, label=category,
                    color=style["palette"][slot % len(style["palette"])],
                    edgecolor=style["surface"], linewidth=1.2,
                )
                bottom = [base + value for base, value in zip(bottom, values)]
            axes.plot(
                months, [row["income"] for row in rows], color=style["ink"],
                marker="o", markersize=6, markerfacecolor=style["surface"],
                markeredgewidth=2, label="Take-home pay", zorder=5,
            )
            focus = months.index(self.focus_month()) if self.focus_month() in months else len(months) - 1
            axes.annotate(
                f"saved {rows[focus]['rate']:.0%}",
                (focus, rows[focus]["income"]), xytext=(0, 10),
                textcoords="offset points", ha="center", fontsize=8.5,
                fontweight="bold", color=style["ink"],
            )
            axes.set_title("Where the money goes · spending by category vs take-home pay")
            axes.yaxis.set_major_formatter(lambda value, _: f"${value / 1000:.0f}k")
            axes.grid(axis="x", visible=False)
            axes.set_ylim(0, max(row["income"] for row in rows) * 1.15)
            axes.legend(ncol=4, loc="upper center", bbox_to_anchor=(0.5, -0.1))
            figure.tight_layout()
        plt.close(figure)
        return figure

    @cell("E1", label="overview_note")
    @markdown
    def overview_note(self):
        return """# 🧭 Life dashboard

        [Name: {{ self.owner_name() }}](#sheet-input:owner_name?type=text)

        [Month in focus: {{ self.focus_month() }}](#sheet-input:focus_month?type=select&options=Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep)

        Hi **{{ self.owner_name() }}** 👋 This is the one-page view of your life right now. Each area
        has its own note in the sidebar (Finances, Home & mortgage, Health, Household); change a number
        anywhere and every note updates.

        ## At a glance

        | Area | Status | Headline |
        | --- | --- | ---: |
        | 💰 Money | {{ self.life_snapshot()['money'] }} | saved **{{ self.finance_summary()['rate'] }}** of pay in {{ self.finance_summary()['month'] }} |
        | 📈 Net worth | {{ self.net_worth()['net_text'] }} | {{ self.net_worth()['runway'] }} of emergency runway |
        | 🏡 Mortgage | {{ self.life_snapshot()['mortgage'] }} | payoff **{{ self.mortgage_plan()['payoff'] }}** |
        | ❤️ Health | {{ self.life_snapshot()['health'] }} | {{ self.health_summary()['weight'] }} · {{ self.health_summary()['change'] }} |
        | 🧰 Household | {{ self.life_snapshot()['home'] }} | next: {{ self.household_summary()['next_task'] }} |

        {{ self.cashflow_chart() }}

        {{ self.net_worth_chart() }}

        {{ self.goals_chart() }}

        > **Make it yours:** replace the sample data in column A (income, spending, accounts, mortgage,
        weekly health log, bills, maintenance) with your own. The whole dashboard is one Python file you
        can keep in git."""

    focus_month = cell(
        "A2",
        field("Sep"),
        label="focus_month",
        view={
            "widget": {
                "type": "select",
                "options": [
                    "Jan",
                    "Feb",
                    "Mar",
                    "Apr",
                    "May",
                    "Jun",
                    "Jul",
                    "Aug",
                    "Sep",
                ],
            }
        },
    )

    @cell("B2", label="finance_summary")
    @computed
    def finance_summary(self):
        rows = self.cashflow()
        index = next(
            (position for position, row in enumerate(rows) if row["month"] == self.focus_month()),
            len(rows) - 1,
        )
        current, previous = rows[index], rows[max(0, index - 1)]
        ytd_income = sum(row["income"] for row in rows[: index + 1])
        ytd_saved = sum(row["saved"] for row in rows[: index + 1])
        ytd_rate = ytd_saved / ytd_income if ytd_income else 0.0
        change = current["spent"] - previous["spent"]
        biggest = max(self.expenses(), key=lambda name: self.expenses()[name][index])
        return {
            "month": current["month"],
            "income": f"${current['income']:,.0f}",
            "spent": f"${current['spent']:,.0f}",
            "saved": f"${current['saved']:,.0f}",
            "rate": f"{current['rate']:.0%}",
            "spend_change": f"{'+' if change >= 0 else '−'}${abs(change):,.0f} vs {previous['month']}",
            "ytd_saved": f"${ytd_saved:,.0f}",
            "ytd_rate": f"{ytd_rate:.0%}",
            "target": f"{self.savings_rate_target():.0%}",
            "biggest": f"{biggest} (${self.expenses()[biggest][index]:,.0f})",
            "status": "✅ On track" if current["rate"] >= self.savings_rate_target() else "⚠️ Below target",
        }

    @cell("C2", label="savings_rate_chart")
    @computed
    def savings_rate_chart(self):
        import matplotlib.pyplot as plt

        style = self.chart_style()
        rows = self.cashflow()
        target = self.savings_rate_target()
        with plt.rc_context(style["rc"]):
            figure, axes = plt.subplots(figsize=(8.4, 2.6))
            colors = [style["palette"][0] if row["rate"] >= target else style["track"] for row in rows]
            axes.bar([row["month"] for row in rows], [row["rate"] * 100 for row in rows], color=colors, width=0.62)
            axes.axhline(target * 100, color=style["ink"], linestyle=(0, (4, 3)), linewidth=1.2)
            axes.set_title(f"Savings rate by month · dashed = {target:.0%} target, blue = met")
            axes.yaxis.set_major_formatter(lambda value, _: f"{value:.0f}%")
            axes.grid(axis="x", visible=False)
            figure.tight_layout()
        plt.close(figure)
        return figure

    @cell("E2", label="finances_note")
    @markdown
    def finances_note(self):
        return """# 💰 Finances

        [Month in focus: {{ self.focus_month() }}](#sheet-input:focus_month?type=select&options=Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep)

        [Savings-rate target: {{ self.savings_rate_target() }}](#sheet-input:savings_rate_target?type=range&min=0.05&max=0.5&step=0.01)

        ## {{ self.finance_summary()['month'] }} in numbers

        | | |
        | --- | ---: |
        | Take-home pay | {{ self.finance_summary()['income'] }} |
        | Spent | {{ self.finance_summary()['spent'] }} ({{ self.finance_summary()['spend_change'] }}) |
        | Saved | **{{ self.finance_summary()['saved'] }}** |
        | Savings rate | **{{ self.finance_summary()['rate'] }}** vs target {{ self.finance_summary()['target'] }} — {{ self.finance_summary()['status'] }} |
        | Biggest category | {{ self.finance_summary()['biggest'] }} |
        | Saved year-to-date | {{ self.finance_summary()['ytd_saved'] }} ({{ self.finance_summary()['ytd_rate'] }} of pay) |

        {{ self.spending_breakdown_chart() }}

        {{ self.savings_rate_chart() }}

        {{ self.cashflow_chart() }}

        ## Net worth

        | | |
        | --- | ---: |
        | Assets (incl. home) | {{ self.net_worth()['assets_text'] }} |
        | Debts (incl. mortgage) | {{ self.net_worth()['debt_text'] }} |
        | **Net worth** | **{{ self.net_worth()['net_text'] }}** |
        | Cash on hand | {{ self.net_worth()['liquid'] }} |
        | Emergency runway | {{ self.net_worth()['runway'] }} of average spending |

        {{ self.net_worth_chart() }}

        ## Savings goals

        {{ self.goals_summary()['saved'] }} saved of {{ self.goals_summary()['target'] }} across all goals
        (**{{ self.goals_summary()['progress'] }}**). Closest to done: {{ self.goals_summary()['closest'] }}.

        {{ self.goals_chart() }}"""

    # ── Finances: monthly take-home pay and spending by category ─────────
    net_income = cell(
        "A3",
        field([6400, 6400, 8900, 6400, 6550, 6550, 6550, 6550, 6700]),
        label="net_income",
    )

    @cell("B3", label="net_worth")
    @computed
    def net_worth(self):
        assets = dict(self.accounts())
        assets["Home"] = self.home_value()
        liabilities = dict(self.other_debts())
        liabilities["Mortgage"] = self.mortgage_plan()["balance_today"]
        total_assets = sum(assets.values())
        total_debt = sum(liabilities.values())
        emergency_months = self.accounts().get("High-yield savings", 0) / (
            sum(row["spent"] for row in self.cashflow()) / len(self.cashflow())
        )
        return {
            "assets": assets,
            "liabilities": liabilities,
            "net": total_assets - total_debt,
            "net_text": f"${total_assets - total_debt:,.0f}",
            "assets_text": f"${total_assets:,.0f}",
            "debt_text": f"${total_debt:,.0f}",
            "home_equity": f"${self.home_value() - liabilities['Mortgage']:,.0f}",
            "liquid": f"${self.accounts().get('Checking', 0) + self.accounts().get('High-yield savings', 0):,.0f}",
            "runway": f"{emergency_months:.1f} months",
        }

    @cell("C3", label="spending_breakdown_chart")
    @computed
    def spending_breakdown_chart(self):
        import matplotlib.pyplot as plt

        style = self.chart_style()
        months = [row["month"] for row in self.cashflow()]
        index = months.index(self.focus_month()) if self.focus_month() in months else len(months) - 1
        # Colour follows the category (same as the cash-flow chart), never its rank.
        ranked = sorted(
            (amounts[index], name, style["palette"][slot % len(style["palette"])])
            for slot, (name, amounts) in enumerate(self.expenses().items())
        )
        values = [item[0] for item in ranked]
        with plt.rc_context(style["rc"]):
            figure, axes = plt.subplots(figsize=(8.4, 3.0))
            bars = axes.barh([item[1] for item in ranked], values, color=[item[2] for item in ranked], height=0.62)
            axes.bar_label(bars, labels=[f"${value:,.0f}" for value in values], padding=4, fontsize=8.5, color=style["ink"])
            axes.set_title(f"Spending in {months[index]} · ${sum(values):,.0f} total")
            axes.xaxis.set_major_formatter(lambda value, _: f"${value:,.0f}")
            axes.grid(axis="y", visible=False)
            axes.set_xlim(0, max(values) * 1.18)
            figure.tight_layout()
        plt.close(figure)
        return figure

    @cell("E3", label="mortgage_note")
    @markdown
    def mortgage_note(self):
        return """# 🏡 Home & mortgage

        [Home value: {{ self.home_value() }}](#sheet-input:home_value?type=number)

        [Interest rate: {{ self.mortgage_rate() }}](#sheet-input:mortgage_rate?type=range&min=0.02&max=0.08&step=0.0025)

        [Loan term (years): {{ self.loan_years() }}](#sheet-input:loan_years?type=range&min=10&max=30&step=5)

        [Extra payment per month: {{ self.extra_payment() }}](#sheet-input:extra_payment?type=range&min=0&max=2000&step=50)

        | | |
        | --- | ---: |
        | Monthly payment | {{ self.mortgage_plan()['payment_text'] }} + extra = **{{ self.mortgage_plan()['total_payment_text'] }}** |
        | Balance today | {{ self.mortgage_plan()['balance_text'] }} ({{ self.mortgage_plan()['progress'] }} of the term behind you) |
        | Home equity | **{{ self.net_worth()['home_equity'] }}** ({{ self.mortgage_plan()['equity_share'] }}) · loan-to-value {{ self.mortgage_plan()['ltv'] }} |
        | Mortgage-free | **{{ self.mortgage_plan()['payoff'] }}** |
        | Extra payments save | **{{ self.mortgage_plan()['interest_saved'] }}** interest and {{ self.mortgage_plan()['time_saved'] }} |
        | Lifetime interest | {{ self.mortgage_plan()['lifetime_interest'] }} |

        {{ self.mortgage_chart() }}

        > Try the sliders: drag the rate to see what a refinance would do, or the extra payment to see
        how many years you can shave off."""

    expenses = cell(
        "A4",
        field(
            {"Housing": [2310, 2310, 2310, 2310, 2310, 2310, 2310, 2310, 2310], "Groceries": [612, 580, 645, 598, 630, 655, 702, 640, 618], "Transport": [310, 295, 342, 360, 288, 410, 520, 305, 298], "Utilities": [265, 248, 212, 176, 150, 162, 188, 194, 170], "Health": [95, 95, 140, 95, 95, 210, 95, 95, 120], "Dining & fun": [420, 365, 510, 390, 455, 620, 880, 410, 385], "Shopping": [280, 190, 460, 230, 260, 340, 310, 520, 240]}
        ),
        label="expenses",
    )

    @cell("B4", label="goals_summary")
    @computed
    def goals_summary(self):
        goals = self.savings_goals()
        target = sum(goal[1] for goal in goals)
        saved = sum(goal[2] for goal in goals)
        closest = max(goals, key=lambda goal: goal[2] / goal[1])
        return {
            "saved": f"${saved:,.0f}",
            "target": f"${target:,.0f}",
            "progress": f"{saved / target:.0%}",
            "closest": f"{closest[0]} ({closest[2] / closest[1]:.0%})",
        }

    @cell("C4", label="net_worth_chart")
    @computed
    def net_worth_chart(self):
        import matplotlib.pyplot as plt

        style = self.chart_style()
        worth = self.net_worth()
        items = sorted(
            [*worth["assets"].items(), *((name, -value) for name, value in worth["liabilities"].items())],
            key=lambda item: item[1],
        )
        names = [name for name, _ in items]
        values = [value for _, value in items]
        colors = [style["palette"][0] if value >= 0 else style["palette"][7] for value in values]
        with plt.rc_context(style["rc"]):
            figure, axes = plt.subplots(figsize=(8.4, 3.6))
            bars = axes.barh(names, values, color=colors, height=0.62)
            axes.bar_label(
                bars, labels=[f"${abs(value) / 1000:,.0f}k" for value in values],
                padding=4, fontsize=8.5, color=style["ink"],
            )
            axes.axvline(0, color=style["muted"], linewidth=1)
            axes.set_title(f"Net worth {worth['net_text']} · assets (blue) minus debts (red)")
            axes.xaxis.set_major_formatter(lambda value, _: f"{'−' if value < 0 else ''}${abs(value) / 1000:,.0f}k")
            axes.grid(axis="y", visible=False)
            span = max(abs(value) for value in values)
            axes.set_xlim(min(values) - span * 0.18, max(values) + span * 0.18)
            figure.tight_layout()
        plt.close(figure)
        return figure

    @cell("E4", label="health_note")
    @markdown
    def health_note(self):
        return """# ❤️ Health

        [Weight goal (kg): {{ self.weight_goal() }}](#sheet-input:weight_goal?type=number)

        [Daily step goal: {{ self.step_goal() }}](#sheet-input:step_goal?type=range&min=4000&max=15000&step=500)

        [Sleep goal (h): {{ self.sleep_goal() }}](#sheet-input:sleep_goal?type=range&min=6&max=9&step=0.25)

        | Metric | Latest | |
        | --- | ---: | --- |
        | Weight | **{{ self.health_summary()['weight'] }}** | {{ self.health_summary()['change'] }} · {{ self.health_summary()['to_go'] }} to go ({{ self.health_summary()['eta'] }}) |
        | Resting heart rate | {{ self.health_summary()['resting_hr'] }} | lower is fitter |
        | Sleep, 4-week avg | {{ self.health_summary()['sleep'] }} | {{ self.health_summary()['sleep_status'] }} |
        | Steps, 4-week avg | {{ self.health_summary()['steps'] }} | {{ self.health_summary()['steps_status'] }} |
        | Workouts | {{ self.health_summary()['workouts'] }} | |

        {{ self.health_chart() }}

        Add one row per week to `health_log` (A15): week start, weight, resting heart rate, average sleep,
        average daily steps, and number of workouts."""

    savings_rate_target = cell(
        "A5",
        field(0.25),
        label="savings_rate_target",
        view={"widget": {"type": "range", "min": 0.05, "max": 0.5, "step": 0.01}},
    )

    @cell("B5", label="mortgage_plan")
    @computed
    def mortgage_plan(self):
        from datetime import date

        principal = float(self.loan_amount())
        monthly_rate = self.mortgage_rate() / 12
        term = int(self.loan_years()) * 12
        payment = (
            principal * monthly_rate / (1 - (1 + monthly_rate) ** -term)
            if monthly_rate
            else principal / term
        )
        start_year, start_month = (int(part) for part in self.loan_start().split("-"))
        today = date.today()
        paid_months = max(0, (today.year - start_year) * 12 + today.month - start_month)

        schedules = {}
        for plan, extra in (("baseline", 0.0), ("accelerated", float(self.extra_payment()))):
            balance = principal
            balances, interest_by_year, principal_by_year = [principal], [], []
            total_interest = 0.0
            month = 0
            while balance > 0.005 and month < term:
                interest = balance * monthly_rate
                # Extra payments only start from today; history follows the baseline.
                extra_now = extra if month >= paid_months else 0.0
                principal_paid = min(balance, payment - interest + extra_now)
                balance -= principal_paid
                total_interest += interest
                if month % 12 == 0:
                    interest_by_year.append(0.0)
                    principal_by_year.append(0.0)
                interest_by_year[-1] += interest
                principal_by_year[-1] += principal_paid
                balances.append(balance)
                month += 1
            schedules[plan] = {
                "balances": balances,
                "months": month,
                "interest": total_interest,
                "interest_by_year": interest_by_year,
                "principal_by_year": principal_by_year,
            }

        baseline, accelerated = schedules["baseline"], schedules["accelerated"]
        balance_today = baseline["balances"][min(paid_months, len(baseline["balances"]) - 1)]
        months_saved = baseline["months"] - accelerated["months"]
        payoff_index = start_year * 12 + start_month - 1 + accelerated["months"]
        return {
            "start_year": start_year + (start_month - 1) / 12,
            "paid_months": paid_months,
            "balance_today": round(balance_today, 2),
            "baseline": baseline,
            "accelerated": accelerated,
            "payment_text": f"${payment:,.0f}",
            "total_payment_text": f"${payment + self.extra_payment():,.0f}",
            "balance_text": f"${balance_today:,.0f}",
            "equity_share": f"{1 - balance_today / self.home_value():.0%}",
            "ltv": f"{balance_today / self.home_value():.0%}",
            "progress": f"{paid_months / term:.0%}",
            "payoff": f"{['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][payoff_index % 12]} {payoff_index // 12}",
            "time_saved": f"{months_saved // 12} yr {months_saved % 12} mo",
            "interest_saved": f"${baseline['interest'] - accelerated['interest']:,.0f}",
            "lifetime_interest": f"${accelerated['interest']:,.0f}",
        }

    @cell("C5", label="goals_chart")
    @computed
    def goals_chart(self):
        import matplotlib.pyplot as plt

        style = self.chart_style()
        # Reverse so the first goal is drawn at the top; each keeps its own palette slot.
        goals = list(reversed(self.savings_goals()))
        colors = [style["palette"][slot % len(style["palette"])] for slot in reversed(range(len(goals)))]
        with plt.rc_context(style["rc"]):
            figure, axes = plt.subplots(figsize=(8.4, 0.62 * len(goals) + 0.9))
            names = [goal[0] for goal in goals]
            shares = [min(1.0, goal[2] / goal[1]) * 100 for goal in goals]
            axes.barh(names, [100] * len(goals), color=style["track"], height=0.5)
            axes.barh(names, shares, height=0.5, color=colors)
            for row, goal in enumerate(goals):
                axes.text(
                    101.5, row, f"{goal[2] / goal[1]:.0%}  ·  ${goal[2]:,.0f} of ${goal[1]:,.0f}",
                    va="center", fontsize=8.5, color=style["ink"],
                )
            axes.set_xlim(0, 135)
            axes.set_xticks([])
            axes.grid(False)
            axes.spines[["left", "bottom"]].set_visible(False)
            axes.set_title("Savings goals")
            figure.tight_layout()
        plt.close(figure)
        return figure

    @cell("E5", label="household_note")
    @markdown
    def household_note(self):
        return """# 🧰 Household

        | | |
        | --- | ---: |
        | Fixed bills per month | **{{ self.household_summary()['fixed_total'] }}** |
        | Next bill | {{ self.household_summary()['next_bill'] }} |
        | Then | {{ self.household_summary()['then_bill'] }} |
        | Pay manually | {{ self.household_summary()['manual_total'] }} ({{ self.household_summary()['manual_names'] }}) |
        | Overdue maintenance | **{{ self.household_summary()['overdue'] }}** · due in the next 2 weeks: {{ self.household_summary()['due_soon'] }} |
        | Next up | {{ self.household_summary()['next_task'] }} |

        {{ self.household_chart() }}

        ## Utilities

        Electricity last month: {{ self.household_summary()['electricity'] }} · water: {{ self.household_summary()['water'] }}

        {{ self.utilities_chart() }}

        When you finish a chore, update its date in `maintenance` (A20) and its bar resets. Add new bills to
        `bills` (A19) as `(name, category, amount, due day, autopay)`."""

    accounts = cell(
        "A6",
        field(
            {"Checking": 6200, "High-yield savings": 18400, "Brokerage": 41800, "Retirement (401k)": 96500, "Car": 17000}
        ),
        label="accounts",
    )

    @cell("B6", label="health_summary")
    @computed
    def health_summary(self):
        log = self.health_log()
        latest, first = log[-1], log[0]
        recent = log[-4:]
        avg_sleep = sum(week[3] for week in recent) / len(recent)
        avg_steps = sum(week[4] for week in recent) / len(recent)
        workouts = sum(week[5] for week in recent)
        lost = first[1] - latest[1]
        to_go = latest[1] - self.weight_goal()
        weekly_rate = lost / max(1, len(log) - 1)
        return {
            "weight": f"{latest[1]:.1f} kg",
            "change": f"−{lost:.1f} kg in {len(log)} weeks" if lost >= 0 else f"+{-lost:.1f} kg in {len(log)} weeks",
            "to_go": f"{max(0.0, to_go):.1f} kg",
            "eta": f"~{max(0.0, to_go) / weekly_rate:.0f} weeks" if weekly_rate > 0 else "—",
            "resting_hr": f"{latest[2]} bpm ({latest[2] - first[2]:+d})",
            "sleep": f"{avg_sleep:.1f} h",
            "sleep_status": "✅" if avg_sleep >= self.sleep_goal() else "⚠️",
            "steps": f"{avg_steps:,.0f}",
            "steps_status": "✅" if avg_steps >= self.step_goal() else "⚠️",
            "workouts": f"{workouts} in 4 weeks",
        }

    @cell("C6", label="mortgage_chart")
    @computed
    def mortgage_chart(self):
        import matplotlib.pyplot as plt

        style = self.chart_style()
        plan = self.mortgage_plan()
        start = plan["start_year"]
        with plt.rc_context(style["rc"]):
            figure, (balance_axes, split_axes) = plt.subplots(
                1, 2, figsize=(9.6, 3.6), gridspec_kw={"width_ratios": [1.35, 1]}
            )
            for key, label, color, dash in (
                ("baseline", "Scheduled", style["muted"], (0, (4, 3))),
                ("accelerated", f"With +${self.extra_payment():,.0f}/mo", style["palette"][0], "solid"),
            ):
                balances = plan[key]["balances"]
                years = [start + month / 12 for month in range(len(balances))]
                balance_axes.plot(years, [value / 1000 for value in balances], color=color, linestyle=dash, label=label)
            today_year = start + plan["paid_months"] / 12
            balance_axes.scatter(
                [today_year], [plan["balance_today"] / 1000], s=64, zorder=5,
                color=style["palette"][0], edgecolor=style["surface"], linewidth=2,
            )
            balance_axes.annotate(
                f"today {plan['balance_text']}", (today_year, plan["balance_today"] / 1000),
                xytext=(8, 6), textcoords="offset points", fontsize=8.5, color=style["ink"],
            )
            balance_axes.set_title("Remaining balance")
            balance_axes.yaxis.set_major_formatter(lambda value, _: f"${value:,.0f}k")
            balance_axes.set_ylim(bottom=0)
            balance_axes.legend(loc="upper right")

            accelerated = plan["accelerated"]
            labels = [str(int(start) + year) for year in range(len(accelerated["interest_by_year"]))]
            split_axes.bar(labels, [value / 1000 for value in accelerated["principal_by_year"]], color=style["palette"][0], label="Principal", width=0.8)
            split_axes.bar(
                labels, [value / 1000 for value in accelerated["interest_by_year"]],
                bottom=[value / 1000 for value in accelerated["principal_by_year"]],
                color=style["palette"][1], label="Interest", width=0.8,
            )
            split_axes.set_title("Where each year's payments go")
            split_axes.yaxis.set_major_formatter(lambda value, _: f"${value:,.0f}k")
            split_axes.set_xticks(labels[::5])
            split_axes.grid(axis="x", visible=False)
            yearly_total = max(map(sum, zip(accelerated["principal_by_year"], accelerated["interest_by_year"])))
            split_axes.set_ylim(0, yearly_total / 1000 * 1.22)
            split_axes.legend(loc="upper left", ncol=2)
            figure.tight_layout()
        plt.close(figure)
        return figure

    other_debts = cell(
        "A7",
        field({"Car loan": 9400, "Student loan": 7800, "Credit card": 1150}),
        label="other_debts",
    )

    @cell("B7", label="household_summary")
    @computed
    def household_summary(self):
        from datetime import date, timedelta

        today = date.today()
        tasks = []
        for task, every_days, last_done in self.maintenance():
            due = date.fromisoformat(last_done) + timedelta(days=every_days)
            tasks.append({"task": task, "due": due.isoformat(), "days": (due - today).days})
        tasks.sort(key=lambda item: item["days"])
        bill_rows = self.bills()
        upcoming = sorted(bill_rows, key=lambda bill: (bill[3] - today.day) % 31)
        manual = [bill for bill in bill_rows if not bill[4]]
        usage = self.utility_usage()
        return {
            "tasks": tasks,
            "overdue": sum(1 for item in tasks if item["days"] < 0),
            "due_soon": sum(1 for item in tasks if 0 <= item["days"] <= 14),
            "next_task": f"{tasks[0]['task']} ({'overdue ' + str(-tasks[0]['days']) + 'd' if tasks[0]['days'] < 0 else 'in ' + str(tasks[0]['days']) + 'd'})",
            "fixed_total": f"${sum(bill[2] for bill in bill_rows):,.0f}",
            "manual_total": f"${sum(bill[2] for bill in manual):,.0f}",
            "manual_names": ", ".join(bill[0] for bill in manual) or "none",
            "next_bill": f"{upcoming[0][0]} · ${upcoming[0][2]:,.0f} on day {upcoming[0][3]}",
            "then_bill": f"{upcoming[1][0]} · ${upcoming[1][2]:,.0f} on day {upcoming[1][3]}",
            "electricity": f"{usage['Electricity (kWh)'][-1]:,.0f} kWh ({usage['Electricity (kWh)'][-1] / usage['Electricity (kWh)'][-2] - 1:+.0%})",
            "water": f"{usage['Water (m³)'][-1]:.1f} m³ ({usage['Water (m³)'][-1] / usage['Water (m³)'][-2] - 1:+.0%})",
        }

    @cell("C7", label="health_chart")
    @computed
    def health_chart(self):
        import matplotlib.pyplot as plt
        import pandas as pd

        style = self.chart_style()
        frame = pd.DataFrame(self.health_log(), columns=["week", "weight", "resting_hr", "sleep", "steps", "workouts"])
        frame["week"] = pd.to_datetime(frame["week"]).dt.strftime("%d %b")
        ticks = list(frame["week"])[::3]
        with plt.rc_context(style["rc"]):
            figure, grid = plt.subplots(2, 2, figsize=(9.6, 5.6))
            weight, sleep, steps, heart = grid[0][0], grid[0][1], grid[1][0], grid[1][1]

            weight.plot(frame["week"], frame["weight"], color=style["palette"][0], marker="o", markersize=5)
            weight.plot(frame["week"], frame["weight"].rolling(3, min_periods=1).mean(), color=style["palette"][0], alpha=0.35, linewidth=5)
            weight.axhline(self.weight_goal(), color=style["good"], linestyle=(0, (4, 3)), linewidth=1.2)
            weight.text(0, self.weight_goal(), f"goal {self.weight_goal():.0f} kg", va="bottom", fontsize=8, color=style["ink"])
            weight.set_ylim(self.weight_goal() - 1, frame["weight"].max() + 1)
            weight.set_title("Weight (kg) · line = 3-week trend")

            sleep_colors = [style["palette"][6] if value >= self.sleep_goal() else style["track"] for value in frame["sleep"]]
            step_colors = [style["palette"][2] if value >= self.step_goal() else style["track"] for value in frame["steps"]]

            sleep.bar(frame["week"], frame["sleep"], color=sleep_colors, width=0.62)
            sleep.axhline(self.sleep_goal(), color=style["ink"], linestyle=(0, (4, 3)), linewidth=1.2)
            sleep.set_ylim(5, 9)
            sleep.set_title(f"Sleep (h/night) · goal {self.sleep_goal():g} h")

            steps.bar(frame["week"], frame["steps"], color=step_colors, width=0.62)
            steps.axhline(self.step_goal(), color=style["ink"], linestyle=(0, (4, 3)), linewidth=1.2)
            steps.yaxis.set_major_formatter(lambda value, _: f"{value / 1000:.0f}k")
            steps.set_title(f"Steps per day · goal {self.step_goal():,}")

            heart.plot(frame["week"], frame["resting_hr"], color=style["palette"][7], marker="o", markersize=5)
            heart.set_title("Resting heart rate (bpm)")

            for axes in (weight, sleep, steps, heart):
                axes.set_xticks(ticks)
                axes.grid(axis="x", visible=False)
            figure.tight_layout(h_pad=2)
        plt.close(figure)
        return figure

    savings_goals = cell(
        "A8",
        field(
            [("Emergency fund", 18000, 14200), ("Japan trip", 6500, 4100), ("Kitchen renovation", 12000, 3600), ("New laptop", 2400, 2100)]
        ),
        label="savings_goals",
    )

    @cell("B8", label="life_snapshot")
    @computed
    def life_snapshot(self):
        finance = self.finance_summary()
        health = self.health_summary()
        house = self.household_summary()
        return {
            "money": finance["status"],
            "health": "✅ Trending well" if health["sleep_status"] == "✅" and health["steps_status"] == "✅" else "⚠️ Needs attention",
            "home": f"⚠️ {house['overdue']} overdue task(s)" if house["overdue"] else "✅ All caught up",
            "mortgage": f"✅ {self.mortgage_plan()['progress']} paid off",
        }

    @cell("C8", label="household_chart")
    @computed
    def household_chart(self):
        import matplotlib.pyplot as plt

        style = self.chart_style()
        tasks = self.household_summary()["tasks"]
        bill_rows = self.bills()
        with plt.rc_context(style["rc"]):
            figure, (task_axes, bill_axes) = plt.subplots(
                1, 2, figsize=(9.6, 3.6), gridspec_kw={"width_ratios": [1.3, 1]}
            )
            ordered = tasks[::-1]
            days = [item["days"] for item in ordered]
            colors = [
                style["critical"] if value < 0 else style["warning"] if value <= 14 else style["good"]
                for value in days
            ]
            bars = task_axes.barh([item["task"] for item in ordered], days, color=colors, height=0.6)
            task_axes.bar_label(
                bars,
                labels=[f"overdue {-value}d" if value < 0 else f"in {value}d" for value in days],
                padding=4, fontsize=8, color=style["ink"],
            )
            task_axes.axvline(0, color=style["ink"], linewidth=1)
            span = max(abs(value) for value in days)
            task_axes.set_xlim(min(0, min(days)) - span * 0.35, max(days) + span * 0.35)
            task_axes.set_title("Maintenance · days until due")
            task_axes.grid(axis="y", visible=False)

            totals = {}
            for bill in bill_rows:
                totals[bill[1]] = totals.get(bill[1], 0) + bill[2]
            ranked = sorted(
                (value, name, style["palette"][slot % len(style["palette"])])
                for slot, (name, value) in enumerate(totals.items())
            )
            bill_bars = bill_axes.barh(
                [item[1] for item in ranked], [item[0] for item in ranked],
                color=[item[2] for item in ranked], height=0.6,
            )
            bill_axes.bar_label(bill_bars, labels=[f"${item[0]:,.0f}" for item in ranked], padding=4, fontsize=8.5, color=style["ink"])
            bill_axes.set_xlim(0, ranked[-1][0] * 1.3)
            bill_axes.set_xticks([])
            bill_axes.grid(False)
            bill_axes.set_title("Fixed bills per month")
            figure.tight_layout()
        plt.close(figure)
        return figure

    # ── Home & mortgage ──────────────────────────────────────────────────
    home_value = cell(
        "A9", field(548000), label="home_value", view={"widget": {"type": "number"}}
    )

    @cell("C9", label="utilities_chart")
    @computed
    def utilities_chart(self):
        import matplotlib.pyplot as plt

        style = self.chart_style()
        usage = self.utility_usage()
        months = [row["month"] for row in self.cashflow()]
        with plt.rc_context(style["rc"]):
            figure, panels = plt.subplots(1, len(usage), figsize=(9.6, 2.6), sharex=True)
            for slot, (axes, (name, values)) in enumerate(zip(panels, usage.items())):
                color = style["palette"][[3, 1, 0][slot % 3]]
                axes.fill_between(months[: len(values)], values, color=color, alpha=0.15, linewidth=0)
                axes.plot(months[: len(values)], values, color=color, marker="o", markersize=4)
                axes.set_title(name)
                axes.set_ylim(bottom=0)
                axes.set_xticks(months[: len(values)][::2])
                axes.grid(axis="x", visible=False)
            figure.tight_layout()
        plt.close(figure)
        return figure

    loan_amount = cell("A10", field(416000), label="loan_amount")

    mortgage_rate = cell(
        "A11",
        field(0.0425),
        label="mortgage_rate",
        view={"widget": {"type": "range", "min": 0.02, "max": 0.08, "step": 0.0025}},
    )

    loan_years = cell(
        "A12",
        field(30),
        label="loan_years",
        view={"widget": {"type": "range", "min": 10, "max": 30, "step": 5}},
    )

    loan_start = cell("A13", field("2021-06"), label="loan_start")

    extra_payment = cell(
        "A14",
        field(250),
        label="extra_payment",
        view={"widget": {"type": "range", "min": 0, "max": 2000, "step": 50}},
    )

    # ── Health: one row per week (start, kg, resting bpm, sleep h, steps/day, workouts)
    health_log = cell(
        "A15",
        field(
            [("2026-07-06", 84.2, 64, 6.6, 7100, 2), ("2026-07-13", 83.9, 63, 6.9, 7800, 3), ("2026-07-20", 83.8, 64, 6.4, 6900, 2), ("2026-07-27", 83.1, 62, 7.1, 8400, 3), ("2026-08-03", 82.9, 62, 7.3, 8800, 4), ("2026-08-10", 82.6, 61, 7.0, 9300, 3), ("2026-08-17", 82.8, 62, 6.8, 7600, 2), ("2026-08-24", 82.1, 60, 7.4, 9700, 4), ("2026-08-31", 81.7, 60, 7.6, 10200, 4), ("2026-09-07", 81.5, 59, 7.2, 9400, 3), ("2026-09-14", 81.2, 59, 7.7, 10600, 4), ("2026-09-21", 80.9, 58, 7.5, 9900, 4)]
        ),
        label="health_log",
    )

    weight_goal = cell(
        "A16", field(78.0), label="weight_goal", view={"widget": {"type": "number"}}
    )

    step_goal = cell(
        "A17",
        field(9000),
        label="step_goal",
        view={"widget": {"type": "range", "min": 4000, "max": 15000, "step": 500}},
    )

    sleep_goal = cell(
        "A18",
        field(7.5),
        label="sleep_goal",
        view={"widget": {"type": "range", "min": 6, "max": 9, "step": 0.25}},
    )

    # ── Household: recurring bills, maintenance, and utility meter readings
    bills = cell(
        "A19",
        field(
            [("Mortgage", "Housing", 2046, 1, True), ("Home insurance", "Housing", 118, 5, True), ("Electricity", "Utilities", 96, 12, True), ("Gas", "Utilities", 48, 12, True), ("Water", "Utilities", 36, 20, False), ("Internet", "Utilities", 55, 18, True), ("Phone plan", "Subscriptions", 42, 22, True), ("Streaming bundle", "Subscriptions", 24, 8, True), ("Gym", "Health", 49, 1, True), ("Car insurance", "Transport", 104, 15, False)]
        ),
        label="bills",
    )

    maintenance = cell(
        "A20",
        field(
            [("Replace HVAC filter", 90, "2026-06-20"), ("Test smoke alarms", 180, "2026-04-02"), ("Clean gutters", 180, "2026-05-10"), ("Service the car", 365, "2025-11-15"), ("Descale coffee machine", 60, "2026-08-30"), ("Flush water heater", 365, "2026-01-12"), ("Deep-clean fridge", 120, "2026-07-01")]
        ),
        label="maintenance",
    )

    utility_usage = cell(
        "A21",
        field(
            {"Electricity (kWh)": [520, 468, 431, 372, 338, 395, 482, 501, 404], "Gas (m³)": [148, 131, 102, 64, 38, 22, 18, 20, 34], "Water (m³)": [9.8, 9.1, 9.6, 10.2, 11.4, 13.8, 15.1, 14.6, 11.9]}
        ),
        label="utility_usage",
    )

    # ── Shared chart theme: change colours once, every plot follows ──────
    chart_style = cell(
        "A22",
        field(
            {"palette": ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"], "good": "#0ca30c", "warning": "#fab219", "critical": "#d03b3b", "ink": "#0b0b0b", "muted": "#898781", "track": "#e1e0d9", "surface": "#fcfcfb", "rc": {"figure.facecolor": "#fcfcfb", "axes.facecolor": "#fcfcfb", "savefig.facecolor": "#fcfcfb", "axes.edgecolor": "#c3c2b7", "axes.labelcolor": "#52514e", "axes.titlecolor": "#0b0b0b", "axes.titleweight": "bold", "axes.titlesize": 11, "axes.titlelocation": "left", "axes.titlepad": 10, "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "axes.axisbelow": True, "grid.color": "#e1e0d9", "grid.linewidth": 0.8, "xtick.color": "#898781", "ytick.color": "#898781", "xtick.major.size": 0, "ytick.major.size": 0, "font.size": 9, "legend.frameon": False, "legend.fontsize": 8.5, "lines.linewidth": 2, "text.parse_math": False}}
        ),
        label="chart_style",
    )


@workbook_config({"formatVersion": 2, "name": "Personal life dashboard"})
class PersonalLifeDashboardWorkbook(Workbook):
    Sheet1 = worksheet(
        Sheet1Worksheet,
        grid={"columns": 8, "rows": 24},
        layout={"columnWidths": {"A": 220, "B": 220, "C": 360, "E": 460}, "zoom": 0.9},
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
