const legacyDefaults = new Map([
  ["DICOM_REMAP_STAGING_MAX_FILES", ["5000", "10000"]],
]);

function migrateLegacyDockerEnvValue(key, value) {
  const migration = legacyDefaults.get(key);
  return migration && value.trim() === migration[0] ? migration[1] : value;
}

module.exports = { migrateLegacyDockerEnvValue };
