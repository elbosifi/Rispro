import fs from "node:fs";

const expectedVersion = "2.2.6";
const marker = "msg.signAlgorithm = qz.security.getSignatureAlgorithm();";

function readJson(url, description) {
  try {
    return JSON.parse(fs.readFileSync(url, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${description}.`, { cause: error });
  }
}

const frontendPackage = readJson(new URL("../package.json", import.meta.url), "frontend/package.json");
if (frontendPackage.dependencies?.["qz-tray"] !== expectedVersion) {
  throw new Error(`frontend/package.json must pin qz-tray to exactly ${expectedVersion}.`);
}
if (frontendPackage.scripts?.postinstall !== "patch-package") {
  throw new Error("frontend postinstall must run patch-package without failure-suppression flags.");
}

const patchUrl = new URL(`../patches/qz-tray+${expectedVersion}.patch`, import.meta.url);
if (!fs.existsSync(patchUrl)) {
  throw new Error(`Missing version-specific QZ Tray patch: patches/qz-tray+${expectedVersion}.patch`);
}
if (!fs.readFileSync(patchUrl, "utf8").includes(marker)) {
  throw new Error("The checked-in QZ Tray patch does not contain the pre-signing algorithm marker.");
}

const installedPackage = readJson(new URL("../node_modules/qz-tray/package.json", import.meta.url), "installed qz-tray package metadata");
if (installedPackage.version !== expectedVersion) {
  throw new Error(`Expected qz-tray ${expectedVersion} but found ${String(installedPackage.version)}.`);
}

let installedSource;
try {
  installedSource = fs.readFileSync(new URL("../node_modules/qz-tray/qz-tray.js", import.meta.url), "utf8");
} catch (error) {
  throw new Error("Unable to read the installed QZ Tray JavaScript source.", { cause: error });
}
if (!installedSource.includes(marker)) {
  throw new Error("The QZ Tray pre-signing patch was not applied to the installed source.");
}

console.log(`OK: qz-tray ${expectedVersion} is pinned and the pre-signing patch is applied.`);
