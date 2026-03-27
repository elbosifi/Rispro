import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { listDocuments, uploadDocument } from "../services/document-service.js";

export const documentsRouter = express.Router();

documentsRouter.use(requireAuth);

documentsRouter.get("/", async (req, res, next) => {
  try {
    const documents = await listDocuments({
      patientId: req.query.patientId,
      appointmentId: req.query.appointmentId
    });
    res.json({ documents });
  } catch (error) {
    next(error);
  }
});

documentsRouter.post("/", async (req, res, next) => {
  try {
    const document = await uploadDocument(req.body || {}, req.user.sub);
    res.status(201).json({ document });
  } catch (error) {
    next(error);
  }
});
