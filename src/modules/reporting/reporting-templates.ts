import {HttpError} from '../../utils/http-error.js';
import {EMPTY_SECTIONS} from './reporting-validation.js';
export const REPORT_TEMPLATES={
  blank:{name:'Blank narrative',sections:EMPTY_SECTIONS},
  structured:{name:'Structured narrative',sections:{...EMPTY_SECTIONS,technique:'{{technique}}',findings:'{{findings}}',impression:'{{impression}}'}},
};
export function templateSections(id:unknown) {
  const key=String(id||'blank');if(!(key in REPORT_TEMPLATES))throw new HttpError(400,'Unknown report template.');
  return {...REPORT_TEMPLATES[key as keyof typeof REPORT_TEMPLATES].sections};
}
