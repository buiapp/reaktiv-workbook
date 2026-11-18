# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
#   "pandas",
#   "plotly",
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


class ProfileWorksheet(Worksheet["CalorieCoachWorkbook"]):
    # your first name (used in the notes)
    person_name = cell(
        "A1", field('Alex'), label="person_name", view={"widget": {"type": "text"}}
    )

    @cell("B1", label="kcal")
    @computed
    def kcal(self):
        def kcal(value):
            """Calories for people: rounded to 10, with a thousands separator."""
            return f"{round(value / 10) * 10:,.0f} kcal"

        return kcal

    @cell("D1", label="overview")
    @markdown
    def overview(self):
        return """# Your calorie plan

        {{ self.person_name() }}, to **{{ self.goal().lower() }}** you eat about **{{ self.kcal()(self.workbook.Plan.target_calories()) }} a day**:
        **{{ self.workbook.Nutrition.protein_g() }} g protein**, **{{ self.workbook.Nutrition.fat_g() }} g fat** and **{{ self.workbook.Nutrition.carbs_g() }} g carbohydrates**.
        Your body uses about **{{ self.kcal()(self.workbook.Energy.tdee()) }}** a day, so this is a daily
        **{{ 'deficit' if self.workbook.Plan.daily_adjustment() < 0 else 'surplus' if self.workbook.Plan.daily_adjustment() > 0 else 'balance' }}**
        of {{ self.kcal()(abs(self.workbook.Plan.target_calories() - self.workbook.Energy.tdee())) }}.

        | Your plan | |
        | --- | --- |
        | Goal | {{ self.goal() }} · {{ self.pace().lower() }} pace |
        | Expected change | {{ f'{self.workbook.Plan.expected_weekly_kg():+.2f}' }} kg per week |
        | Reaching {{ self.target_weight_kg() }} kg | {{ self.workbook.Plan.goal_reached_text() }} |
        | BMI now | {{ self.workbook.Energy.bmi() }} ({{ self.workbook.Energy.bmi_category() }}) |
        | Waist-to-height | {{ self.workbook.Energy.waist_to_height() }} ({{ self.workbook.Energy.waist_risk() }}) |

        > {{ self.workbook.Plan.safety_text() }}

        ## About you

        Change anything; every number in all notes follows.

        [Name: {{ self.person_name() }}](#sheet-input:person_name?type=text)

        [Sex: {{ self.sex() }}](#sheet-input:sex?type=select&options=Female,Male)

        [Age: {{ self.age() }}](#sheet-input:age?type=range&min=16&max=90&step=1)

        [Height (cm): {{ self.height_cm() }}](#sheet-input:height_cm?type=range&min=140&max=210&step=1)

        [Weight (kg): {{ self.weight_kg() }}](#sheet-input:weight_kg?type=range&min=40&max=200&step=0.5)

        [Body fat % (0 = unknown): {{ self.body_fat_percent() }}](#sheet-input:body_fat_percent?type=range&min=0&max=60&step=1)

        [Waist (cm): {{ self.waist_cm() }}](#sheet-input:waist_cm?type=range&min=50&max=160&step=1)

        ## Your day and your training

        [Daily life: {{ self.lifestyle() }}](#sheet-input:lifestyle?type=select&options=Desk%20job,Mostly%20standing,On%20my%20feet,Physical%20job,Heavy%20labour)

        [Workouts per week: {{ self.workouts_per_week() }}](#sheet-input:workouts_per_week?type=range&min=0&max=14&step=1)

        [Minutes per workout: {{ self.workout_minutes() }}](#sheet-input:workout_minutes?type=range&min=0&max=180&step=5)

        [Training: {{ self.training() }}](#sheet-input:training?type=select&options=None,Strength,Endurance,Mixed)

        ## Your goal

        [Goal: {{ self.goal() }}](#sheet-input:goal?type=select&options=Lose%20fat,Maintain,Build%20muscle)

        [Goal weight (kg): {{ self.target_weight_kg() }}](#sheet-input:target_weight_kg?type=range&min=40&max=200&step=0.5)

        [Pace: {{ self.pace() }}](#sheet-input:pace?type=select&options=Gentle,Moderate,Aggressive)

        [Start: {{ self.start_date() }}](#sheet-input:start_date?type=date)

        [Meals per day: {{ self.meals_per_day() }}](#sheet-input:meals_per_day?type=range&min=2&max=6&step=1)

        [Eating style: {{ self.diet_style() }}](#sheet-input:diet_style?type=select&options=Balanced,Higher%20protein,Lower%20carb,Higher%20carb)

        ---

        **Read on:** [Where your calories go](#note-energy_note) · [Your goal plan](#note-plan_note) ·
        [Protein, carbs and fat](#note-nutrition_note) · [Weekly check-in](#note-checkin_note) ·
        [The coach's playbook](#note-playbook_note)

        > These are estimates for healthy adults. Pregnant or breastfeeding, under 18, living with
        > diabetes, kidney disease, or a history of eating disorders? Plan with your doctor or a
        > registered dietitian."""

    # sex assigned at birth (the BMR formulas differ)
    sex = cell(
        "A2",
        field('Female'),
        label="sex",
        view={"widget": {"type": "select", "options": ["Female", "Male"]}},
    )

    @cell("B2", label="chart_layout")
    @computed
    def chart_layout(self):
        def chart_layout(title, **extra):
            """One look for every chart of the coach."""
            return dict(
                title=dict(text=title, x=0, font=dict(size=15)),
                template='plotly_white',
                height=340,
                margin=dict(l=48, r=16, t=56, b=40),
                legend=dict(orientation='h', y=-0.2),
                **extra,
            )

        return chart_layout

    @cell("D2", label="playbook_note")
    @markdown
    def playbook_note(self):
        return """# The coach's playbook

        Numbers are the map; habits are the walking. What decides your result:

        ## 1. Consistency beats precision

        - Hit your calories within ±10 % on most days. A perfect Monday does not undo a weekend
          500 kcal over target every week.
        - Weigh yourself daily under the same conditions (morning, after the toilet, before
          breakfast) and **judge the weekly average**, not a single day. Water, salt, carbohydrates
          and hormones move single readings by 1–2 kg.
        - Change the plan only after **2–3 weeks** of data: see the [weekly check-in](#note-checkin_note).

        ## 2. Protein and strength training protect muscle

        - While losing weight, the body takes energy from fat *and* muscle. Enough protein
          ({{ self.workbook.Nutrition.protein_g() }} g a day for you) plus 2–4 strength sessions a week tell it to keep the
          muscle.
        - While gaining, a small surplus plus progressive training (more weight or reps over time)
          turns the extra energy into muscle rather than fat.

        ## 3. Move outside the gym

        Everyday movement (walking, standing, chores) varies by several hundred calories a day
        and quietly drops when you diet. Keep a step goal — 7,000–10,000 steps is a good range.

        ## 4. Sleep and stress

        Less than 7 hours of sleep raises appetite and cravings and makes you lose more muscle in
        a deficit. Treat sleep as part of the plan.

        ## 5. Plan for plateaus

        {{ self.workbook.Plan.plateau_advice() }}

        ## 6. Fat loss: breaks and the finish

        - After 8–12 weeks of dieting, a **diet break** of 1–2 weeks at maintenance
          ({{ self.kcal()(self.workbook.Energy.tdee()) }}) helps both mood and adherence; it does not undo progress.
        - When you reach your goal, raise calories step by step (about +100–150 kcal per week)
          until your weight is stable. That number is your new maintenance.

        ## 7. Muscle gain: be patient

        Realistic muscle gain is 0.5–1 kg a month in the first year of training and much less
        later. Gaining faster mostly adds fat — the pace options are capped for that reason.

        ## Red flags

        Stop and get advice if you feel dizzy or constantly cold, lose your period, sleep badly
        for weeks, or if food becomes a constant source of stress.

        ---

        [← Back to your plan](#note-overview)"""

    # age in years
    age = cell(
        "A3",
        field(34),
        label="age",
        view={"widget": {"type": "range", "min": 16, "max": 90, "step": 1}},
    )

    # height in cm
    height_cm = cell(
        "A4",
        field(170),
        label="height_cm",
        view={"widget": {"type": "range", "min": 140, "max": 210, "step": 1}},
    )

    # current weight in kg (a weekly average is best)
    weight_kg = cell(
        "A5",
        field(78.0),
        label="weight_kg",
        view={"widget": {"type": "range", "min": 40, "max": 200, "step": 0.5}},
    )

    # body fat in % if measured (0 = unknown)
    body_fat_percent = cell(
        "A6",
        field(0),
        label="body_fat_percent",
        view={"widget": {"type": "range", "min": 0, "max": 60, "step": 1}},
    )

    # waist circumference in cm, at the navel
    waist_cm = cell(
        "A7",
        field(86),
        label="waist_cm",
        view={"widget": {"type": "range", "min": 50, "max": 160, "step": 1}},
    )

    # daily life outside workouts
    lifestyle = cell(
        "A8",
        field('Desk job'),
        label="lifestyle",
        view={
            "widget": {
                "type": "select",
                "options": [
                    "Desk job",
                    "Mostly standing",
                    "On my feet",
                    "Physical job",
                    "Heavy labour",
                ],
            }
        },
    )

    # planned workouts per week
    workouts_per_week = cell(
        "A9",
        field(3),
        label="workouts_per_week",
        view={"widget": {"type": "range", "min": 0, "max": 14, "step": 1}},
    )

    # minutes per workout
    workout_minutes = cell(
        "A10",
        field(45),
        label="workout_minutes",
        view={"widget": {"type": "range", "min": 0, "max": 180, "step": 5}},
    )

    # main kind of training
    training = cell(
        "A11",
        field('Strength'),
        label="training",
        view={
            "widget": {
                "type": "select",
                "options": ["None", "Strength", "Endurance", "Mixed"],
            }
        },
    )

    # what you want to achieve
    goal = cell(
        "A12",
        field('Lose fat'),
        label="goal",
        view={
            "widget": {
                "type": "select",
                "options": ["Lose fat", "Maintain", "Build muscle"],
            }
        },
    )

    # goal weight in kg
    target_weight_kg = cell(
        "A13",
        field(70.0),
        label="target_weight_kg",
        view={"widget": {"type": "range", "min": 40, "max": 200, "step": 0.5}},
    )

    # how fast to go
    pace = cell(
        "A14",
        field('Moderate'),
        label="pace",
        view={
            "widget": {
                "type": "select",
                "options": ["Gentle", "Moderate", "Aggressive"],
            }
        },
    )

    # first day of the plan
    start_date = cell(
        "A15",
        field('2026-10-05'),
        label="start_date",
        view={"widget": {"type": "date"}},
    )

    # meals per day
    meals_per_day = cell(
        "A16",
        field(3),
        label="meals_per_day",
        view={"widget": {"type": "range", "min": 2, "max": 6, "step": 1}},
    )

    # how you like to eat
    diet_style = cell(
        "A17",
        field('Balanced'),
        label="diet_style",
        view={
            "widget": {
                "type": "select",
                "options": ["Balanced", "Higher protein", "Lower carb", "Higher carb"],
            }
        },
    )


