import { pool } from "../../db/pool.js";
import { getTripoliToday, TRIPOLI_TIME_ZONE } from "../../utils/date.js";

const statuses = {
  scheduled: "scheduled", arrived: "arrived", waiting: "waiting", inProgress: "in-progress",
  completed: "completed", noShow: "no-show", cancelled: "cancelled", discontinued: "discontinued", voided: "voided",
} as const;
type Counts = Record<keyof typeof statuses | "totalAppointments" | "inQueue" | "walkIn", number>;
type AggregateRow = Counts & {
  modalityId: string | null; code: string | null; nameEn: string | null; nameAr: string | null;
  oldestWaitingMinutes: number | null; over30Minutes: number; over60Minutes: number; unknownDurationCount: number;
};

// One aggregate query, no patient join and no queue cleanup. Like /statistics,
// totals include every persisted booking status, including voided records.
export const OPERATIONS_SUMMARY_SQL = `
  with today as (
    select b.modality_id, b.status, b.is_walk_in,
      case when b.status = 'waiting' and b.waiting_started_at is not null
        then greatest(0, extract(epoch from ($2::timestamptz - b.waiting_started_at)) / 60)
        else null end as waiting_minutes
    from appointments_v2.bookings b where b.booking_date = $1::date
  )
  select t.modality_id as "modalityId", m.code, m.name_en as "nameEn", m.name_ar as "nameAr",
    count(*)::int as "totalAppointments",
    ${Object.entries(statuses).map(([key, status]) => `count(*) filter (where t.status = '${status}')::int as "${key}"`).join(",\n    ")},
    count(*) filter (where t.status in ('arrived', 'waiting', 'in-progress'))::int as "inQueue",
    count(*) filter (where t.is_walk_in)::int as "walkIn",
    floor(max(t.waiting_minutes))::int as "oldestWaitingMinutes",
    count(*) filter (where t.waiting_minutes > 30)::int as "over30Minutes",
    count(*) filter (where t.waiting_minutes > 60)::int as "over60Minutes",
    count(*) filter (where t.status = 'waiting' and t.waiting_minutes is null)::int as "unknownDurationCount"
  from today t join modalities m on m.id = t.modality_id
  group by grouping sets ((t.modality_id, m.code, m.name_en, m.name_ar), ())
  order by t.modality_id nulls first`;

function counts(row: AggregateRow): Counts {
  return {
    totalAppointments: row.totalAppointments, scheduled: row.scheduled, arrived: row.arrived,
    waiting: row.waiting, inProgress: row.inProgress, inQueue: row.inQueue, completed: row.completed,
    noShow: row.noShow, cancelled: row.cancelled, discontinued: row.discontinued, voided: row.voided, walkIn: row.walkIn,
  };
}

export async function getOperationsSummary(now = new Date()) {
  const date = getTripoliToday(now);
  const { rows } = await pool.query<AggregateRow>(OPERATIONS_SUMMARY_SQL, [date, now.toISOString()]);
  const total = rows.find(row => row.modalityId === null)!;
  return {
    schemaVersion: 1 as const, date, timezone: TRIPOLI_TIME_ZONE, generatedAt: now.toISOString(),
    totals: counts(total),
    waiting: {
      count: total.waiting, oldestWaitingMinutes: total.oldestWaitingMinutes,
      over30Minutes: total.over30Minutes, over60Minutes: total.over60Minutes,
      unknownDurationCount: total.unknownDurationCount,
    },
    modalities: rows.filter(row => row.modalityId !== null).map(row => ({
      modalityId: Number(row.modalityId), code: row.code!, nameEn: row.nameEn!, nameAr: row.nameAr!, ...counts(row),
    })),
  };
}
