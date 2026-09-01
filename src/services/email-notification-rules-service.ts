import type { Pool, PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";

const definitions = {
  additional_imaging_completed: {
    label: "Additional imaging completed",
    description: "Email the doctor currently assigned to report the original examination when requested additional imaging is completed and ready for review.",
    recipientDescription: "Assigned reporting doctor",
  },
} as const;

export type EmailNotificationEventType = keyof typeof definitions;
export type EmailNotificationRule = { eventType: EmailNotificationEventType; enabled: boolean; label: string; description: string; recipientDescription: string };
const requireEvent = (eventType: string): EmailNotificationEventType => {
  if (!(eventType in definitions)) throw new HttpError(400, "Unknown email notification event type.");
  return eventType as EmailNotificationEventType;
};
const mapRule = (eventType: EmailNotificationEventType, enabled: boolean): EmailNotificationRule => ({ eventType, enabled, ...definitions[eventType] });

export async function listEmailNotificationRules(db: Pool | PoolClient = pool): Promise<EmailNotificationRule[]> {
  const result = await db.query<{ event_type: string; enabled: boolean }>("select event_type, enabled from email_notification_rules where event_type = any($1::text[]) order by event_type", [Object.keys(definitions)]);
  return result.rows.map((row) => mapRule(requireEvent(row.event_type), row.enabled));
}
export async function getEmailNotificationRule(eventType: string, db: Pool | PoolClient = pool): Promise<EmailNotificationRule> {
  const known = requireEvent(eventType);
  const result = await db.query<{ enabled: boolean }>("select enabled from email_notification_rules where event_type = $1", [known]);
  if (!result.rows[0]) throw new Error(`Email notification rule ${known} is not initialized.`);
  return mapRule(known, result.rows[0].enabled);
}
export async function setEmailNotificationRule(eventType: string, enabled: boolean, updatedByUserId: number | string, db: Pool | PoolClient = pool): Promise<EmailNotificationRule> {
  const known = requireEvent(eventType);
  const result = await db.query<{ enabled: boolean }>("update email_notification_rules set enabled = $2, updated_by_user_id = $3, updated_at = now() where event_type = $1 returning enabled", [known, enabled, updatedByUserId]);
  if (!result.rows[0]) throw new Error(`Email notification rule ${known} is not initialized.`);
  return mapRule(known, result.rows[0].enabled);
}
