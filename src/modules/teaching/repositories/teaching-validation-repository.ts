import type { PoolClient } from "pg";
import type { TeachingAuditIdentity } from "../domain/teaching-content.js";

export type TeachingValidationClassification = "valid" | "valid_with_warnings" | "invalid";
export interface TeachingValidationIssue {
  code: string;
  message: string;
}

export async function saveTeachingQuestionValidationSummary(
  client: PoolClient,
  input: {
    revisionId: number;
    revisionVersion: number;
    classification: TeachingValidationClassification;
    errors: TeachingValidationIssue[];
    warnings: TeachingValidationIssue[];
  },
  actor: TeachingAuditIdentity,
): Promise<void> {
  await client.query(
    `insert into teaching.question_validation_summaries (
       question_revision_id, revision_version, classification, errors_json, warnings_json,
       validated_by_identity_issuer, validated_by_identity_subject, validated_at
     ) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, now())
     on conflict (question_revision_id) do update set
       revision_version = excluded.revision_version,
       classification = excluded.classification,
       errors_json = excluded.errors_json,
       warnings_json = excluded.warnings_json,
       validated_by_identity_issuer = excluded.validated_by_identity_issuer,
       validated_by_identity_subject = excluded.validated_by_identity_subject,
       validated_at = excluded.validated_at`,
    [input.revisionId, input.revisionVersion, input.classification, JSON.stringify(input.errors), JSON.stringify(input.warnings), actor.identityIssuer, actor.identitySubject],
  );
}
