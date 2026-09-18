export const DOCTOR_ADVANCED_SETUP_PATH = "/doctor/advanced-setup";
export const DOCTOR_ADVANCED_SETUP_SECTIONS = ["roster", "doctors"] as const;

export type DoctorAdvancedSetupSection = (typeof DOCTOR_ADVANCED_SETUP_SECTIONS)[number];

export interface DoctorAdvancedSetupNavigationContext {
  canManageRoster: boolean;
  canManageDoctors: boolean;
}

export interface DoctorAdvancedSetupNavigationState {
  section: DoctorAdvancedSetupSection | null;
}

function canAccessSection(section: DoctorAdvancedSetupSection, context: DoctorAdvancedSetupNavigationContext): boolean {
  return section === "roster" ? context.canManageRoster : context.canManageDoctors;
}

export function parseDoctorAdvancedSetupNavigation(
  params: URLSearchParams,
  context: DoctorAdvancedSetupNavigationContext,
): DoctorAdvancedSetupNavigationState {
  const requested = params.get("section");
  const section = DOCTOR_ADVANCED_SETUP_SECTIONS.includes(requested as DoctorAdvancedSetupSection)
    ? requested as DoctorAdvancedSetupSection
    : null;
  return { section: section && canAccessSection(section, context) ? section : null };
}

export function buildDoctorAdvancedSetupSearch(
  current: URLSearchParams,
  patch: Partial<DoctorAdvancedSetupNavigationState> = {},
  context: DoctorAdvancedSetupNavigationContext,
): URLSearchParams {
  const section = patch.section === undefined
    ? parseDoctorAdvancedSetupNavigation(current, context).section
    : patch.section;
  const next = new URLSearchParams();
  if (section && canAccessSection(section, context)) next.set("section", section);
  return next;
}

export function sanitizeDoctorAdvancedSetupSearch(
  current: URLSearchParams,
  context: DoctorAdvancedSetupNavigationContext,
): URLSearchParams {
  return buildDoctorAdvancedSetupSearch(current, {}, context);
}

