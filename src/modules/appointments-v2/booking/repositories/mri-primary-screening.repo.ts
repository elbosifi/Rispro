import type { PoolClient } from "pg";

export type MriPrimaryScreeningResult = "no_known_implant_reported" | "implant_reported_review_required";
export interface MriPrimaryScreeningInput { result: MriPrimaryScreeningResult; implantSite: string | null; implantDescription: string | null; previousReviewerNameReported: string | null; }

export async function insertMriPrimaryScreening(client: PoolClient, bookingId: number, input: MriPrimaryScreeningInput, userId: number): Promise<void> {
  await client.query(`insert into appointments_v2.mri_primary_screenings (booking_id, result, implant_site, implant_description, previous_reviewer_name_reported, screened_by_user_id) values ($1,$2,$3,$4,$5,$6)`, [bookingId, input.result, input.implantSite, input.implantDescription, input.previousReviewerNameReported, userId]);
}
