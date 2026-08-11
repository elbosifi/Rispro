import { pool } from "../db/pool.js";
import { getCached, setCached } from "../utils/cache.js";
import { normalizeIdentifierValue } from "../utils/identifier.js";
import { generateEnglishFromDictionary, type NameDictionaryLookup } from "../utils/name-generation.js";
import { normalizeArabicName, normalizeArabicNameCompact } from "../utils/normalize.js";

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function loadPatientNameDictionary(): Promise<NameDictionaryLookup[]> {
  const cacheKey = "name_dictionary";
  const cached = getCached<NameDictionaryLookup[]>(cacheKey);

  if (cached) {
    return cached;
  }

  const { rows } = await pool.query<NameDictionaryLookup>(
    `
      select arabic_text, english_text
      from name_dictionary
      where is_active = true
      order by arabic_text asc
    `
  );

  setCached(cacheKey, rows, 5 * 60 * 1000);
  return rows;
}

export async function preparePatientSearch(searchTerm = ""): Promise<{ term: string; queryParameters: unknown[] }> {
  const term = searchTerm.trim();
  const pattern = `%${term}%`;
  const searchTokens = term ? term.toLowerCase().replace(/\s+/g, " ").split(" ").filter(Boolean) : [];
  const normalizedArabicTerm = normalizeArabicName(term);
  const normalizedArabicCompactTerm = normalizeArabicNameCompact(term);
  const hasArabic = /[\u0600-\u06ff]/.test(term);
  const dictionaryTranslation = hasArabic
    ? generateEnglishFromDictionary(term, await loadPatientNameDictionary())
    : null;
  const dictionaryEnglishTerm = dictionaryTranslation?.missingTokens.length === 0
    ? dictionaryTranslation.englishName
    : "";
  const normalizedPattern = `%${normalizedArabicTerm}%`;
  const normalizedCompactPattern = `%${normalizedArabicCompactTerm}%`;
  const normalizedIdentifierPattern = `%${normalizeIdentifierValue(term)}%`;
  const normalizedEnglishTerm = term.toLowerCase().replace(/\s+/g, " ").trim();
  const englishSearchTerm = (hasArabic ? dictionaryEnglishTerm : normalizedEnglishTerm).toLowerCase().replace(/\s+/g, " ").trim();
  const englishSearchTokens = englishSearchTerm ? englishSearchTerm.split(" ").filter(Boolean) : [];
  const normalizedArabicPrefixPattern = `${normalizedArabicTerm}%`;
  const normalizedEnglishPrefixPattern = `${englishSearchTerm}%`;
  const normalizedArabicLaterTokenPattern = `% ${normalizedArabicTerm}%`;
  const normalizedEnglishLaterTokenPattern = `% ${englishSearchTerm}%`;
  const orderedEnglishPattern = englishSearchTokens.length > 1
    ? englishSearchTokens.map((token) => escapeRegexLiteral(token)).join(".*")
    : "";
  const orderedArabicPattern = searchTokens.length > 1
    ? searchTokens.map((token) => escapeRegexLiteral(normalizeArabicName(token))).join(".*")
    : "";
  const arabicFuzzyThreshold = normalizedArabicCompactTerm.length <= 4 ? 0.45 : 0.3;
  const englishFuzzyThreshold = englishSearchTerm.replace(/\s/g, "").length <= 4 ? 0.45 : 0.3;
  const singleEnglishToken = englishSearchTokens.length === 1;
  // Whole-word scores measured on representative transliterations support 0.30 for
  // longer names; short tokens retain 0.45 because their trigram overlap is less selective.
  const englishStrictWordThreshold = englishSearchTerm.length <= 4 ? 0.45 : 0.3;

  return {
    term,
    queryParameters: [
      term,
      pattern,
      normalizedPattern,
      normalizedIdentifierPattern,
      normalizedArabicTerm,
      englishSearchTerm,
      normalizedArabicPrefixPattern,
      normalizedEnglishPrefixPattern,
      normalizedArabicLaterTokenPattern,
      normalizedEnglishLaterTokenPattern,
      orderedEnglishPattern,
      orderedArabicPattern,
      normalizedArabicCompactTerm,
      normalizedCompactPattern,
      arabicFuzzyThreshold,
      englishFuzzyThreshold,
      `%${englishSearchTerm}%`,
      singleEnglishToken,
      englishStrictWordThreshold,
    ],
  };
}

