import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { TeachingAssetInput, TeachingAuditIdentity } from "../domain/teaching-content.js";
import { createTeachingAssetInTransaction } from "./teaching-content-service.js";
import { withTeachingTransaction } from "./teaching-transaction.js";
import { promoteTeachingAssetBytes, receiveTeachingImageUpload, removePromotedTeachingAsset } from "../import/staging-service.js";

export async function createTeachingAssetFromUpload(req: Request, actor: TeachingAuditIdentity) {
  const upload = await receiveTeachingImageUpload(req);
  const permanent = await promoteTeachingAssetBytes(upload);
  const input: TeachingAssetInput = {
    assetKey: `manual-${randomUUID()}`,
    storageKey: permanent.storageKey,
    mimeType: upload.mimeType,
    originalFilename: upload.filename,
    altText: "",
    sizeBytes: upload.bytes.length,
  };
  try {
    const id = await withTeachingTransaction((client) => createTeachingAssetInTransaction(client, input, actor));
    return { id, mimeType: input.mimeType, originalFilename: input.originalFilename, altText: input.altText, sizeBytes: input.sizeBytes };
  } catch (error) {
    await removePromotedTeachingAsset(permanent.absolutePath);
    throw error;
  }
}
