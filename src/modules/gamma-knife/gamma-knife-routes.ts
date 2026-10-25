import { Router, type Response } from 'express';
import QRCode from 'qrcode';
import { requireAuth } from '../../middleware/auth.js';
import { createRateLimiter } from '../../middleware/rate-limit.js';
import { asyncRoute } from '../../utils/async-route.js';
import { readDocumentContent } from '../../services/document-service.js';
import { searchPatients } from '../../services/patient-service.js';
import { tryGetPublicAppBaseUrl } from '../../config/public-app-url.js';
import { HttpError } from '../../utils/http-error.js';
import { authorize, changeEpisode, createEpisode, episodeDocument, listEpisodes, permissions, profile, publicDocument, publicEpisode, readConfig, saveSettings, settings, uploadEpisodeDocument } from './gamma-knife-service.js';
import { text } from './gamma-knife-validation.js';

export const gammaKnifeRouter = Router();
export const gammaKnifePublicRouter = Router();
function privateResponse(res: Response) { res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff'); }
gammaKnifeRouter.use(requireAuth, (_req, res, next) => { privateResponse(res); next(); });
gammaKnifeRouter.get('/me', asyncRoute(async (req, res) => { res.json({ permissions: await permissions(req.user!), canManageSettings: ['supervisor','super_admin'].includes(req.user!.role) }); }));
gammaKnifeRouter.get('/settings', asyncRoute(async (req, res) => { res.json(await settings(req.user!)); }));
gammaKnifeRouter.put('/settings', asyncRoute(async (req, res) => { res.json(await saveSettings(req.user!, req.body)); }));
gammaKnifeRouter.get('/patients', asyncRoute(async (req, res) => { await authorize(req.user!, 'referral'); const q = text(req.query.q, 'Search', false, 100); const patients = q.length >= 2 ? await searchPatients(q) : []; res.json({ patients: patients.slice(0, 30).map(p => ({ id: Number(p.id), mrn: p.mrn, name: p.english_full_name || p.arabic_full_name, arabicName: p.arabic_full_name, englishName: p.english_full_name })) }); }));
gammaKnifeRouter.get('/episodes', asyncRoute(async (req, res) => { res.json({ episodes: await listEpisodes(req.user!, text(req.query.q, 'Search', false, 100), text(req.query.status, 'Status', false, 30)), config: await (async () => { await authorize(req.user!); return readConfig(); })() }); }));
gammaKnifeRouter.post('/episodes', asyncRoute(async (req, res) => { res.status(201).json({ episode: await createEpisode(req.user!, req.body) }); }));
gammaKnifeRouter.get('/episodes/:id', asyncRoute(async (req, res) => { res.json(await profile(req.user!, req.params.id)); }));
gammaKnifeRouter.post('/episodes/:id/actions/:action', asyncRoute(async (req, res) => {
  const publicBase = req.params.action === 'qr_replace' ? await tryGetPublicAppBaseUrl() : '';
  if (req.params.action === 'qr_replace' && !publicBase) throw new HttpError(409, 'Configure the public RISpro URL in settings before creating a QR code.');
  const result = await changeEpisode(req.user!, req.params.id, String(req.params.action), req.body);
  if (result.token) {
    const url = `${publicBase}/public/gamma-knife#${result.token}`;
    res.json({ ...result, url, qrImage: await QRCode.toDataURL(url, { width: 256, margin: 2 }) });
  } else res.json(result);
}));
gammaKnifeRouter.post('/episodes/:id/documents', asyncRoute(async (req, res) => { res.status(201).json(await uploadEpisodeDocument(req.user!, req.params.id, req.body)); }));
gammaKnifeRouter.get('/episodes/:id/documents/:documentId', asyncRoute(async (req, res) => {
  const document = await episodeDocument(req.user!, req.params.id, req.params.documentId);
  const content = await readDocumentContent(document);
  // Recheck membership immediately before sending storage content.
  await authorize(req.user!);
  res.setHeader('Content-Type', document.mime_type); res.setHeader('Content-Disposition', 'inline'); res.send(content);
}));

gammaKnifePublicRouter.use(createRateLimiter({ windowMs: 60_000, maxRequests: 30, message: 'Too many requests. Please try again later.' }), (_req, res, next) => { privateResponse(res); next(); });
function bearer(header: string | undefined) { return header?.startsWith('Bearer ') ? header.slice(7) : ''; }
gammaKnifePublicRouter.get('/', asyncRoute(async (req, res) => { const { episodeId: _internalEpisodeId, ...view } = await publicEpisode(bearer(req.headers.authorization)); res.json(view); }));
gammaKnifePublicRouter.get('/documents/:documentId', asyncRoute(async (req, res) => { const result = await publicDocument(bearer(req.headers.authorization), req.params.documentId); res.setHeader('Content-Type', result.document.mime_type); res.setHeader('Content-Disposition', 'inline'); res.send(result.content); }));
