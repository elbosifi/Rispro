import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";

// Small, validated logo assets use the existing JSON settings storage. Signed
// snapshots embed the bytes, so replacing a logo cannot change a signed report.
export interface InstitutionIdentity {
  hospitalNameEn: string; hospitalNameAr: string;
  departmentNameEn: string; departmentNameAr: string;
  addressEn: string; addressAr: string; contactInformation: string;
  primaryPhone: string; secondaryPhone: string; website: string;
  hospitalLogo: string; departmentLogo: string;
}
export const DEFAULT_INSTITUTION_LOGO = "/assets/nccb-logo.png";
export const EMPTY_INSTITUTION_IDENTITY: InstitutionIdentity = {
  hospitalNameEn: "", hospitalNameAr: "", departmentNameEn: "", departmentNameAr: "",
  addressEn: "", addressAr: "", contactInformation: "", primaryPhone: "", secondaryPhone: "",
  website: "", hospitalLogo: DEFAULT_INSTITUTION_LOGO, departmentLogo: "",
};
type Db = Pick<PoolClient, "query">;
export async function readInstitutionIdentity(db: Db = pool): Promise<InstitutionIdentity> {
  const row = (await db.query("select setting_value from system_settings where category='deployment_identity' and setting_key='institution'")).rows[0];
  return { ...EMPTY_INSTITUTION_IDENTITY, ...row?.setting_value?.value };
}

export async function validateInstitutionIdentity(value: unknown): Promise<InstitutionIdentity> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Institution identity is required.");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !(key in EMPTY_INSTITUTION_IDENTITY))) throw new HttpError(400, "Unknown institution identity field.");
  const result = { ...EMPTY_INSTITUTION_IDENTITY };
  for (const key of Object.keys(result) as (keyof InstitutionIdentity)[]) {
    if (typeof raw[key] !== "string") throw new HttpError(400, `${key} must be text.`);
    if (key === "hospitalLogo" || key === "departmentLogo") {
      result[key] = await validateLogo(raw[key] as string, key === "hospitalLogo");
    } else {
      const text = (raw[key] as string).trim();
      if (text.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new HttpError(400, `${key} is too long or contains control characters.`);
      result[key] = text;
    }
  }
  if (result.website) {
    let url: URL;
    try { url = new URL(result.website); } catch { throw new HttpError(400, "Website must be an absolute HTTP or HTTPS URL."); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new HttpError(400, "Invalid website URL.");
  }
  for (const key of ["primaryPhone","secondaryPhone"] as const) {
    if (result[key] && !/^\+?\d{7,15}$/.test(result[key].replace(/[\s()-]/g,""))) throw new HttpError(400, `${key} must be a valid phone number.`);
  }
  return result;
}

export async function validateLogo(value: string, hospital = false): Promise<string> {
  if (!value) return hospital ? DEFAULT_INSTITUTION_LOGO : "";
  if (hospital && value === DEFAULT_INSTITUTION_LOGO) return value;
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length > 2_800_000) throw new HttpError(400, "Logo must be a PNG or JPEG image of at most 2 MB.");
  try {
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 2_000_000) throw Error();
    const image = sharp(bytes, { limitInputPixels: 16_000_000, animated: false });
    const metadata = await image.metadata();
    if (!["png", "jpeg"].includes(metadata.format || "") || (metadata.pages ?? 1) !== 1) throw Error();
    const png = await image.rotate().resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    if (png.length > 600_000) throw Error();
    return "data:image/png;base64," + png.toString("base64");
  } catch { throw new HttpError(400, "Logo could not be decoded safely. Use a smaller PNG or JPEG image."); }
}

export async function snapshotInstitutionIdentity(db: Db): Promise<InstitutionIdentity> {
  const identity = await readInstitutionIdentity(db);
  if (identity.hospitalLogo === DEFAULT_INSTITUTION_LOGO) {
    identity.hospitalLogo = await validateLogo("data:image/png;base64," + (await fs.readFile(path.resolve("assets/nccb-logo.png"))).toString("base64"));
  }
  return identity;
}

// Legacy configuration values stay stored for migration review, but no longer
// override the institution. Location/arrival/parking/WhatsApp settings stay local.
export function applyInstitutionIdentity(category: string, value: unknown, identity: InstitutionIdentity): Record<string, unknown> {
  const config = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (category === "appointment_slip") return { ...config, hospitalNameEn: identity.hospitalNameEn, hospitalNameAr: identity.hospitalNameAr,
    departmentNameEn: identity.departmentNameEn, departmentNameAr: identity.departmentNameAr, hospitalLogo: identity.hospitalLogo };
  return { ...config, hospitalLogo: identity.hospitalLogo, departmentNameEn: identity.departmentNameEn, departmentNameAr: identity.departmentNameAr,
    location: { ...config.location as object, centerNameEn: identity.hospitalNameEn, centerNameAr: identity.hospitalNameAr, addressEn: identity.addressEn, addressAr: identity.addressAr },
    contact: { ...config.contact as object, primaryPhone: identity.primaryPhone, secondaryPhone: identity.secondaryPhone } };
}
