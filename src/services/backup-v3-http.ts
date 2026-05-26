export interface HeaderSetter {
  setHeader(name: string, value: string): void;
}

export function setBackupV3DownloadHeaders(res: HeaderSetter, backupName: string): void {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${backupName}"`);
}
