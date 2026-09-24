/** Small field validator. Collects every problem and reports them together. */
import { ApiError } from './errors.js';
import { ageFromDob, normaliseText } from './util.js';

export class Validator {
  constructor(body = {}) {
    this.body = body && typeof body === 'object' ? body : {};
    this.errors = {};
  }

  fail(field, message) {
    this.errors[field] = message;
    return undefined;
  }

  has(field) {
    return Object.prototype.hasOwnProperty.call(this.body, field) && this.body[field] !== undefined;
  }

  string(field, { required = false, min = 1, max = 500, allowEmpty = false } = {}) {
    if (!this.has(field)) {
      if (required) return this.fail(field, 'This field is required.');
      return undefined;
    }
    const value = normaliseText(this.body[field], max);
    if (!value.length) {
      if (required) return this.fail(field, 'This field is required.');
      return allowEmpty ? '' : undefined;
    }
    if (value.length < min) return this.fail(field, `Must be at least ${min} characters.`);
    return value;
  }

  integer(field, { required = false, min = -Infinity, max = Infinity, fallback } = {}) {
    if (!this.has(field) || this.body[field] === null || this.body[field] === '') {
      if (required) return this.fail(field, 'This field is required.');
      return fallback;
    }
    const value = Number(this.body[field]);
    if (!Number.isInteger(value)) return this.fail(field, 'Must be a whole number.');
    if (value < min || value > max) return this.fail(field, `Must be between ${min} and ${max}.`);
    return value;
  }

  number(field, { required = false, min = -Infinity, max = Infinity, fallback = null } = {}) {
    if (!this.has(field) || this.body[field] === null || this.body[field] === '') {
      if (required) return this.fail(field, 'This field is required.');
      return fallback;
    }
    const value = Number(this.body[field]);
    if (!Number.isFinite(value)) return this.fail(field, 'Must be a number.');
    if (value < min || value > max) return this.fail(field, `Must be between ${min} and ${max}.`);
    return value;
  }

  boolean(field, { fallback = true } = {}) {
    if (!this.has(field)) return fallback;
    const value = this.body[field];
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 1 || value === '1') return true;
    if (value === 'false' || value === 0 || value === '0') return false;
    return this.fail(field, 'Must be true or false.');
  }

  enum(field, allowed, { required = false, fallback } = {}) {
    if (!this.has(field) || this.body[field] === null || this.body[field] === '') {
      if (required) return this.fail(field, 'This field is required.');
      return fallback;
    }
    const value = String(this.body[field]);
    if (!allowed.includes(value)) {
      return this.fail(field, `Choose one of: ${allowed.join(', ')}.`);
    }
    return value;
  }

  /** Accepts only values present in the server-owned taxonomy for `kind`. */
  list(field, { allowedValues, max = 30, required = false, fallback = [] } = {}) {
    if (!this.has(field) || this.body[field] === null) {
      if (required) return this.fail(field, 'Pick at least one option.');
      return fallback;
    }
    const raw = this.body[field];
    if (!Array.isArray(raw)) return this.fail(field, 'Must be a list.');
    const uniqueValues = [...new Set(raw.map((v) => String(v)))];
    if (required && uniqueValues.length === 0) return this.fail(field, 'Pick at least one option.');
    if (uniqueValues.length > max) return this.fail(field, `Choose at most ${max}.`);
    if (allowedValues) {
      const unknown = uniqueValues.filter((v) => !allowedValues.has(v));
      if (unknown.length) return this.fail(field, `Unknown option(s): ${unknown.join(', ')}.`);
    }
    return uniqueValues;
  }

  object(field, { fallback = {} } = {}) {
    if (!this.has(field) || this.body[field] === null) return fallback;
    const value = this.body[field];
    if (typeof value !== 'object' || Array.isArray(value)) return this.fail(field, 'Must be an object.');
    return value;
  }

  /** ISO yyyy-mm-dd; also checks a maximum age so nonsense dates are rejected. */
  isoDate(field, { required = false, minAge = 0, maxAge = 120 } = {}) {
    if (!this.has(field) || !this.body[field]) {
      if (required) return this.fail(field, 'This field is required.');
      return undefined;
    }
    const value = String(this.body[field]).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return this.fail(field, 'Use the format YYYY-MM-DD.');
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return this.fail(field, 'That is not a valid date.');
    if (parsed.getTime() > Date.now()) return this.fail(field, 'Date cannot be in the future.');
    const age = ageFromDob(value);
    if (age === null) return this.fail(field, 'That is not a valid date.');
    if (age < minAge) return this.fail(field, `Must be at least ${minAge} years old.`);
    if (age > maxAge) return this.fail(field, `Please enter a valid date of birth.`);
    return value;
  }

  assertValid() {
    if (Object.keys(this.errors).length) throw ApiError.validation(this.errors);
  }
}
