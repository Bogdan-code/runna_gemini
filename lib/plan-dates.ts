const DAYS_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type PlanDay = { id: string; day: string; type: string };
type PlanWeek = { weekNumber: number; days: PlanDay[] };
type Plan = { startDate?: string; createdAt?: string; weeks?: PlanWeek[] };

function mondayOf(isoDate: string) {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d;
}

// Maps each scheduled (non-rest) workout to its calendar date (YYYY-MM-DD).
export function workoutsByDate(plan: Plan | null | undefined): Map<string, PlanDay> {
  const map = new Map<string, PlanDay>();
  if (!plan?.weeks) return map;
  const startSource = plan.startDate || plan.createdAt;
  if (!startSource) return map;
  const start = mondayOf(startSource);

  for (const week of plan.weeks) {
    for (const day of week.days) {
      if (day.type === "rest") continue;
      const idx = DAYS_ORDER.indexOf(day.day);
      if (idx < 0) continue;
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + (week.weekNumber - 1) * 7 + idx);
      map.set(d.toISOString().slice(0, 10), day);
    }
  }
  return map;
}