export const PATIENT_SEARCH_CANDIDATE_IDS_CTE = String.raw`
  patient_search_trgm_config as materialized (
    select set_config('pg_trgm.strict_word_similarity_threshold', $19::text, true)
  ),
  candidate_ids as materialized (
    select p.id
    from patients p
    where
      $1 = ''
      or p.mrn ilike $2
      or p.national_id ilike $2
      or p.identifier_value ilike $2
      or exists (
        select 1
        from patient_identifiers pi
        where pi.patient_id = p.id and (pi.value ilike $2 or pi.normalized_value ilike $4)
      )
      or p.phone_1 ilike $2
      or p.phone_2 ilike $2
      or p.arabic_full_name ilike $2
      or p.normalized_arabic_name ilike $3
      or (
        $13 <> ''
        and coalesce(p.normalized_arabic_name_compact, regexp_replace(p.normalized_arabic_name, '\s+', '', 'g')) <> ''
        and coalesce(p.normalized_arabic_name_compact, regexp_replace(p.normalized_arabic_name, '\s+', '', 'g')) ilike $14
      )
      or lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')) ilike $17
      or (
        $11 <> ''
        and (
          lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')) ~* $11
          or p.normalized_arabic_name ~* $12
        )
      )
    union
    select p.id
    from patients p
    where
      ($5 <> '' and p.normalized_arabic_name % $5)
      or ($13 <> '' and p.normalized_arabic_name_compact % $13)
      or ($6 <> '' and lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')) % $6)
    union
    select p.id
    from patient_search_trgm_config
    cross join patients p
    where
      $18::boolean
      and $6 <<% lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g'))
    union
    select p.id
    from patients p
    where
      $6 <> ''
      and patient_english_name_dmetaphone_tokens(coalesce(p.english_full_name, ''))
        && patient_english_name_dmetaphone_tokens($6)
  )`;

export const PATIENT_SEARCH_PHONETIC_LATERALS = String.raw`
  cross join lateral (
    select
      regexp_split_to_array(lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')), ' ') as patient_tokens,
      regexp_split_to_array($6, ' ') as query_tokens
  ) as phonetic_names
  cross join lateral (
    select
      count(*) filter (
        where
          (
            dmetaphone(phonetic_names.patient_tokens[token_index]) in (
              dmetaphone(phonetic_names.query_tokens[case when cardinality(phonetic_names.query_tokens) = 1 then 1 else token_index end]),
              dmetaphone_alt(phonetic_names.query_tokens[case when cardinality(phonetic_names.query_tokens) = 1 then 1 else token_index end])
            )
            or dmetaphone_alt(phonetic_names.patient_tokens[token_index]) in (
              dmetaphone(phonetic_names.query_tokens[case when cardinality(phonetic_names.query_tokens) = 1 then 1 else token_index end]),
              dmetaphone_alt(phonetic_names.query_tokens[case when cardinality(phonetic_names.query_tokens) = 1 then 1 else token_index end])
            )
          )
          and similarity(
            phonetic_names.patient_tokens[token_index],
            phonetic_names.query_tokens[case when cardinality(phonetic_names.query_tokens) = 1 then 1 else token_index end]
          ) >= case
            when least(
              length(phonetic_names.patient_tokens[token_index]),
              length(phonetic_names.query_tokens[case when cardinality(phonetic_names.query_tokens) = 1 then 1 else token_index end])
            ) <= 4 then 0.25
            else 0.08
          end
      )::int as matching_token_count
    from generate_series(
      1,
      case
        when cardinality(phonetic_names.query_tokens) = 1 then cardinality(phonetic_names.patient_tokens)
        else least(cardinality(phonetic_names.patient_tokens), cardinality(phonetic_names.query_tokens))
      end
    ) as token_position(token_index)
  ) as phonetic_match`;

