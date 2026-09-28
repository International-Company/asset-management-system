/**
 * Global settings managed by the System Administrator (spec §64).
 * Defaults are written once by BootstrapService; later edits are kept.
 */
export interface SettingsShape {
  'company.nameAr': string;
  'company.nameEn': string;
  'company.logoFileId': string | null;
  'currency.default': string;
  'files.maxSizeMb': number;
  'files.allowedExtensions': string[];
  'security.maxFailedAttempts': number;
  'security.lockoutMinutes': number;
  'security.sessionIdleMinutes': number;
  'security.sessionMaxHours': number;
}

export type SettingKey = keyof SettingsShape;

export const SETTINGS_DEFAULTS: SettingsShape = {
  'company.nameAr': 'اسم الشركة',
  'company.nameEn': 'Company Name',
  'company.logoFileId': null,
  'currency.default': 'ILS',
  'files.maxSizeMb': 10,
  'files.allowedExtensions': ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx'],
  'security.maxFailedAttempts': 5,
  'security.lockoutMinutes': 15,
  'security.sessionIdleMinutes': 30,
  'security.sessionMaxHours': 12,
};

/** Changes to these keys are also written to the Security Log. */
export const SECURITY_SETTING_KEYS: ReadonlySet<SettingKey> = new Set([
  'security.maxFailedAttempts',
  'security.lockoutMinutes',
  'security.sessionIdleMinutes',
  'security.sessionMaxHours',
]);
