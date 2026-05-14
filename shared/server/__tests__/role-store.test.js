import { describe, it, expect, beforeEach } from 'vitest'

const { createRoleStore } = require('../role-store');

function createInMemoryStore(initial = {}) {
  const data = { ...initial };
  return {
    read(file) { return data[file] ? JSON.parse(JSON.stringify(data[file])) : null; },
    write(file, content) { data[file] = JSON.parse(JSON.stringify(content)); },
    raw: data
  };
}

describe('role-store', () => {
  let store, memStore;

  beforeEach(() => {
    memStore = createInMemoryStore();
    store = createRoleStore(
      (f) => memStore.read(f),
      (f, d) => memStore.write(f, d)
    );
  });

  describe('getRoles — exact match', () => {
    it('returns roles for exact email match', () => {
      store.assignRole('alice@redhat.com', 'admin', 'test');
      expect(store.getRoles('alice@redhat.com')).toEqual(['admin']);
    });

    it('returns empty array for unknown email', () => {
      expect(store.getRoles('nobody@redhat.com')).toEqual([]);
    });

    it('returns empty array for null/undefined', () => {
      expect(store.getRoles(null)).toEqual([]);
      expect(store.getRoles(undefined)).toEqual([]);
    });
  });

  describe('getRoles — cross-domain fallback', () => {
    it('matches by local part when domain differs', () => {
      store.assignRole('alice@redhat.com', 'admin', 'test');
      expect(store.getRoles('alice@cluster.local')).toEqual(['admin']);
    });

    it('matches cluster.local assignment from redhat.com lookup', () => {
      store.assignRole('bob@cluster.local', 'team-admin', 'test');
      expect(store.getRoles('bob@redhat.com')).toEqual(['team-admin']);
    });

    it('prefers exact match over local-part fallback', () => {
      store.assignRole('carol@redhat.com', 'admin', 'test');
      store.assignRole('carol@cluster.local', 'team-admin', 'test');
      expect(store.getRoles('carol@redhat.com')).toEqual(['admin']);
      expect(store.getRoles('carol@cluster.local')).toEqual(['team-admin']);
    });

    it('is case-insensitive', () => {
      store.assignRole('Dave@Redhat.com', 'admin', 'test');
      expect(store.getRoles('dave@cluster.local')).toEqual(['admin']);
    });
  });

  describe('hasRole — cross-domain fallback', () => {
    it('finds role via local-part fallback', () => {
      store.assignRole('eve@redhat.com', 'admin', 'test');
      expect(store.hasRole('eve@cluster.local', 'admin')).toBe(true);
      expect(store.hasRole('eve@cluster.local', 'team-admin')).toBe(false);
    });
  });

  describe('assignRole', () => {
    it('rejects invalid roles', () => {
      expect(() => store.assignRole('a@b.com', 'superuser', 'test'))
        .toThrow(/Invalid role/);
    });

    it('does not duplicate roles on repeat assignment', () => {
      store.assignRole('f@redhat.com', 'admin', 'test');
      store.assignRole('f@redhat.com', 'admin', 'test');
      expect(store.getRoles('f@redhat.com')).toEqual(['admin']);
    });
  });

  describe('revokeRole', () => {
    it('removes a role from a user', () => {
      store.assignRole('g@redhat.com', 'admin', 'test');
      store.assignRole('g@redhat.com', 'team-admin', 'test');
      store.revokeRole('g@redhat.com', 'team-admin', 'test');
      expect(store.getRoles('g@redhat.com')).toEqual(['admin']);
    });

    it('cleans up entry when last role is removed', () => {
      store.assignRole('h@redhat.com', 'admin', 'test');
      store.assignRole('other@redhat.com', 'admin', 'test');
      store.revokeRole('h@redhat.com', 'admin', 'test');
      expect(store.getRoles('h@redhat.com')).toEqual([]);
    });

    it('prevents removing the last admin', () => {
      store.assignRole('solo@redhat.com', 'admin', 'test');
      expect(() => store.revokeRole('solo@redhat.com', 'admin', 'test'))
        .toThrow(/Cannot remove the last admin/);
    });
  });

  describe('getAdminEmails', () => {
    it('returns emails with admin role', () => {
      store.assignRole('a1@redhat.com', 'admin', 'test');
      store.assignRole('a2@redhat.com', 'team-admin', 'test');
      expect(store.getAdminEmails()).toEqual(['a1@redhat.com']);
    });
  });
});
