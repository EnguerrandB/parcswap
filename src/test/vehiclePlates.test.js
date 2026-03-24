import { describe, expect, it } from 'vitest';

import {
  formatStoredVehiclePlate,
  formatVehiclePlate,
  getDefaultPlateCountry,
  inferPlateCountryFromPlate,
  isValidVehiclePlate,
} from '../utils/vehiclePlates';

describe('vehicle plate helpers', () => {
  it('formats and validates french plates', () => {
    const plate = formatVehiclePlate('ab123cd', 'fr');
    expect(plate).toBe('AB-123-CD');
    expect(isValidVehiclePlate(plate, 'fr')).toBe(true);
  });

  it('formats and validates uk plates', () => {
    const plate = formatVehiclePlate('ab12cde', 'gb');
    expect(plate).toBe('AB12 CDE');
    expect(isValidVehiclePlate(plate, 'gb')).toBe(true);
  });

  it('formats and validates israeli 7 and 8 digit plates', () => {
    expect(formatVehiclePlate('1234567', 'il')).toBe('12-345-67');
    expect(formatVehiclePlate('12345678', 'il')).toBe('123-45-678');
    expect(isValidVehiclePlate('12-345-67', 'il')).toBe(true);
    expect(isValidVehiclePlate('123-45-678', 'il')).toBe(true);
  });

  it('infers country from stored plate values', () => {
    expect(inferPlateCountryFromPlate('AB-123-CD')).toBe('fr');
    expect(inferPlateCountryFromPlate('AB12 CDE')).toBe('gb');
    expect(inferPlateCountryFromPlate('123-45-678')).toBe('il');
  });

  it('reformats stored values and picks a sensible default country from language', () => {
    expect(formatStoredVehiclePlate('ab12cde', 'gb')).toBe('AB12 CDE');
    expect(getDefaultPlateCountry('en-GB')).toBe('gb');
    expect(getDefaultPlateCountry('he-IL')).toBe('il');
    expect(getDefaultPlateCountry('fr-FR')).toBe('fr');
  });
});