// Permissões verificadas SEMPRE no servidor. A interface apenas reflete o que o servidor permite.
export type Role = 'admin' | 'gestor' | 'corretor' | 'assistente' | 'consulta';

export type Permission =
  | 'people.read' | 'people.write' | 'people.document' | 'people.private_notes'
  | 'properties.read' | 'properties.write' | 'properties.internal'
  | 'deals.read' | 'deals.write' | 'deals.all'
  | 'events.read' | 'events.write' | 'events.all'
  | 'reports.read' | 'reports.all'
  | 'contracts.read' | 'contracts.write'
  | 'users.manage' | 'org.manage' | 'audit.read' | 'data.export';

const ALL: Permission[] = [
  'people.read', 'people.write', 'people.document', 'people.private_notes',
  'properties.read', 'properties.write', 'properties.internal',
  'deals.read', 'deals.write', 'deals.all',
  'events.read', 'events.write', 'events.all',
  'reports.read', 'reports.all',
  'contracts.read', 'contracts.write',
  'users.manage', 'org.manage', 'audit.read', 'data.export',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ALL,
  gestor: ALL.filter((p) => p !== 'org.manage'),
  corretor: [
    'people.read', 'people.write', 'people.document', 'people.private_notes',
    'properties.read', 'properties.write', 'properties.internal',
    'deals.read', 'deals.write',
    'events.read', 'events.write',
    'reports.read', 'contracts.read', 'contracts.write',
  ],
  assistente: [
    'people.read', 'people.write',
    'properties.read', 'properties.write',
    'deals.read', 'deals.write',
    'events.read', 'events.write', 'events.all', 'contracts.read',
  ],
  consulta: ['people.read', 'properties.read', 'events.read'],
};

export const can = (role: Role, perm: Permission) => ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
