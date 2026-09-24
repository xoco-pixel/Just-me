/** Serves stored photo bytes. Requires an authenticated session. */
import fs from 'node:fs';
import express from 'express';
import { get } from '../db/index.js';
import { asyncHandler, requireAuth } from '../lib/http.js';
import { ApiError } from '../lib/errors.js';
import { resolvePhotoPath } from '../services/photos.js';

const router = express.Router();

const CONTENT_TYPES = {
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
};

router.get(
  '/:id/file',
  requireAuth,
  asyncHandler(async (req, res) => {
    const photo = get('SELECT * FROM photos WHERE id = ?', [req.params.id]);
    if (!photo) throw ApiError.notFound('That photo does not exist.');
    const absolute = resolvePhotoPath(photo.path);
    if (!fs.existsSync(absolute)) throw ApiError.notFound('The photo file is missing from storage.');
    res.setHeader('Content-Type', CONTENT_TYPES[photo.mime] || 'application/octet-stream');
    res.setHeader('Content-Length', photo.bytes);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(absolute).pipe(res);
  })
);

export default router;