class EnergyWorksheet(Worksheet["CalorieCoachWorkbook"]):
    # share of BMR used by daily life incl. digestion (physical activity level without workouts)
    lifestyle_factors = cell(
        "A1",
        field(
            {'Desk job': 1.2, 'Mostly standing': 1.35, 'On my feet': 1.5, 'Physical job': 1.65, 'Heavy labour': 1.8}
        ),
        label="lifestyle_factors",
    )

    @cell("B1", label="bmr_mifflin")
    @computed
    def bmr_mifflin(self):
        # Mifflin-St Jeor (1990): the most accurate general formula
        base = 10 * self.workbook.Profile.weight_kg() + 6.25 * self.workbook.Profile.height_cm() - 5 * self.workbook.Profile.age()
        return round(base + (5 if self.workbook.Profile.sex() == 'Male' else -161))

    @cell("C1", label="bmr_table", view={"display": "rendered", "span": [3, 5]})
    @computed
    def bmr_table(self):
        import pandas as pd
        rows = [
            ('Mifflin-St Jeor', self.bmr_mifflin(), 'Best general estimate (within ~10 % for most adults)'),
            ('Harris-Benedict (revised)', self.bmr_harris(), 'Older formula; tends to run a little high'),
            ('Katch-McArdle', self.bmr_katch() if self.bmr_katch() is not None else '—', 'Needs a measured body fat; best for lean, muscular people'),
        ]
        return pd.DataFrame(rows, columns=['Formula', 'BMR (kcal)', 'When to use'])

    @cell("F1", label="energy_note")
    @markdown
    def energy_note(self):
        return """# Where your calories go

        Your body uses about **{{ self.workbook.Profile.kcal()(self.tdee()) }} a day**. This is your *maintenance*: eat this much
        and your weight stays the same.

        {{ self.energy_chart() }}

        ## 1. Resting energy — {{ self.workbook.Profile.kcal()(self.bmr()) }}

        The **basal metabolic rate (BMR)** is what your body burns lying still all day: heart,
        brain, breathing, keeping warm. It is the largest part, about
        {{ round(100 * self.bmr() / self.tdee()) }} % for you. It depends on size, age, sex and above all on how much
        **lean mass** you carry (muscle and organs burn far more than fat).

        We use **{{ self.bmr_method() }}**:

        $$BMR = 10 \\cdot {{ self.workbook.Profile.weight_kg() }} + 6.25 \\cdot {{ self.workbook.Profile.height_cm() }} - 5 \\cdot {{ self.workbook.Profile.age() }} {{ '+ 5' if self.workbook.Profile.sex() == 'Male' else '- 161' }} \\approx {{ self.bmr_mifflin() }}\\ \\text{kcal}$$

        {{ self.bmr_table() }}

        Your lean mass is about **{{ self.lean_mass_kg() }} kg**{{ ' (from your measured body fat)' if self.workbook.Profile.body_fat_percent() > 0 else ' (estimated; measure body fat for a more personal number)' }}.

        ## 2. Everyday movement — {{ self.workbook.Profile.kcal()(self.movement_kcal()) }}

        Walking, standing, fidgeting, chores: **non-exercise activity** varies most between people
        and is the first thing to drop when you eat less. Your daily life (*{{ self.workbook.Profile.lifestyle().lower() }}*) multiplies the
        BMR by {{ self.lifestyle_factors()[self.workbook.Profile.lifestyle()] }}.

        ## 3. Digestion — {{ self.workbook.Profile.kcal()(self.tef_kcal()) }}

        Digesting food costs about 10 % of what you eat; protein costs the most (20–30 % of its
        calories), fat the least.

        ## 4. Workouts — {{ self.workbook.Profile.kcal()(self.exercise_kcal()) }} a day on average

        {{ self.workbook.Profile.workouts_per_week() }} × {{ self.workbook.Profile.workout_minutes() }} min of *{{ self.workbook.Profile.training().lower() }}* training a week. Workouts burn less
        than most people think — and fitness trackers usually overestimate them by 20–40 %, which is
        why this plan does not "eat back" tracker calories.

        ## Body measures

        | Measure | You | Healthy range |
        | --- | --- | --- |
        | BMI | {{ self.bmi() }} | 18.5–24.9 ({{ self.healthy_weight_range()[0] }}–{{ self.healthy_weight_range()[1] }} kg at your height) |
        | Waist-to-height | {{ self.waist_to_height() }} | below 0.5 |

        BMI ignores muscle: a trained person can be "overweight" and lean. The **waist-to-height
        ratio** is a better simple measure of the risky fat around the organs —
        yours means *{{ self.waist_risk() }}*.

        > All formulas are averages. Real maintenance can differ by ±10 % (±{{ round(self.tdee() * 0.1) }} kcal).
        > The [weekly check-in](#note-checkin_note) measures yours from your own weight data.

        ---

        **Previous:** [Your calorie plan](#note-overview) · **Next:** [Your goal plan](#note-plan_note)"""

    # MET values of an average session (1 MET = energy at rest)
    training_mets = cell(
        "A2",
        field({'None': 0.0, 'Strength': 5.0, 'Endurance': 7.5, 'Mixed': 6.0}),
        label="training_mets",
    )

    @cell("B2", label="bmr_harris")
    @computed
    def bmr_harris(self):
        # Harris-Benedict, revised by Roza & Shizgal (1984)
        if self.workbook.Profile.sex() == 'Male':
            value = 88.362 + 13.397 * self.workbook.Profile.weight_kg() + 4.799 * self.workbook.Profile.height_cm() - 5.677 * self.workbook.Profile.age()
        else:
            value = 447.593 + 9.247 * self.workbook.Profile.weight_kg() + 3.098 * self.workbook.Profile.height_cm() - 4.330 * self.workbook.Profile.age()
        return round(value)

    # share of calories used to digest food (thermic effect)
    tef_share = cell("A3", field(0.10), label="tef_share")

    @cell("B3", label="lean_mass_kg")
    @computed
    def lean_mass_kg(self):
        # lean body mass: measured body fat, else the Boer estimate from height and weight
        if self.workbook.Profile.body_fat_percent() > 0:
            value = self.workbook.Profile.weight_kg() * (1 - self.workbook.Profile.body_fat_percent() / 100)
        elif self.workbook.Profile.sex() == 'Male':
            value = 0.407 * self.workbook.Profile.weight_kg() + 0.267 * self.workbook.Profile.height_cm() - 19.2
        else:
            value = 0.252 * self.workbook.Profile.weight_kg() + 0.473 * self.workbook.Profile.height_cm() - 48.3
        return round(value, 1)

    @cell("B4", label="bmr_katch")
    @computed
    def bmr_katch(self):
        # Katch-McArdle uses lean mass; only meaningful with a measured body fat
        return round(370 + 21.6 * self.lean_mass_kg()) if self.workbook.Profile.body_fat_percent() > 0 else None

    @cell("B5", label="bmr")
    @computed
    def bmr(self):
        return self.bmr_katch() if self.bmr_katch() is not None else self.bmr_mifflin()

    @cell("B6", label="bmr_method")
    @computed
    def bmr_method(self):
        return 'Katch-McArdle (from your body fat)' if self.bmr_katch() is not None else 'Mifflin-St Jeor'

    @cell("C6", label="energy_chart", view={"display": "rendered", "span": [3, 8]})
    @computed
    def energy_chart(self):
        import plotly.graph_objects as go
        parts = {
            'Resting (BMR)': self.bmr(),
            'Everyday movement': self.movement_kcal(),
            'Digestion': self.tef_kcal(),
            'Workouts': self.exercise_kcal(),
        }
        figure = go.Figure(go.Bar(
            x=list(parts.values()), y=list(parts.keys()), orientation='h',
            marker_color=['#4b86d1', '#36a269', '#f5a623', '#8a63d2'],
            text=[f'{value:,} kcal' for value in parts.values()], textposition='auto',
        ))
        figure.update_layout(**self.workbook.Profile.chart_layout()(f'Your {self.workbook.Profile.kcal()(self.tdee())} a day', xaxis_title='kcal per day'))
        figure.update_yaxes(autorange='reversed')
        return figure

    @cell("B7", label="exercise_kcal")
    @computed
    def exercise_kcal(self):
        # workout energy per day, net of what you would burn at rest anyway
        met = self.training_mets()[self.workbook.Profile.training()]
        hours_per_week = self.workbook.Profile.workouts_per_week() * self.workbook.Profile.workout_minutes() / 60
        return round(max(met - 1, 0) * self.workbook.Profile.weight_kg() * hours_per_week / 7)

    @cell("B8", label="tdee")
    @computed
    def tdee(self):
        return round(self.bmr() * self.lifestyle_factors()[self.workbook.Profile.lifestyle()] + self.exercise_kcal())

    @cell("B9", label="tef_kcal")
    @computed
    def tef_kcal(self):
        return round(self.tef_share() * self.tdee())

    @cell("B10", label="movement_kcal")
    @computed
    def movement_kcal(self):
        return round(self.bmr() * self.lifestyle_factors()[self.workbook.Profile.lifestyle()] - self.bmr() - self.tef_kcal())

    @cell("B11", label="bmi")
    @computed
    def bmi(self):
        return round(self.workbook.Profile.weight_kg() / (self.workbook.Profile.height_cm() / 100) ** 2, 1)

    @cell("B12", label="bmi_category")
    @computed
    def bmi_category(self):
        if self.bmi() < 18.5:
            category = 'underweight'
        elif self.bmi() < 25:
            category = 'healthy range'
        elif self.bmi() < 30:
            category = 'overweight'
        else:
            category = 'obesity'
        return category

    @cell("B13", label="healthy_weight_range")
    @computed
    def healthy_weight_range(self):
        # BMI 18.5-24.9 at your height
        metres = self.workbook.Profile.height_cm() / 100
        return (round(18.5 * metres ** 2, 1), round(24.9 * metres ** 2, 1))

    @cell("B14", label="waist_to_height")
    @computed
    def waist_to_height(self):
        return round(self.workbook.Profile.waist_cm() / self.workbook.Profile.height_cm(), 2)

    @cell("B15", label="waist_risk")
    @computed
    def waist_risk(self):
        # waist-to-height ratio: keep your waist below half your height
        return 'low risk' if self.waist_to_height() < 0.5 else 'increased risk' if self.waist_to_height() < 0.6 else 'high risk'


