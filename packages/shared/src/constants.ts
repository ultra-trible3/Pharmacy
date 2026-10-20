/** Domain enumerations shared by the API, the Electron shell and the renderer. */

export const DOSAGE_FORMS = [
  'TABLET',
  'CAPSULE',
  'SYRUP',
  'SUSPENSION',
  'INJECTION',
  'CREAM',
  'OINTMENT',
  'GEL',
  'DROPS',
  'INHALER',
  'SUPPOSITORY',
  'SPRAY',
  'PATCH',
  'SACHET',
  'OTHER',
] as const;
export type DosageForm = (typeof DOSAGE_FORMS)[number];

export const DOSAGE_FORM_LABELS_AR: Record<DosageForm, string> = {
  TABLET: 'أقراص',
  CAPSULE: 'كبسولات',
  SYRUP: 'شراب',
  SUSPENSION: 'معلق',
  INJECTION: 'حقن',
  CREAM: 'كريم',
  OINTMENT: 'مرهم',
  GEL: 'جل',
  DROPS: 'قطرة',
  INHALER: 'بخاخ استنشاق',
  SUPPOSITORY: 'لبوس',
  SPRAY: 'سبراي',
  PATCH: 'لاصقة',
  SACHET: 'أكياس',
  OTHER: 'أخرى',
};

export const PRESCRIPTION_CLASSES = ['OTC', 'PRESCRIPTION', 'CONTROLLED'] as const;
export type PrescriptionClass = (typeof PRESCRIPTION_CLASSES)[number];

export const PRESCRIPTION_CLASS_LABELS_AR: Record<PrescriptionClass, string> = {
  OTC: 'بدون وصفة',
  PRESCRIPTION: 'بوصفة طبية',
  CONTROLLED: 'أدوية مراقبة',
};

export const MOVEMENT_TYPES = [
  'RECEIPT',
  'ISSUE',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'RETURN_IN',
  'RETURN_OUT',
  'COUNT_GAIN',
  'COUNT_LOSS',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS_AR: Record<MovementType, string> = {
  RECEIPT: 'استلام مشتريات',
  ISSUE: 'صرف بيع',
  ADJUSTMENT_IN: 'تسوية زيادة',
  ADJUSTMENT_OUT: 'تسوية نقص',
  TRANSFER_IN: 'تحويل وارد',
  TRANSFER_OUT: 'تحويل صادر',
  RETURN_IN: 'مرتجع من عميل',
  RETURN_OUT: 'مرتجع لمورد',
  COUNT_GAIN: 'زيادة جرد',
  COUNT_LOSS: 'عجز جرد',
};

/** Movement types that increase stock. */
export const INBOUND_MOVEMENTS: readonly MovementType[] = [
  'RECEIPT',
  'ADJUSTMENT_IN',
  'TRANSFER_IN',
  'RETURN_IN',
  'COUNT_GAIN',
];

/** Movement types that decrease stock. */
export const OUTBOUND_MOVEMENTS: readonly MovementType[] = [
  'ISSUE',
  'ADJUSTMENT_OUT',
  'TRANSFER_OUT',
  'RETURN_OUT',
  'COUNT_LOSS',
];

export function isInbound(type: MovementType): boolean {
  return INBOUND_MOVEMENTS.includes(type);
}

/** Business defaults for an Egyptian pharmacy. */
export const BUSINESS_DEFAULTS = {
  timezone: 'Africa/Cairo',
  locale: 'ar-EG',
  currency: 'EGP',
  /** Days before expiry at which a batch is flagged as "near expiry". */
  nearExpiryDays: 90,
  /** Default low-stock threshold when a product does not define its own. */
  defaultMinStock: 5,
} as const;

/** Supported Electron IPC channel names. Kept central to avoid typos/whitelisting gaps. */
export const IPC_CHANNELS = {
  appInfo: 'app:info',
  authLogin: 'auth:login',
  authLogout: 'auth:logout',
  authSession: 'auth:session',
  apiRequest: 'api:request',
} as const;
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
