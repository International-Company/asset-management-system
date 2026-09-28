import { z } from 'zod';
import type { SettingKey } from './settings.defaults';

/**
 * File types the administrator may allow (spec §36, §72). Executable and
 * script-capable formats (exe, js, html, svg, …) are deliberately absent.
 */
export const ALLOWABLE_EXTENSIONS = [
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
  'txt',
] as const;

const name = z.string().trim().min(1).max(200);
const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** Per-key validation for writable settings. `company.logoFileId` is set by the logo upload flow. */
export const SETTING_VALIDATORS: Partial<Record<SettingKey, z.ZodType>> = {
  'company.nameAr': name,
  'company.nameEn': name,
  'currency.default': z.string().regex(/^[A-Z]{3}$/),
  'files.maxSizeMb': int(1, 100),
  'files.allowedExtensions': z.array(z.enum(ALLOWABLE_EXTENSIONS)).min(1).refine((a) => new Set(a).size === a.length),
  'security.maxFailedAttempts': int(3, 20),
  'security.lockoutMinutes': int(1, 1440),
  'security.sessionIdleMinutes': int(5, 480),
  'security.sessionMaxHours': int(1, 72),
};

/** Arabic explanation of each rule, shown next to the field when validation fails. */
export const SETTING_RULES_AR: Partial<Record<SettingKey, string>> = {
  'company.nameAr': 'نص من 1 إلى 200 حرف.',
  'company.nameEn': 'نص من 1 إلى 200 حرف.',
  'currency.default': 'يجب اختيار عملة فعّالة.',
  'files.maxSizeMb': 'رقم صحيح من 1 إلى 100 ميغابايت.',
  'files.allowedExtensions': 'نوع واحد على الأقل من الأنواع المسموح بها، دون تكرار.',
  'security.maxFailedAttempts': 'رقم صحيح من 3 إلى 20.',
  'security.lockoutMinutes': 'رقم صحيح من 1 إلى 1440 دقيقة.',
  'security.sessionIdleMinutes': 'رقم صحيح من 5 إلى 480 دقيقة.',
  'security.sessionMaxHours': 'رقم صحيح من 1 إلى 72 ساعة.',
};
