import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const assetsDirectory = fileURLToPath(new URL("../../dist-frontend/assets/", import.meta.url));
if (!fs.existsSync(assetsDirectory)) {
  throw new Error(`Frontend build assets were not found at ${assetsDirectory}.`);
}

const javascriptAssets = fs.readdirSync(assetsDirectory)
  .filter((name) => name.endsWith(".js"))
  .map((name) => path.join(assetsDirectory, name));

function containsPatchedTransport(source) {
  let fromIndex = 0;
  while (fromIndex < source.length) {
    const algorithmIndex = source.indexOf("getSignatureAlgorithm", fromIndex);
    if (algorithmIndex === -1) return false;
    const nearby = source.slice(Math.max(0, algorithmIndex - 350), Math.min(source.length, algorithmIndex + 180));
    if (nearby.includes("signature:") && nearby.includes("timestamp:") && nearby.includes("signAlgorithm")) return true;
    fromIndex = algorithmIndex + 1;
  }
  return false;
}

const patchedAsset = javascriptAssets.find((asset) => containsPatchedTransport(fs.readFileSync(asset, "utf8")));
if (!patchedAsset) {
  throw new Error("The production frontend bundle does not contain the QZ pre-signed signAlgorithm transport behavior.");
}

console.log(`OK: production bundle contains patched QZ pre-signing behavior in ${path.basename(patchedAsset)}.`);
