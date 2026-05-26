# RISpro v3 Backup Archive Notes

v3 backup and restore preview support RISpro-generated stored ZIP archives only.
Arbitrary compressed ZIP archives are rejected.

Restore preview validates ZIP entry metadata before writing any file to staging:
path, prefix, entry type, compression method, duplicate status, per-file size, file count, and total uncompressed size are accepted first. Only then are entries extracted to a temporary staging directory.

ZIP64 is not implemented. v3 defaults stay below classic ZIP boundaries:
max files 60000, max single file 3 GiB, and max total uncompressed size 3 GiB.