class PlanWorksheet(Worksheet["CalorieCoachWorkbook"]):
    # weekly change in % of body weight for each goal and pace
    pace_rates = cell(
        "A1",
        field(
            {
        'Lose fat': {'Gentle': -0.25, 'Moderate': -0.5, 'Aggressive': -0.8},
        'Maintain': {'Gentle': 0.0, 'Moderate': 0.0, 'Aggressive': 0.0},
        'Build muscle': {'Gentle': 0.1, 'Moderate': 0.2, 'Aggressive': 0.3},
    }
        ),
        label="pace_rates",
    )

    @cell("B1", label="weekly_change_kg")
    @computed
    def weekly_change_kg(self):
        # kg per week; negative = losing
        return round(self.workbook.Profile.weight_kg() * self.pace_rates()[self.workbook.Profile.goal()][self.workbook.Profile.pace()] / 100, 2)

    @cell("C1", label="projection_chart", view={"display": "rendered", "span": [4, 8]})
    @computed
    def projection_chart(self):
        import plotly.graph_objects as go
        figure = go.Figure()
        figure.add_trace(go.Scatter(x=self.projection().date, y=self.projection().weight_kg, name='Expected weight', line=dict(color='#4b86d1', width=3)))
        if self.workbook.Profile.goal() != 'Maintain':
            figure.add_hline(y=self.workbook.Profile.target_weight_kg(), line_dash='dash', line_color='#36a269', annotation_text=f'Goal {self.workbook.Profile.target_weight_kg()} kg')
        low, high = self.workbook.Energy.healthy_weight_range()
        figure.add_hrect(y0=low, y1=high, fillcolor='#36a269', opacity=0.06, line_width=0)
        figure.update_layout(**self.workbook.Profile.chart_layout()('Expected weight', yaxis_title='kg'))
        return figure

    @cell("G1", label="plan_note")
    @markdown
    def plan_note(self):
        return """# Your goal plan

        **Goal:** {{ self.workbook.Profile.goal().lower() }} at a {{ self.workbook.Profile.pace().lower() }} pace, from {{ self.workbook.Profile.weight_kg() }} kg towards {{ self.workbook.Profile.target_weight_kg() }} kg.

        | Energy | per day |
        | --- | --- |
        | You burn (maintenance) | {{ self.workbook.Profile.kcal()(self.workbook.Energy.tdee()) }} |
        | {{ 'Deficit' if self.daily_adjustment() < 0 else 'Surplus' if self.daily_adjustment() > 0 else 'Change' }} | {{ self.workbook.Profile.kcal()(abs(self.daily_adjustment())) }} |
        | **You eat** | **{{ self.workbook.Profile.kcal()(self.target_calories()) }}** |

        > {{ self.safety_text() }}

        [Goal: {{ self.workbook.Profile.goal() }}](#sheet-input:goal?type=select&options=Lose%20fat,Maintain,Build%20muscle)

        [Pace: {{ self.workbook.Profile.pace() }}](#sheet-input:pace?type=select&options=Gentle,Moderate,Aggressive)

        [Goal weight (kg): {{ self.workbook.Profile.target_weight_kg() }}](#sheet-input:target_weight_kg?type=range&min=40&max=200&step=0.5)

        ## How fast is right?

        The pace is a share of your body weight per week, so it scales with you:

        | Goal | Gentle | Moderate | Aggressive |
        | --- | --- | --- | --- |
        | Lose fat | −0.25 % | −0.5 % | −0.8 % |
        | Build muscle | +0.1 % | +0.2 % | +0.3 % |

        For you that is **{{ f'{self.weekly_change_kg():+.2f}' }} kg a week** ({{ f'{self.weekly_change_kg() * 4.3:+.1f}' }} kg a month){{ f' — but the calorie floor limits you to about {self.expected_weekly_kg():+.2f} kg a week' if self.floor_applied() else '' }}. One kilogram of
        body weight holds roughly {{ f'{self.kcal_per_kg():,}' }} kcal, so the daily change is

        $$\\frac{ {{ self.weekly_change_kg() }} \\cdot {{ self.kcal_per_kg() }} }{7} \\approx {{ self.daily_adjustment() }}\\ \\text{kcal}$$

        - **Losing:** 0.5 % a week is the sweet spot for most people: noticeable progress, enough
          energy to train, little muscle loss. Go gentle when you are close to a healthy weight.
        - **Gaining:** muscle grows slowly. A small surplus keeps fat gain low; beginners can use
          the faster paces, experienced lifters the gentle one.
        - **Maintaining:** eat at maintenance and focus on training, sleep and food quality —
          you can still lose fat and gain muscle slowly ("recomposition").

        ## Timeline

        Reaching {{ self.workbook.Profile.target_weight_kg() }} kg: **{{ self.goal_reached_text() }}**.

        {{ self.projection_chart() }}

        The line bends: as you get lighter (or heavier), your maintenance changes, so the same
        intake has less (or more) effect. The table shows every fourth week:

        {{ self.projection_table() }}

        ## When progress stalls

        {{ self.plateau_advice() }}

        ---

        **Previous:** [Where your calories go](#note-energy_note) · **Next:** [Protein, carbs and fat](#note-nutrition_note)"""

    # energy in 1 kg of body weight change (mostly fat), in kcal
    kcal_per_kg = cell("A2", field(7700), label="kcal_per_kg")

    @cell("B2", label="daily_adjustment")
    @computed
    def daily_adjustment(self):
        return round(self.weekly_change_kg() * self.kcal_per_kg() / 7)

    # lowest daily intake without medical supervision
    calorie_floor = cell(
        "A3", field({'Female': 1200, 'Male': 1500}), label="calorie_floor"
    )

    @cell("B3", label="target_calories")
    @computed
    def target_calories(self):
        # what you burn, plus the surplus or minus the deficit, never below the floor
        raw = self.workbook.Energy.tdee() + self.daily_adjustment()
        return round(max(raw, self.calorie_floor()[self.workbook.Profile.sex()]) / 10) * 10

    # longest projection in weeks
    max_weeks = cell("A4", field(104), label="max_weeks")

    @cell("B4", label="floor_applied")
    @computed
    def floor_applied(self):
        return self.workbook.Energy.tdee() + self.daily_adjustment() < self.calorie_floor()[self.workbook.Profile.sex()]

    @cell("B5", label="tdee_for")
    @computed
    def tdee_for(self):
        def tdee_for(weight):
            """Maintenance at another body weight: BMR and workouts scale with weight."""
            lean = self.workbook.Energy.lean_mass_kg() + (weight - self.workbook.Profile.weight_kg()) * 0.25
            if self.workbook.Energy.bmr_katch() is not None:
                resting = 370 + 21.6 * lean
            else:
                resting = 10 * weight + 6.25 * self.workbook.Profile.height_cm() - 5 * self.workbook.Profile.age() + (5 if self.workbook.Profile.sex() == 'Male' else -161)
            workouts = self.workbook.Energy.exercise_kcal() * weight / self.workbook.Profile.weight_kg()
            return resting * self.workbook.Energy.lifestyle_factors()[self.workbook.Profile.lifestyle()] + workouts

        return tdee_for

    @cell("B6", label="projection")
    @computed
    def projection(self):
        # week by week at a fixed intake; maintenance follows the new weight
        import datetime as dt
        import pandas as pd
        start = dt.date.fromisoformat(self.workbook.Profile.start_date())
        weight = self.workbook.Profile.weight_kg()
        rows = []
        for week in range(self.max_weeks() + 1):
            burn = self.tdee_for()(weight)
            rows.append({
                'week': week,
                'date': (start + dt.timedelta(weeks=week)).isoformat(),
                'weight_kg': round(weight, 1),
                'maintenance_kcal': round(burn),
                'intake_kcal': self.target_calories(),
            })
            done = (self.workbook.Profile.goal() == 'Lose fat' and weight <= self.workbook.Profile.target_weight_kg()) or (self.workbook.Profile.goal() == 'Build muscle' and weight >= self.workbook.Profile.target_weight_kg())
            if done or (self.workbook.Profile.goal() == 'Maintain' and week >= 12):
                break
            weight += (self.target_calories() - burn) * 7 / self.kcal_per_kg()
        return pd.DataFrame(rows)

    @cell("B7", label="weeks_to_goal")
    @computed
    def weeks_to_goal(self):
        last = self.projection().iloc[-1]
        reached = (self.workbook.Profile.goal() == 'Lose fat' and last.weight_kg <= self.workbook.Profile.target_weight_kg()) or (self.workbook.Profile.goal() == 'Build muscle' and last.weight_kg >= self.workbook.Profile.target_weight_kg())
        return int(last.week) if reached else None

    @cell("B8", label="goal_reached_text")
    @computed
    def goal_reached_text(self):
        if self.workbook.Profile.goal() == 'Maintain':
            text = 'not needed: you maintain'
        elif self.goal_direction_problem():
            text = 'check your goal weight'
        elif self.weeks_to_goal() is None:
            text = f'not within {self.max_weeks()} weeks at this pace'
        else:
            date = self.projection().iloc[self.weeks_to_goal()].date
            text = f'in about {self.weeks_to_goal()} weeks ({date})'
        return text

    @cell("B9", label="goal_direction_problem")
    @computed
    def goal_direction_problem(self):
        return (self.workbook.Profile.goal() == 'Lose fat' and self.workbook.Profile.target_weight_kg() >= self.workbook.Profile.weight_kg()) or (self.workbook.Profile.goal() == 'Build muscle' and self.workbook.Profile.target_weight_kg() <= self.workbook.Profile.weight_kg())

    @cell("C9", label="projection_table", view={"display": "rendered", "span": [4, 8]})
    @computed
    def projection_table(self):
        return self.projection().iloc[::4][['date', 'weight_kg', 'maintenance_kcal', 'intake_kcal']].rename(columns={
            'date': 'Week of', 'weight_kg': 'Weight (kg)', 'maintenance_kcal': 'Maintenance', 'intake_kcal': 'You eat'}).reset_index(drop=True)

    @cell("B10", label="safety_text")
    @computed
    def safety_text(self):
        warnings = []
        if self.goal_direction_problem():
            warnings.append(f'Your goal weight ({self.workbook.Profile.target_weight_kg()} kg) does not match the goal "{self.workbook.Profile.goal()}" at {self.workbook.Profile.weight_kg()} kg: change the goal or the goal weight.')
        low, high = self.workbook.Energy.healthy_weight_range()
        if self.workbook.Profile.target_weight_kg() < low:
            warnings.append(f'{self.workbook.Profile.target_weight_kg()} kg is below the healthy range for your height ({low}–{high} kg). Consider a higher goal.')
        if self.floor_applied():
            warnings.append(f'The deficit would take you below {self.calorie_floor()[self.workbook.Profile.sex()]:,} kcal, so the plan stops there; progress will be slower than the pace says.')
        if self.workbook.Profile.goal() == 'Lose fat' and self.workbook.Profile.pace() == 'Aggressive' and self.workbook.Energy.bmi() < 25:
            warnings.append('An aggressive pace costs lean people muscle and energy. Moderate or gentle is better near a healthy weight.')
        if self.workbook.Profile.goal() == 'Build muscle' and self.workbook.Profile.training() not in ('Strength', 'Mixed'):
            warnings.append('A surplus without strength training mostly adds fat: add 2–4 strength sessions a week.')
        if self.workbook.Profile.goal() == 'Build muscle' and self.workbook.Profile.body_fat_percent() > (25 if self.workbook.Profile.sex() == 'Male' else 35):
            warnings.append('With this body fat, a slow fat loss with strength training ("recomposition") usually works better than a surplus.')
        if self.workbook.Profile.age() < 18:
            warnings.append('Under 18: growing bodies need more energy; plan with a doctor or dietitian.')
        # one line: notes show values as text
        return '  '.join(f'⚠️ {text}' for text in warnings) if warnings else '✅ The plan is within safe limits.'

    @cell("B11", label="plateau_advice")
    @computed
    def plateau_advice(self):
        if self.workbook.Profile.goal() == 'Lose fat':
            text = ('Weight loss always slows down: a lighter body burns less (the table shows your maintenance '
                    f'falling to about {self.projection().maintenance_kcal.iloc[-1]:,} kcal), and everyday movement drops. '
                    'If the weekly average has not moved for 3 weeks, first check portions and weekends, then add '
                    '2,000 steps a day, and only then eat 100–150 kcal less.')
        elif self.workbook.Profile.goal() == 'Build muscle':
            text = ('If the weekly average has not risen for 3 weeks, add 100–150 kcal a day. If it rises faster '
                    'than planned, remove 100 kcal: faster is mostly fat.')
        else:
            text = ('Maintenance moves ±2 kg naturally. Act only when the weekly average leaves that band: '
                    'then adjust by 100–150 kcal.')
        return text

    @cell("B12", label="expected_weekly_kg")
    @computed
    def expected_weekly_kg(self):
        # what the calories you actually eat do in the first weeks (differs from the pace at the floor)
        return round((self.target_calories() - self.workbook.Energy.tdee()) * 7 / self.kcal_per_kg(), 2)


