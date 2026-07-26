import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const packageLock = JSON.parse(readFileSync(resolve(process.cwd(), "package-lock.json"), "utf8")) as {
  packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
};

describe("React-PDF dependency contract", () => {
  it("pins one PDF.js version compatible with the installed React-PDF version", () => {
    const reactPdfPackage = packageLock.packages["node_modules/react-pdf"];
    const installedPdfJsPackages = Object.entries(packageLock.packages).filter(([packagePath]) => packagePath === "node_modules/pdfjs-dist" || packagePath.endsWith("/node_modules/pdfjs-dist"));

    expect(packageJson.dependencies["react-pdf"]).toBe("10.4.1");
    expect(packageJson.dependencies["pdfjs-dist"]).toBe("5.4.296");
    expect(reactPdfPackage?.dependencies?.["pdfjs-dist"]).toBe(packageJson.dependencies["pdfjs-dist"]);
    expect(packageLock.packages["node_modules/pdfjs-dist"]?.version).toBe(packageJson.dependencies["pdfjs-dist"]);
    expect(installedPdfJsPackages).toHaveLength(1);
  });
});
