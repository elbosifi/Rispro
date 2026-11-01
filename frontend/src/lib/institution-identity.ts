import { useSyncExternalStore } from "react";

export interface InstitutionIdentity {
  hospitalNameEn: string; hospitalNameAr: string; departmentNameEn: string; departmentNameAr: string;
  addressEn: string; addressAr: string; contactInformation: string; primaryPhone: string; secondaryPhone: string;
  website: string; hospitalLogo: string; departmentLogo: string;
}
const empty: InstitutionIdentity = { hospitalNameEn: "", hospitalNameAr: "", departmentNameEn: "", departmentNameAr: "",
  addressEn: "", addressAr: "", contactInformation: "", primaryPhone: "", secondaryPhone: "", website: "",
  hospitalLogo: "/assets/nccb-logo.png", departmentLogo: "" };
let identity = empty;
const listeners = new Set<() => void>();
export const getInstitutionIdentity = () => identity;
export function setInstitutionIdentity(value: InstitutionIdentity) {
  identity = { ...empty, ...value };
  listeners.forEach(listener => listener());
}
export function useInstitutionIdentity() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getInstitutionIdentity);
}
export async function refreshInstitutionIdentity() {
  const response = await fetch("/api/public/institution-identity", { cache: "no-store" });
  if (!response.ok) throw new Error("Institution identity could not be loaded.");
  setInstitutionIdentity(await response.json() as InstitutionIdentity);
}
