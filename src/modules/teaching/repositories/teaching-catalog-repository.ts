import { pool } from "../../../db/pool.js";
import type { PoolClient } from "pg";

interface TaxonomyRow {
  code: string;
  label: string;
  description: string;
  parent_code: string | null;
  is_active: boolean;
  sort_order: number;
}

interface DifficultyRow {
  value: number;
  code: string;
  label: string;
  description: string;
  is_active: boolean;
  sort_order: number;
}

async function taxonomy(query: string, client?: PoolClient): Promise<TaxonomyRow[]> {
  const result = client ? await client.query<TaxonomyRow>(query) : await pool.query<TaxonomyRow>(query);
  return result.rows;
}

export async function getTeachingCatalog(client?: PoolClient) {
  const specialtySql = `select code, label, description, null::text as parent_code, is_active, sort_order from teaching.specialties where is_active order by sort_order, code`;
  const domainSql = `select item.code, item.label, item.description, parent.code as parent_code, item.is_active, item.sort_order from teaching.domains item join teaching.specialties parent on parent.id = item.specialty_id where item.is_active and parent.is_active order by parent.sort_order, item.sort_order, item.code`;
  const topicSql = `select item.code, item.label, item.description, parent.code as parent_code, item.is_active, item.sort_order from teaching.topics item join teaching.domains parent on parent.id = item.domain_id join teaching.specialties specialty on specialty.id = parent.specialty_id where item.is_active and parent.is_active and specialty.is_active order by specialty.sort_order, parent.sort_order, item.sort_order, item.code`;
  const subtopicSql = `select item.code, item.label, item.description, parent.code as parent_code, item.is_active, item.sort_order from teaching.subtopics item join teaching.topics parent on parent.id = item.topic_id join teaching.domains domain on domain.id = parent.domain_id join teaching.specialties specialty on specialty.id = domain.specialty_id where item.is_active and parent.is_active and domain.is_active and specialty.is_active order by specialty.sort_order, domain.sort_order, parent.sort_order, item.sort_order, item.code`;
  const modalitySql = `select code, label, description, null::text as parent_code, is_active, sort_order from teaching.modalities where is_active order by sort_order, code`;
  const competencySql = `select code, label, description, null::text as parent_code, is_active, sort_order from teaching.competencies where is_active order by sort_order, code`;
  const trainingLevelSql = `select code, label, description, null::text as parent_code, is_active, sort_order from teaching.training_levels where is_active order by sort_order, code`;
  const difficultySql = `select value, code, label, description, is_active, sort_order from teaching.difficulties where is_active order by sort_order, value`;
  const tagSql = `select code, label, description, null::text as parent_code, is_active, 0 as sort_order from teaching.tags where is_active order by label, code`;
  let specialties: TaxonomyRow[];
  let domains: TaxonomyRow[];
  let topics: TaxonomyRow[];
  let subtopics: TaxonomyRow[];
  let modalities: TaxonomyRow[];
  let competencies: TaxonomyRow[];
  let trainingLevels: TaxonomyRow[];
  let difficulties: DifficultyRow[];
  let tags: TaxonomyRow[];
  if (client) {
    specialties = await taxonomy(specialtySql, client);
    domains = await taxonomy(domainSql, client);
    topics = await taxonomy(topicSql, client);
    subtopics = await taxonomy(subtopicSql, client);
    modalities = await taxonomy(modalitySql, client);
    competencies = await taxonomy(competencySql, client);
    trainingLevels = await taxonomy(trainingLevelSql, client);
    difficulties = (await client.query<DifficultyRow>(difficultySql)).rows;
    tags = await taxonomy(tagSql, client);
  } else {
    [specialties, domains, topics, subtopics, modalities, competencies, trainingLevels, difficulties, tags] = await Promise.all([
      taxonomy(specialtySql), taxonomy(domainSql), taxonomy(topicSql), taxonomy(subtopicSql), taxonomy(modalitySql),
      taxonomy(competencySql), taxonomy(trainingLevelSql), pool.query<DifficultyRow>(difficultySql).then((result) => result.rows), taxonomy(tagSql),
    ]);
  }

  const map = (rows: TaxonomyRow[]) => rows.map((row) => ({
    code: row.code,
    label: row.label,
    description: row.description,
    ...(row.parent_code === null ? {} : { parentCode: row.parent_code }),
    active: row.is_active,
    sortOrder: row.sort_order,
  }));

  return {
    schemaVersion: 1,
    specialties: map(specialties),
    domains: map(domains),
    topics: map(topics),
    subtopics: map(subtopics),
    modalities: map(modalities),
    competencies: map(competencies),
    trainingLevels: map(trainingLevels),
    difficulties: difficulties.map((row) => ({
      value: row.value,
      code: row.code,
      label: row.label,
      description: row.description,
      active: row.is_active,
      sortOrder: row.sort_order,
    })),
    tags: map(tags),
    supportedQuestionTypes: ["single_best_answer", "image_based_sba", "case_based_sba"] as const,
    supportedSourceTypes: ["original", "textbook", "journal_article", "guideline", "society_document", "exam", "question_bank", "lecture", "conference", "website", "local_teaching", "other", "unknown"] as const,
    supportedProvenanceRelationships: ["original", "adapted", "paraphrased", "verbatim", "inspired_by", "unknown"] as const,
  };
}

export async function listTeachingQuestionBanks(client?: PoolClient) {
  const result = client ? await client.query<{ code: string; name: string; description: string; specialty_code: string }>(
    `select bank.code, bank.name, bank.description, specialty.code as specialty_code
     from teaching.question_banks bank
     join teaching.specialties specialty on specialty.id = bank.specialty_id
     where bank.is_active and specialty.is_active
     order by bank.name, bank.code`,
  ) : await pool.query<{ code: string; name: string; description: string; specialty_code: string }>(
    `select bank.code, bank.name, bank.description, specialty.code as specialty_code
     from teaching.question_banks bank
     join teaching.specialties specialty on specialty.id = bank.specialty_id
     where bank.is_active and specialty.is_active
     order by bank.name, bank.code`,
  );
  return result.rows.map((row) => ({
    code: row.code,
    name: row.name,
    description: row.description,
    specialtyCode: row.specialty_code,
  }));
}