class NutritionWorksheet(Worksheet["CalorieCoachWorkbook"]):
    # protein in g per kg of reference body weight for each goal
    protein_per_kg = cell(
        "A1",
        field({'Lose fat': 2.0, 'Maintain': 1.6, 'Build muscle': 1.8}),
        label="protein_per_kg",
    )

    @cell("B1", label="protein_reference_kg")
    @computed
    def protein_reference_kg(self):
        # protein follows the goal weight when overweight (BMI 27+), else the current weight
        return self.workbook.Profile.target_weight_kg() if self.workbook.Energy.bmi() >= 27 and self.workbook.Profile.target_weight_kg() < self.workbook.Profile.weight_kg() else self.workbook.Profile.weight_kg()

    @cell("C1", label="macro_table", view={"display": "rendered", "span": [3, 4]})
    @computed
    def macro_table(self):
        import pandas as pd
        rows = [('Protein', self.protein_g(), 4), ('Fat', self.fat_g(), 9), ('Carbohydrates', self.carbs_g(), 4)]
        total = sum(grams * per_gram for _, grams, per_gram in rows)
        return pd.DataFrame([
            {'Nutrient': name, 'Grams': grams, 'kcal': grams * per_gram,
             'Share': f'{100 * grams * per_gram / total:.0f} %', 'Per kg body weight': round(grams / self.workbook.Profile.weight_kg(), 1)}
            for name, grams, per_gram in rows
        ])

    @cell("F1", label="nutrition_note")
    @markdown
    def nutrition_note(self):
        return """# Protein, carbs and fat

        **{{ self.workbook.Profile.kcal()(self.workbook.Plan.target_calories()) }} a day** split into:

        {{ self.macro_table() }}

        {{ self.macro_chart() }}

        [Eating style: {{ self.workbook.Profile.diet_style() }}](#sheet-input:diet_style?type=select&options=Balanced,Higher%20protein,Lower%20carb,Higher%20carb)

        [Meals per day: {{ self.workbook.Profile.meals_per_day() }}](#sheet-input:meals_per_day?type=range&min=2&max=6&step=1)

        ## Protein first — {{ self.protein_g() }} g

        Protein builds and keeps muscle, keeps you full longest, and costs the most energy to
        digest. You get {{ self.protein_per_kg()[self.workbook.Profile.goal()] }} g per kg{{ ' (+' + str(self.diet_styles()[self.workbook.Profile.diet_style()]['extra_protein']) + ' for your eating style)' if self.diet_styles()[self.workbook.Profile.diet_style()]['extra_protein'] else '' }}
        of **{{ self.protein_reference_kg() }} kg**{{ ' — your goal weight, because protein needs follow lean mass, not fat' if self.protein_reference_kg() != self.workbook.Profile.weight_kg() else '' }}.

        Spread it out: about **{{ self.protein_per_meal() }} g per meal** over {{ self.workbook.Profile.meals_per_day() }} meals. Good sources: poultry,
        fish, eggs, low-fat dairy (skyr, quark, cottage cheese), tofu, tempeh, lentils, beans.

        ## Fat — {{ self.fat_g() }} g

        Fat is needed for hormones and the vitamins A, D, E and K; never go below about 0.6 g per kg
        ({{ round(0.6 * self.workbook.Profile.weight_kg()) }} g for you). Prefer olive oil, nuts, seeds, avocado and fatty fish; it is the
        densest nutrient (9 kcal per gram), so measure oils.

        ## Carbohydrates — {{ self.carbs_g() }} g

        Carbohydrates fuel training and the brain. They fill the rest of your calories: more on
        training days is fine. Choose mostly whole grains, potatoes, legumes, fruit and vegetables.

        ## Fibre and water

        - **Fibre: {{ self.fiber_g() }} g a day** (14 g per 1,000 kcal) — for fullness, digestion and blood sugar.
        - **Water: about {{ self.water_l() }} litres a day**, more in heat. Pale yellow urine is a good guide.

        ## Your meals

        {{ self.meal_split() }}

        ## A sample day

        Not a diet to follow strictly — a picture of what {{ self.workbook.Profile.kcal()(self.workbook.Plan.target_calories()) }} can look like. Swap foods
        freely within the same group (chicken ↔ tofu ↔ fish, rice ↔ potatoes ↔ pasta).

        {{ self.sample_day() }}

        This day has about **{{ self.sample_day_protein() }} g protein**{{ '; add a protein portion (a shake, 250 g skyr, or 150 g chicken) to reach your target' if self.sample_day_protein() < self.protein_g() - 15 else '' }}.

        ## The 80/20 rule

        Fill about 80 % of your calories with whole, minimally processed food; the rest can be what you
        enjoy. A plan you can keep for months beats a perfect one you quit after two weeks.

        ---

        **Previous:** [Your goal plan](#note-plan_note) · **Next:** [Weekly check-in](#note-checkin_note)"""

    # share of calories from fat and extra protein (g/kg) for each eating style
    diet_styles = cell(
        "A2",
        field(
            {
        'Balanced': {'fat': 0.30, 'extra_protein': 0.0},
        'Higher protein': {'fat': 0.28, 'extra_protein': 0.4},
        'Lower carb': {'fat': 0.40, 'extra_protein': 0.2},
        'Higher carb': {'fat': 0.22, 'extra_protein': 0.0},
    }
        ),
        label="diet_styles",
    )

    @cell("B2", label="protein_g")
    @computed
    def protein_g(self):
        grams_per_kg = self.protein_per_kg()[self.workbook.Profile.goal()] + self.diet_styles()[self.workbook.Profile.diet_style()]['extra_protein']
        return round(grams_per_kg * self.protein_reference_kg())

    # a sample day (about 2,100 kcal, scaled to your target): meal, food, grams, kcal and protein per 100 g
    sample_day_foods = cell(
        "A3",
        field(
            [
        {'meal': 'Breakfast', 'food': 'Oats', 'grams': 60, 'kcal_100g': 372, 'protein_100g': 13.5},
        {'meal': 'Breakfast', 'food': 'Skyr / Greek yogurt (0 %)', 'grams': 250, 'kcal_100g': 63, 'protein_100g': 11.0},
        {'meal': 'Breakfast', 'food': 'Berries', 'grams': 100, 'kcal_100g': 45, 'protein_100g': 1.0},
        {'meal': 'Lunch', 'food': 'Chicken breast (or tofu)', 'grams': 180, 'kcal_100g': 120, 'protein_100g': 23.0},
        {'meal': 'Lunch', 'food': 'Rice, cooked', 'grams': 180, 'kcal_100g': 130, 'protein_100g': 2.7},
        {'meal': 'Lunch', 'food': 'Vegetables', 'grams': 200, 'kcal_100g': 30, 'protein_100g': 2.0},
        {'meal': 'Lunch', 'food': 'Olive oil', 'grams': 10, 'kcal_100g': 884, 'protein_100g': 0.0},
        {'meal': 'Snack', 'food': 'Apple', 'grams': 150, 'kcal_100g': 52, 'protein_100g': 0.3},
        {'meal': 'Snack', 'food': 'Almonds', 'grams': 20, 'kcal_100g': 579, 'protein_100g': 21.0},
        {'meal': 'Snack', 'food': 'Cottage cheese', 'grams': 200, 'kcal_100g': 98, 'protein_100g': 11.0},
        {'meal': 'Dinner', 'food': 'Salmon (or lentils)', 'grams': 140, 'kcal_100g': 208, 'protein_100g': 20.0},
        {'meal': 'Dinner', 'food': 'Potatoes', 'grams': 250, 'kcal_100g': 77, 'protein_100g': 2.0},
        {'meal': 'Dinner', 'food': 'Salad with dressing', 'grams': 150, 'kcal_100g': 60, 'protein_100g': 1.5},
    ]
        ),
        label="sample_day_foods",
    )

    @cell("B3", label="fat_g")
    @computed
    def fat_g(self):
        # at least 0.6 g per kg for hormones and vitamin absorption
        share = self.diet_styles()[self.workbook.Profile.diet_style()]['fat']
        return round(max(share * self.workbook.Plan.target_calories() / 9, 0.6 * self.workbook.Profile.weight_kg()))

    @cell("B4", label="carbs_g")
    @computed
    def carbs_g(self):
        return max(round((self.workbook.Plan.target_calories() - 4 * self.protein_g() - 9 * self.fat_g()) / 4), 0)

    @cell("B5", label="fiber_g")
    @computed
    def fiber_g(self):
        return round(14 * self.workbook.Plan.target_calories() / 1000)

    @cell("C5", label="macro_chart", view={"display": "rendered", "span": [3, 8]})
    @computed
    def macro_chart(self):
        import plotly.graph_objects as go
        figure = go.Figure(go.Pie(
            labels=list(self.macro_table().Nutrient), values=list(self.macro_table().kcal), hole=0.55,
            marker=dict(colors=['#8a63d2', '#f5a623', '#4b86d1']), sort=False,
        ))
        figure.update_layout(**self.workbook.Profile.chart_layout()('Where your calories come from'))
        return figure

    @cell("B6", label="water_l")
    @computed
    def water_l(self):
        # about 33 ml per kg, plus 0.5 l per hour of training (spread over the week)
        training_hours_per_day = self.workbook.Profile.workouts_per_week() * self.workbook.Profile.workout_minutes() / 60 / 7
        return round(0.033 * self.workbook.Profile.weight_kg() + 0.5 * training_hours_per_day, 1)

    @cell("B7", label="protein_per_meal")
    @computed
    def protein_per_meal(self):
        # 0.4 g/kg per meal maximises muscle building per meal
        return round(max(self.protein_g() / self.workbook.Profile.meals_per_day(), 0.4 * self.protein_reference_kg()))

    @cell("B8", label="sample_day_protein")
    @computed
    def sample_day_protein(self):
        return round(self.sample_day()['Protein (g)'].sum())

    @cell("C13", label="meal_split", view={"display": "rendered", "span": [3, 6]})
    @computed
    def meal_split(self):
        import pandas as pd
        # split evenly; with 4+ meals, one is a smaller snack
        weights = [1.0] * self.workbook.Profile.meals_per_day()
        if self.workbook.Profile.meals_per_day() >= 4:
            weights[-2] = 0.5
        total = sum(weights)
        names = ['Breakfast', 'Lunch', 'Dinner'] if self.workbook.Profile.meals_per_day() == 3 else [f'Meal {index + 1}' for index in range(self.workbook.Profile.meals_per_day())]
        return pd.DataFrame([
            {'Meal': names[index] if weight == 1.0 else f'{names[index]} (snack)',
             'kcal': round(self.workbook.Plan.target_calories() * weight / total / 10) * 10,
             'Protein (g)': round(self.protein_g() * weight / total),
             'Fat (g)': round(self.fat_g() * weight / total),
             'Carbs (g)': round(self.carbs_g() * weight / total)}
            for index, weight in enumerate(weights)
        ])

    @cell("C19", label="sample_day", view={"display": "rendered", "span": [4, 10]})
    @computed
    def sample_day(self):
        import pandas as pd
        # scale the sample day to your target
        base = sum(food['grams'] * food['kcal_100g'] / 100 for food in self.sample_day_foods())
        factor = self.workbook.Plan.target_calories() / base
        rows = [
            {'Meal': food['meal'], 'Food': food['food'], 'Grams': round(food['grams'] * factor / 5) * 5,
             'kcal': round(food['grams'] * factor * food['kcal_100g'] / 100),
             'Protein (g)': round(food['grams'] * factor * food['protein_100g'] / 100, 1)}
            for food in self.sample_day_foods()
        ]
        return pd.DataFrame(rows)


