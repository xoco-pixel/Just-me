/** Public vocabularies the UI is allowed to offer. Values come from the database. */
import express from 'express';
import { asyncHandler } from '../lib/http.js';
import { listTaxonomy } from '../lib/taxonomy.js';
import config from '../config.js';

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      interests: listTaxonomy('interest'),
      intentions: listTaxonomy('intention'),
      genders: listTaxonomy('gender'),
      languages: listTaxonomy('language'),
      countries: listTaxonomy('country'),
      contactTypes: listTaxonomy('contact_type'),
      reportCategories: listTaxonomy('report_category'),
      searchModes: [
        { value: 'nearby', label: 'Nearby', emoji: '📍' },
        { value: 'city', label: 'My city', emoji: '🏙️' },
        { value: 'country', label: 'My country', emoji: '🗺️' },
        { value: 'countries', label: 'Selected countries', emoji: '🌍' },
        { value: 'worldwide', label: 'Worldwide', emoji: '🌎' },
        { value: 'radius', label: 'Custom radius', emoji: '🎯' },
      ],
      radiusOptions: [5, 10, 25, 50, 100, 250, 500],
      minimumAge: config.minimumAge,
    });
  })
);

export default router;
