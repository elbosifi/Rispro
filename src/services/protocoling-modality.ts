export const PROTOCOLING_MODALITY_SQL = `
  case
    when upper(m.code) = 'CT'
      or coalesce(m.name_en, '') ~* '(^|[^[:alpha:]])CT([^[:alpha:]]|$)|computed tomography'
      or coalesce(m.name_ar, '') like '%مقط%'
      then 'CT'
    when upper(m.code) in ('MRI', 'MR')
      or coalesce(m.name_en, '') ~* '(^|[^[:alpha:]])MRI([^[:alpha:]]|$)|magnetic resonance'
      or coalesce(m.name_ar, '') like '%رنين%'
      then 'MRI'
    else null
  end
`;

export function protocolingModalityAppliesSql(modalityCodeSql: string): string {
  return `${modalityCodeSql} in ('CT', 'MRI')`;
}