class CheckInWorksheet(Worksheet["CalorieCoachWorkbook"]):
    # weekly average weights in kg, oldest first (add one each week)
    weekly_weights = cell(
        "A1",
        field(['78.0', '77.5', '77.2', '76.8', '76.4']),
        label="weekly_weights",
        view={"widget": {"type": "list"}},
    )

    @cell("B1", label="weights")
    @computed
    def weights(self):
        return [float(value) for value in self.weekly_weights() if str(value).strip()]

    @cell("C1", label="checkin_chart", view={"display": "rendered", "span": [4, 8]})
    @computed
    def checkin_chart(self):
        import datetime as dt
        import plotly.graph_objects as go
        start = dt.date.fromisoformat(self.workbook.Profile.start_date())
        dates = [(start + dt.timedelta(weeks=week)).isoformat() for week in range(len(self.weights()))]
        planned = self.workbook.Plan.projection()[self.workbook.Plan.projection().week < max(len(self.weights()), 2)]
        figure = go.Figure()
        figure.add_trace(go.Scatter(x=planned.date, y=planned.weight_kg, name='Plan', line=dict(color='#9aa3ad', dash='dash')))
        figure.add_trace(go.Scatter(x=dates, y=self.weights(), name='Your weekly average', mode='lines+markers', line=dict(color='#4b86d1', width=3)))
        figure.update_layout(**self.workbook.Profile.chart_layout()('Plan and reality', yaxis_title='kg'))
        return figure

    @cell("G1", label="checkin_note")
    @markdown
    def checkin_note(self):
        return """# Weekly check-in

        Formulas estimate; your scale measures. Every week, enter your **average weight of the
        week** (from daily weigh-ins) and look at the trend, not single days.

        [Weekly averages: {{ self.weekly_weights() }}](#sheet-input:weekly_weights?type=list)

        [Average calories eaten per day: {{ self.logged_calories() }}](#sheet-input:logged_calories?type=range&min=800&max=5000&step=10)

        {{ self.checkin_chart() }}

        | Trend | |
        | --- | --- |
        | Planned change | {{ f'{self.workbook.Plan.expected_weekly_kg():+.2f}' }} kg per week |
        | Your trend | {{ '—' if self.observed_rate() is None else f'{self.observed_rate():+.2f} kg per week' }} |
        | Weeks of data | {{ len(self.weights()) }} |

        ## What to do now

        **{{ self.checkin_advice() }}**

        {{ 'New daily target from your data: **' + self.workbook.Profile.kcal()(self.adjusted_calories()) + '** (the plan said ' + self.workbook.Profile.kcal()(self.workbook.Plan.target_calories()) + ').' if abs(self.adjusted_calories() - self.workbook.Plan.target_calories()) >= 50 else 'Daily target stays at **' + self.workbook.Profile.kcal()(self.workbook.Plan.target_calories()) + '**.' }}

        ## Your real maintenance

        If you log your food honestly, the check-in can measure your maintenance:

        $$\\text{maintenance} = \\text{eaten} - \\text{trend} \\cdot \\frac{ {{ self.workbook.Plan.kcal_per_kg() }} }{7}$$

        {{ 'From your data: **' + self.workbook.Profile.kcal()(self.measured_tdee()) + "** a day, compared with the formula's " + self.workbook.Profile.kcal()(self.workbook.Energy.tdee()) + '. ' + ('Close — the formulas fit you well.' if abs(self.measured_tdee() - self.workbook.Energy.tdee()) <= 150 else 'Trust your data over the formula; set your plan around it.') if self.measured_tdee() is not None else 'Enter at least two weeks to measure it.' }}

        ## Rules of a good check-in

        1. Weigh daily, same conditions, and use the **weekly average**.
        2. Judge after **3 weeks** at least; the first week of a diet drops water and glycogen.
        3. Change **one thing at a time** and by small steps (100–150 kcal or 2,000 steps).
        4. Also track waist, photos and strength: when you lift more and your waist shrinks, the
           plan works even if the scale is slow.

        ---

        **Previous:** [Protein, carbs and fat](#note-nutrition_note) · **Next:** [The coach's playbook](#note-playbook_note)"""

    # average calories you actually ate per day over these weeks (from your food log)
    logged_calories = cell(
        "A2",
        field(1500),
        label="logged_calories",
        view={"widget": {"type": "range", "min": 800, "max": 5000, "step": 10}},
    )

    @cell("B2", label="observed_rate")
    @computed
    def observed_rate(self):
        # trend in kg per week: least-squares slope through all weekly averages
        count = len(self.weights())
        if count < 2:
            slope = None
        else:
            mean_x = (count - 1) / 2
            mean_y = sum(self.weights()) / count
            slope = sum((x - mean_x) * (y - mean_y) for x, y in enumerate(self.weights())) / sum((x - mean_x) ** 2 for x in range(count))
        return None if slope is None else round(slope, 2)

    @cell("B3", label="measured_tdee")
    @computed
    def measured_tdee(self):
        # your real maintenance: what you ate, corrected by how your weight moved
        return None if self.observed_rate() is None else round(self.logged_calories() - self.observed_rate() * self.workbook.Plan.kcal_per_kg() / 7)

    @cell("B4", label="adjusted_calories")
    @computed
    def adjusted_calories(self):
        # with 3+ weeks of data, the plan is rebuilt on your measured maintenance
        if self.measured_tdee() is None or len(self.weights()) < 3:
            value = self.workbook.Plan.target_calories()
        else:
            value = round(max(self.measured_tdee() + self.workbook.Plan.daily_adjustment(), self.workbook.Plan.calorie_floor()[self.workbook.Profile.sex()]) / 10) * 10
        return value

    @cell("B5", label="checkin_advice")
    @computed
    def checkin_advice(self):
        if self.observed_rate() is None:
            text = 'Enter at least two weekly averages.'
        elif len(self.weights()) < 3:
            text = 'Too early to judge: wait for three weeks of data.'
        else:
            gap = self.observed_rate() - self.workbook.Plan.expected_weekly_kg()
            if abs(gap) <= 0.1:
                text = 'On track: your trend matches the plan. Change nothing.'
            elif (self.workbook.Profile.goal() == 'Lose fat' and gap > 0) or (self.workbook.Profile.goal() == 'Build muscle' and gap < 0) or (self.workbook.Profile.goal() == 'Maintain' and self.observed_rate() > 0):
                text = ('Slower than planned' if self.workbook.Profile.goal() != 'Maintain' else 'You are gaining') + (
                    '. First check that your log is complete (oils, drinks, weekends, tasting while cooking): '
                    'missing entries make your measured maintenance look lower than it is.')
            else:
                text = ('Faster than planned' if self.workbook.Profile.goal() != 'Maintain' else 'You are losing') + (
                    '. Your body burns more than the formula assumed, so eat a little more to keep '
                    'muscle, energy and training quality.')
        return text


@workbook_config(
    {
        "formatVersion": 2,
        "name": "Calorie coach",
        "layout": {
            "noteOrder": [
                "D1",
                "Energy!F1",
                "Plan!G1",
                "Nutrition!F1",
                "CheckIn!G1",
                "D2",
            ]
        },
    }
)
class CalorieCoachWorkbook(Workbook):
    Profile = worksheet(
        ProfileWorksheet,
        grid={"columns": 6, "rows": 18},
        layout={"columnWidths": {"A": 200, "B": 200, "C": 220, "D": 260}},
    )
    Energy = worksheet(EnergyWorksheet, grid={"columns": 6, "rows": 16})
    Plan = worksheet(PlanWorksheet, grid={"columns": 7, "rows": 18})
    Nutrition = worksheet(NutritionWorksheet, grid={"columns": 6, "rows": 30})
    CheckIn = worksheet(CheckInWorksheet, grid={"columns": 7, "rows": 12})


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
