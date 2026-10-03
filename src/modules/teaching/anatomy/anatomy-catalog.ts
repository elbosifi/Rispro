import { isSafeAnatomyAtlasId, type AnatomyModality, type AnatomyPlane } from "./anatomy-atlas.js";

export type AnatomyAtlasAvailability = "ready" | "not-installed" | "pending-source-validation" | "unavailable";

export interface TeachingAnatomyAtlasCatalogEntry {
  atlasId: string;
  title: string;
  bodyRegion: string;
  organs: string[];
  systems: string[];
  modality: AnatomyModality;
  crossSectionPlanes: AnatomyPlane[];
  description: string;
  correlatedImaging: boolean;
  status: AnatomyAtlasAvailability;
  structureCount: number | null;
  thumbnail?: string;
  provenance: {
    sourceRepository: string;
    project: string;
    attribution: string;
    license: string;
    licenseUrl: string;
    use?: string;
    citation?: string;
  };
}

const slicerLicense = "3D Slicer Contribution and Software License Agreement, Part B";
const slicerLicenseUrl = "https://www.openanatomy.org/atlas-pages/slicer-license.html";

export const TEACHING_ANATOMY_CATALOG: readonly TeachingAnatomyAtlasCatalogEntry[] = [
  {
    atlasId: "spl-liver",
    title: "SPL Liver Atlas",
    bodyRegion: "Abdomen",
    organs: ["Liver", "Gallbladder"],
    systems: ["Gastrointestinal", "Vascular"],
    modality: "CT",
    crossSectionPlanes: ["axial", "coronal", "sagittal"],
    description: "Liver segments, hepatic vasculature, gallbladder, and the aligned source CT volume.",
    correlatedImaging: true,
    status: "not-installed",
    structureCount: 17,
    provenance: {
      sourceRepository: "https://github.com/lorensen/SPLLiverAtlas",
      project: "SPL Liver Atlas",
      attribution: "M. Jakab, S. Pujol, K. Shaffer, R. Kikinis, and upstream contributors; Surgical Planning Laboratory and Boston Medical Center.",
      license: slicerLicense,
      licenseUrl: slicerLicenseUrl,
    },
  },
  {
    atlasId: "spl-brain",
    title: "SPL/NAC Brain Atlas",
    bodyRegion: "Brain / Head",
    organs: ["Brain"],
    systems: ["CNS"],
    modality: "MRI",
    crossSectionPlanes: [],
    description: "MRI-derived brain reference with detailed anatomical structures and a published structure hierarchy.",
    correlatedImaging: true,
    status: "pending-source-validation",
    structureCount: null,
    provenance: {
      sourceRepository: "https://www.openanatomy.org/atlas-pages/atlas-spl-nac-brain.html",
      project: "SPL/NAC Brain Atlas",
      attribution: "Michael Halle, Florin Talos, Marianna Jakab, Nikos Makris, Dominic Meier, Laurence Wald, Bruce Fischl, Ron Kikinis, and upstream contributors.",
      license: slicerLicense,
      licenseUrl: slicerLicenseUrl,
    },
  },
  {
    atlasId: "spl-head-neck",
    title: "SPL Head and Neck Atlas",
    bodyRegion: "Head & neck",
    organs: ["Skull", "Mandible", "Neck"],
    systems: ["Musculoskeletal", "Vascular"],
    modality: "CT",
    crossSectionPlanes: ["axial", "coronal", "sagittal"],
    description: "CT-based atlas of the skull, mandible, upper ribs, spine, and neck structures.",
    correlatedImaging: true,
    status: "not-installed",
    structureCount: 67,
    provenance: {
      sourceRepository: "https://www.openanatomy.org/atlas-pages/atlas-spl-head-and-neck.html",
      project: "SPL Head and Neck Atlas",
      attribution: "Marianna Jakab, Ron Kikinis, and upstream contributors; Surgical Planning Laboratory, Brigham and Women's Hospital.",
      license: slicerLicense,
      licenseUrl: slicerLicenseUrl,
    },
  },
  {
    atlasId: "spl-thorax",
    title: "Mauritanian Anatomy Laboratory Thoracic Atlas",
    bodyRegion: "Thorax",
    organs: ["Heart", "Lung", "Esophagus", "Thoracic skeleton"],
    systems: ["Cardiovascular", "Respiratory", "Musculoskeletal"],
    modality: "CT",
    crossSectionPlanes: [],
    description: "CT-based reference of thoracic skeletal, respiratory, cardiovascular, and esophageal anatomy.",
    correlatedImaging: true,
    status: "pending-source-validation",
    structureCount: null,
    provenance: {
      sourceRepository: "https://www.openanatomy.org/atlas-pages/atlas-mauritania-thorax.html",
      project: "Mauritanian Anatomy Laboratory Thoracic Atlas",
      attribution: "Haythem Guermazi, Ahmedou Moulaye Idriss, Tfeil Yahya, and upstream contributors; Mauritanian Anatomy Laboratory and Cardiovascular National Centre.",
      license: slicerLicense,
      licenseUrl: slicerLicenseUrl,
    },
  },
  {
    atlasId: "spl-abdomen",
    title: "SPL Abdominal Atlas",
    bodyRegion: "Abdomen",
    organs: ["Abdomen", "Kidney", "Pancreas", "Spleen"],
    systems: ["Gastrointestinal", "Genitourinary", "Vascular", "Musculoskeletal"],
    modality: "CT",
    description: "Clinical-quality CT reference of abdominal organs, skeletal anatomy, vasculature, and muscles.",
    correlatedImaging: true,
    status: "not-installed",
    structureCount: 105,
    crossSectionPlanes: ["axial", "coronal", "sagittal"],
    provenance: {
      sourceRepository: "https://www.openanatomy.org/atlas-pages/atlas-spl-abdomen.html",
      project: "SPL Abdominal Atlas",
      attribution: "Florin Talos, Marianna Jakab, Ron Kikinis, and upstream contributors; Surgical Planning Laboratory, Brigham and Women's Hospital.",
      license: slicerLicense,
      licenseUrl: slicerLicenseUrl,
    },
  },
  {
    atlasId: "spl-inner-ear",
    title: "SPL Inner Ear Atlas",
    bodyRegion: "Brain / Head",
    organs: ["Temporal bone", "Inner ear"],
    systems: ["CNS", "Musculoskeletal"],
    modality: "CT",
    crossSectionPlanes: [],
    description: "High-resolution flat-panel CT reference of the inner ear and temporal bone structures.",
    correlatedImaging: true,
    status: "pending-source-validation",
    structureCount: null,
    provenance: {
      sourceRepository: "https://www.openanatomy.org/atlas-pages/atlas-spl-inner-ear.html",
      project: "SPL Inner Ear Atlas",
      attribution: "Sonke Bartling, Marianna Jakab, Ron Kikinis, and upstream contributors; German Cancer Research Center and Surgical Planning Laboratory.",
      license: slicerLicense,
      licenseUrl: slicerLicenseUrl,
    },
  },
  {
    atlasId: "spl-knee",
    title: "SPL Knee Atlas",
    bodyRegion: "Lower limb",
    organs: ["Knee"],
    systems: ["Musculoskeletal", "Vascular"],
    modality: "MRI",
    description: "MRI-derived reference of knee bones, muscles, tendons, ligaments, vessels, cartilage, and nerves.",
    correlatedImaging: true,
    status: "not-installed",
    structureCount: 59,
    crossSectionPlanes: ["axial", "coronal", "sagittal"],
    provenance: {
      sourceRepository: "https://www.openanatomy.org/atlas-pages/atlas-spl-knee.html",
      project: "SPL Knee Atlas",
      attribution: "Jen Richolt, Marianna Jakab, Ron Kikinis, and upstream contributors; Surgical Planning Laboratory, Brigham and Women's Hospital.",
      license: slicerLicense,
      licenseUrl: slicerLicenseUrl,
    },
  },
  {
    atlasId: "prostate-t2-reference",
    title: "PROSTATEx Prostate Zones",
    bodyRegion: "Pelvis",
    organs: ["Prostate"],
    systems: ["Genitourinary"],
    modality: "MRI",
    crossSectionPlanes: [],
    description: "One reference axial T2 MRI with the four published prostate zone labels.",
    correlatedImaging: true,
    status: "pending-source-validation",
    structureCount: null,
    provenance: {
      sourceRepository: "https://www.cancerimagingarchive.net/analysis-result/prostatex-seg-zones/",
      project: "PROSTATEx-Seg-Zones",
      attribution: "Meyer, A., Schindele, D., von Reibnitz, D., Rak, M., Schostak, M., and Hansen, C. PROSTATEx Zone Segmentations, The Cancer Imaging Archive.",
      license: "Creative Commons Attribution 3.0 International (CC BY 3.0)",
      licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
      citation: "https://doi.org/10.7937/TCIA.NBB4-4655",
    },
  },
  {
    atlasId: "bodyparts3d",
    title: "Whole-body 3D Navigator",
    bodyRegion: "Whole body",
    organs: ["Brain", "Heart", "Lung", "Liver", "Kidney", "Pancreas", "Prostate", "Knee"],
    systems: ["CNS", "Cardiovascular", "Gastrointestinal", "Genitourinary", "Musculoskeletal", "Respiratory", "Vascular"],
    modality: "3D",
    crossSectionPlanes: [],
    description: "Adult male whole-body 3D reference for anatomy search and navigation; structures are not registered to the regional image atlases.",
    correlatedImaging: false,
    status: "not-installed",
    structureCount: 2072,
    provenance: {
      sourceRepository: "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/",
      project: "BodyParts3D 4.0 PART-OF tree",
      attribution: "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.",
      license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
      licenseUrl: "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
      use: "Adult male reference model; not registered to regional CT or MRI atlases.",
    },
  },
] as const satisfies readonly TeachingAnatomyAtlasCatalogEntry[];

