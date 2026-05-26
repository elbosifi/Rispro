import path from "node:path";
import { getProjectRootDir, isAbsoluteStoragePath, resolveStorageBasePath } from "./document-storage-path.js";
import type { BackupV3StorageRoot, BackupV3StorageRootKind } from "./backup-v3-types.js";

export interface BackupV3StorageRootConfig {
  uploadsDir?: string | null;
  documentStorageRoot?: string | null;
  documentStorageAllowlist?: string[];
  dicomWorklistSourceDir?: string | null;
  dicomWorklistOutputDir?: string | null;
  santeHl7OutputFolderPath?: string | null;
}

interface CandidateRoot {
  id: string;
  kind: BackupV3StorageRootKind;
  configuredPath: string;
  archivePrefix: string;
  requireAllowlist?: boolean;
}

function normalizeResolvedPath(input: string): string {
  return path.resolve(input);
}

function isSameOrInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function isAppOwnedPath(absolutePath: string, appOwnedRoots: string[]): boolean {
  return appOwnedRoots.some((root) => isSameOrInside(absolutePath, root));
}

function buildRoot(candidate: CandidateRoot, appOwnedRoots: string[], allowlistRoots: string[]): BackupV3StorageRoot | null {
  const absolutePath = normalizeResolvedPath(resolveStorageBasePath(candidate.configuredPath));
  const allowed = candidate.requireAllowlist
    ? allowlistRoots.some((root) => isSameOrInside(absolutePath, root))
    : isAppOwnedPath(absolutePath, appOwnedRoots);

  if (!allowed) {
    return null;
  }

  return {
    id: candidate.id,
    kind: candidate.kind,
    absolutePath,
    archivePrefix: candidate.archivePrefix.replace(/^\/+|\/+$/g, ""),
    appOwned: true,
  };
}

export function resolveBackupV3StorageRoots(config: BackupV3StorageRootConfig = {}): BackupV3StorageRoot[] {
  const projectRoot = getProjectRootDir();
  const projectStorage = normalizeResolvedPath(path.join(projectRoot, "storage"));
  const allowlistRoots = (config.documentStorageAllowlist || [])
    .filter(Boolean)
    .map((root) => normalizeResolvedPath(resolveStorageBasePath(root)));
  const appOwnedRoots = [projectStorage, ...allowlistRoots];

  const candidates: CandidateRoot[] = [
    {
      id: "project-storage",
      kind: "project_storage",
      configuredPath: projectStorage,
      archivePrefix: "storage/project",
    },
    {
      id: "uploads",
      kind: "uploads",
      configuredPath: config.uploadsDir || "storage/uploads",
      archivePrefix: "storage/uploads",
    },
    ...(config.documentStorageRoot
      ? [{
          id: "document-storage",
          kind: "document_storage" as const,
          configuredPath: config.documentStorageRoot,
          archivePrefix: "documents/external",
          requireAllowlist: isAbsoluteStoragePath(config.documentStorageRoot),
        }]
      : []),
    ...(config.dicomWorklistSourceDir
      ? [{
          id: "dicom-worklist-source",
          kind: "dicom_worklist" as const,
          configuredPath: config.dicomWorklistSourceDir,
          archivePrefix: "storage/dicom/worklist-source",
        }]
      : []),
    ...(config.dicomWorklistOutputDir
      ? [{
          id: "dicom-worklists",
          kind: "dicom_worklist" as const,
          configuredPath: config.dicomWorklistOutputDir,
          archivePrefix: "storage/dicom/worklists",
        }]
      : []),
    ...(config.santeHl7OutputFolderPath
      ? [{
          id: "sante-hl7-outbox",
          kind: "hl7_outbox" as const,
          configuredPath: config.santeHl7OutputFolderPath,
          archivePrefix: "storage/sante-hl7-outbox",
        }]
      : []),
  ];

  const roots = new Map<string, BackupV3StorageRoot>();
  for (const candidate of candidates) {
    const root = buildRoot(candidate, appOwnedRoots, allowlistRoots);
    if (root) {
      roots.set(root.absolutePath, root);
    }
  }

  return [...roots.values()].sort((a, b) => a.id.localeCompare(b.id));
}
