import type { AssetStatus, MainCategoryCode } from '@osooli/shared';

export interface AssetListItem {
  id: string;
  assetNumber: string;
  name: string;
  mainCategory: MainCategoryCode;
  serialNumber: string;
  status: AssetStatus;
  createdAt: string;
  updatedAt: string;
  subcategory: { id: string; name: string };
  locationDepartment: { location: { id: string; name: string }; department: { id: string; name: string } };
  responsibleEmployee: { id: string; fullName: string; isActive: boolean } | null;
  responsibleExternal: { id: string; name: string } | null;
  technical: { macAddress: string | null; ipAddress: string | null } | null;
  mainPhotoFileId: string | null;
}

export interface Technical {
  manufacturer: string | null;
  model: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  operatingSystem: string | null;
  specifications: string | null;
}

export interface RealEstate {
  propertyType: string | null;
  propertyName: string | null;
  locationText: string | null;
  area: string | null;
  propertyNumber: string | null;
  parcelNumber: string | null;
  ownershipDeed: string | null;
  ownershipDate: string | null;
  ownershipNotes: string | null;
}

export interface AssetDetail {
  id: string;
  assetNumber: string;
  name: string;
  mainCategory: MainCategoryCode;
  serialNumber: string;
  serialIsInternal: boolean;
  qrToken: string;
  status: AssetStatus;
  notes: string | null;
  purchaseDate: string | null;
  supplier: string | null;
  invoiceNumber: string | null;
  purchaseValue: string | null;
  purchaseCurrency: string | null;
  warrantyExists: boolean;
  warrantyExpiresAt: string | null;
  warrantyDetails: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  category: { code: MainCategoryCode; nameAr: string };
  subcategory: { id: string; name: string; status: string };
  locationDepartment: {
    status: string;
    location: { id: string; name: string; status: string };
    department: { id: string; name: string; status: string };
  };
  responsibleEmployee: { id: string; eapEmployeeId: string; fullName: string; jobTitle: string | null; isActive: boolean } | null;
  responsibleExternal: { id: string; name: string; organization: string | null; phone: string | null; status: string } | null;
  technical: Technical | null;
  realEstate: RealEstate | null;
  numberHistory: Array<{ id: string; assetNumber: string; mainCategory: MainCategoryCode; assignedAt: string; retiredAt: string | null; reason: string | null }>;
  serialHistory: Array<{ id: string; oldSerial: string; newSerial: string; reason: string | null; createdAt: string }>;
  photos: Array<{ id: string; isMain: boolean; createdAt: string; file: { id: string; originalName: string } }>;
  sale: { id: string; number: string; saleDate: string } | null;
  canDelete: boolean;
}

export interface CategoryLookup {
  code: MainCategoryCode;
  nameAr: string;
  subcategories: Array<{ id: string; name: string }>;
}

export interface LocationLookup {
  id: string;
  name: string;
  departments: Array<{ id: string; name: string }>;
}

export interface CurrencyLookup {
  code: string;
  nameAr: string;
  symbol: string | null;
}

export type Responsible =
  | { type: 'EMPLOYEE'; eapEmployeeId: string; label: string }
  | { type: 'EXTERNAL'; externalPersonId: string; label: string };
