/**
 * Photo upload validation and storage.
 *
 * Files are written to disk under the configured upload directory. Nothing is
 * reported as uploaded until the bytes are actually on disk.
 *
 * NOTE: automated image *content* analysis is NOT implemented in this build.
 * Uploaded photos are stored with moderation_status='pending' and are listed in
 * the admin review queue. The UI says "pending review" — it does not claim an
 * automated safety scan happened.
 */
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import { all, get, run } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { newId, nowIso } from '../lib/util.js';

const SIGNATURES = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

export function sniffImage(buffer) {
  return SIGNATURES.find((sig) => sig.test(buffer)) || null;
}

/** Decode a data URL, validating mime, size and magic bytes. */
export function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') throw ApiError.badRequest('Photo data is missing.');
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) throw ApiError.badRequest('Photo must be sent as a base64 data URL.');

  const declaredMime = match[1].toLowerCase();
  if (!config.allowedMimeTypes.includes(declaredMime)) {
    throw ApiError.badRequest(`Only ${config.allowedMimeTypes.join(', ')} images are allowed.`, {
      mime: declaredMime,
    });
  }

  let buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    throw ApiError.badRequest('Photo data could not be decoded.');
  }
  if (!buffer.length) throw ApiError.badRequest('Photo data is empty.');
  if (buffer.length > config.maxUploadBytes) {
    throw ApiError.payloadTooLarge(
      `Photos must be smaller than ${(config.maxUploadBytes / 1024 / 1024).toFixed(1)} MB.`
    );
  }

  const signature = sniffImage(buffer);
  if (!signature) throw ApiError.badRequest('That file is not a valid JPEG, PNG or WebP image.');
  if (signature.mime !== declaredMime) {
    throw ApiError.badRequest(`The file contents are ${signature.mime}, not ${declaredMime}.`);
  }
  return { buffer, mime: signature.mime, ext: signature.ext };
}

export function storePhoto(userId, dataUrl) {
  const count = get('SELECT COUNT(*) AS count FROM photos WHERE user_id = ?', [userId]).count;
  if (count >= config.maxPhotosPerUser) {
    throw ApiError.badRequest(`You can upload up to ${config.maxPhotosPerUser} photos.`);
  }

  const { buffer, mime, ext } = decodeDataUrl(dataUrl);
  const id = newId('img');
  const userDir = path.join(config.uploadDir, userId);
  fs.mkdirSync(userDir, { recursive: true });
  const fileName = `${id}.${ext}`;
  const absolute = path.join(userDir, fileName);
  fs.writeFileSync(absolute, buffer);

  // Confirm the write actually landed before claiming success.
  const stat = fs.statSync(absolute);
  if (stat.size !== buffer.length) {
    fs.rmSync(absolute, { force: true });
    throw ApiError.internal('Photo could not be saved. Please try again.');
  }

  const relative = path.join(userId, fileName);
  const position = count;
  run(
    `INSERT INTO photos (id, user_id, path, mime, bytes, position, moderation_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [id, userId, relative, mime, buffer.length, position, nowIso()]
  );
  return { id, url: `/api/photos/${id}/file`, mime, bytes: buffer.length, position, moderationStatus: 'pending' };
}

export function deletePhoto(userId, photoId) {
  const photo = get('SELECT * FROM photos WHERE id = ? AND user_id = ?', [photoId, userId]);
  if (!photo) throw ApiError.notFound('That photo does not exist.');
  fs.rmSync(path.join(config.uploadDir, photo.path), { force: true });
  run('DELETE FROM photos WHERE id = ?', [photoId]);
  return { deleted: true };
}

export function reorderPhotos(userId, orderedIds) {
  const owned = all('SELECT id FROM photos WHERE user_id = ? ORDER BY position', [userId]).map((r) => r.id);
  const requested = orderedIds.filter((id) => owned.includes(id));
  if (requested.length !== owned.length) {
    throw ApiError.badRequest('Reorder must include every one of your photos exactly once.');
  }
  requested.forEach((id, index) => {
    run('UPDATE photos SET position = ? WHERE id = ? AND user_id = ?', [index, id, userId]);
  });
  return { positions: requested.map((id, index) => ({ id, position: index })) };
}

/** Safe absolute path for a stored photo; rejects traversal outside uploadDir. */
export function resolvePhotoPath(storedPath) {
  const absolute = path.resolve(config.uploadDir, storedPath);
  const root = path.resolve(config.uploadDir);
  if (!absolute.startsWith(root + path.sep)) throw ApiError.forbidden('Invalid photo path.');
  return absolute;
}