export function validateTeachingAnatomyCatalog(entries: readonly TeachingAnatomyAtlasCatalogEntry[] = TEACHING_ANATOMY_CATALOG): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isSafeAnatomyAtlasId(entry.atlasId) || seen.has(entry.atlasId) || !entry.title.trim()
      || !entry.bodyRegion.trim() || !entry.description.trim() || entry.organs.length === 0 || entry.systems.length === 0
      || !entry.provenance.sourceRepository.startsWith("https://") || !entry.provenance.project.trim()
      || !entry.provenance.attribution.trim() || !entry.provenance.license.trim() || !entry.provenance.licenseUrl.startsWith("https://")
      || (entry.correlatedImaging && entry.modality === "3D") || (!entry.correlatedImaging && entry.modality !== "3D")
      || entry.crossSectionPlanes.some((plane) => !["axial", "coronal", "sagittal"].includes(plane))) {
      throw new Error(`Teaching anatomy catalog entry ${entry.atlasId} is invalid.`);
    }
    seen.add(entry.atlasId);
  }
}

export function findTeachingAnatomyAtlas(atlasId: string): TeachingAnatomyAtlasCatalogEntry | undefined {
  return TEACHING_ANATOMY_CATALOG.find((entry) => entry.atlasId === atlasId);
}
