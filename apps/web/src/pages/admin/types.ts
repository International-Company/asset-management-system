export type Status = 'ACTIVE' | 'INACTIVE';

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  status: Status;
}

export interface Role extends RoleSummary {
  description: string | null;
  isSystem: boolean;
  permissionKeys: string[];
  activeUserCount: number;
}

export interface UserRow {
  id: string;
  username: string;
  isActive: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  employee: { id: string; eapEmployeeId: string; fullName: string; jobTitle: string | null; email: string | null; isActive: boolean };
  roles: RoleSummary[];
}

export interface DirectoryEntry {
  eapEmployeeId: string;
  fullName: string;
  jobTitle: string | null;
  email: string | null;
  isActive: boolean;
  employeeId: string | null;
  user: { id: string; username: string } | null;
}