export const PATIENT_SEARCH_MATCH_SQL = String.raw`
  $1 = ''
  or p.mrn ilike $2
  or p.national_id ilike $2
  or p.identifier_value ilike $2
  or exists (
    select 1
    from patient_identifiers pi
    where pi.patient_id = p.id and (pi.value ilike $2 or pi.normalized_value ilike $4)
  )
  or p.phone_1 ilike $2
  or p.phone_2 ilike $2
  or p.arabic_full_name ilike $2
  or p.normalized_arabic_name ilike $3
  or (
    $13 <> ''
    and coalesce(p.normalized_arabic_name_compact, regexp_replace(p.normalized_arabic_name, '\s+', '', 'g')) <> ''
    and coalesce(p.normalized_arabic_name_compact, regexp_replace(p.normalized_arabic_name, '\s+', '', 'g')) ilike $14
  )
  or lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')) ilike $17
  or (
    $11 <> ''
    and (
      lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')) ~* $11
      or p.normalized_arabic_name ~* $12
    )
  )
  or ($5 <> '' and p.normalized_arabic_name % $5 and similarity(p.normalized_arabic_name, $5) >= $15)
  or (
    $13 <> ''
    and coalesce(p.normalized_arabic_name_compact, regexp_replace(p.normalized_arabic_name, '\s+', '', 'g')) % $13
    and similarity(
      coalesce(p.normalized_arabic_name_compact, regexp_replace(p.normalized_arabic_name, '\s+', '', 'g')),
      $13
    ) >= $15
  )
  or (
    $6 <> ''
    and lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')) % $6
    and similarity(lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')), $6) >= $16
  )
  or (
    $18::boolean
    and strict_word_similarity($6, lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g'))) >= $19::real
  )
  or (
    $6 <> ''
    and phonetic_match.matching_token_count >= case
      when cardinality(phonetic_names.query_tokens) = 1 then 1
      else greatest(2, ceil(cardinality(phonetic_names.query_tokens) * 0.6)::int)
    end
  )`;

export const PATIENT_SEARCH_RANK_SQL = String.raw`
  case
    when $1 = '' then 99
    when p.mrn ilike $2
      or p.national_id ilike $2
      or p.identifier_value ilike $2
      or p.phone_1 ilike $2
      or p.phone_2 ilike $2
      or exists (
        select 1
        from patient_identifiers pi
        where pi.patient_id = p.id and (pi.value ilike $2 or pi.normalized_value ilike $4)
      ) then 1
    when p.normalized_arabic_name = $5 then 2
    when $13 <> ''
      and coalesce(p.normalized_arabic_name_compact, regexp_replace(p.normalized_arabic_name, '\s+', '', 'g')) <> ''
      and coalesce(p.normalized_arabic_name_compact, regexp_replace(p.normalized_arabic_name, '\s+', '', 'g')) = $13 then 3
    when lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')) = $6 then 4
    when split_part(p.normalized_arabic_name, ' ', 1) = $5 then 5
    when split_part(lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')), ' ', 1) = $6 then 5
    when p.normalized_arabic_name like $7 then 5
    when lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')) like $8 then 5
    when split_part(p.normalized_arabic_name, ' ', 1) like $7 then 6
    when split_part(lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')), ' ', 1) like $8 then 6
    when $11 <> '' and lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')) ~* $11 then 7
    when $12 <> '' and p.normalized_arabic_name ~* $12 then 7
    when (
      ($5 <> '' and p.normalized_arabic_name % $5 and similarity(p.normalized_arabic_name, $5) >= $15)
      or (
        $13 <> ''
        and coalesce(p.normalized_arabic_name_compact, regexp_replace(p.normalized_arabic_name, '\s+', '', 'g')) % $13
        and similarity(coalesce(p.normalized_arabic_name_compact, regexp_replace(p.normalized_arabic_name, '\s+', '', 'g')), $13) >= $15
      )
      or (
        $6 <> ''
        and lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')) % $6
        and similarity(lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')), $6) >= $16
      )
      or (
        $18::boolean
        and strict_word_similarity($6, lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g'))) >= $19::real
      )
    ) then 8
    when $6 <> '' and phonetic_match.matching_token_count > 0 then 9
    when p.normalized_arabic_name like $9 then 10
    when lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')) like $10 then 10
    else 11
  end`;

export const PATIENT_SEARCH_SIMILARITY_SQL = String.raw`
  greatest(
    case when $5 <> '' then similarity(p.normalized_arabic_name, $5) else 0 end,
    case when $13 <> '' then similarity(coalesce(p.normalized_arabic_name_compact, ''), $13) else 0 end,
    case when $6 <> '' then similarity(lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g')), $6) else 0 end,
    case when $18::boolean then strict_word_similarity($6, lower(regexp_replace(coalesce(p.english_full_name, ''), '\s+', ' ', 'g'))) else 0 end
  )`;
