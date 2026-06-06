import type { SemanticEntity } from '@iris/connector-sdk';

// ─── Raw NetSuite API types ───────────────────────────────────────────────────

export type NetSuiteRef = {
  id: string;
  refName?: string;
};

export type NetSuiteCustomer = {
  id: string;
  companyName?: string;
  entityId: string;
  email?: string;
  phone?: string;
  subsidiary?: NetSuiteRef;
  status?: NetSuiteRef;
  lastModifiedDate: string;
};

export type NetSuiteVendor = {
  id: string;
  companyName?: string;
  entityId: string;
  email?: string;
  phone?: string;
  subsidiary?: NetSuiteRef;
  lastModifiedDate: string;
};

export type NetSuiteItem = {
  id: string;
  itemId: string;
  displayName?: string;
  itemType: string;
  salesDescription?: string;
  basePrice?: number;
  subsidiary?: NetSuiteRef;
  lastModifiedDate: string;
};

export type NetSuiteTransaction = {
  id: string;
  transactionNumber?: string;
  type: string;
  status?: NetSuiteRef;
  entity?: NetSuiteRef;
  amount?: number;
  currency?: NetSuiteRef;
  tranDate: string;
  lastModifiedDate: string;
};

// ─── Transformers ─────────────────────────────────────────────────────────────

/**
 * Transform a NetSuite customer to a SemanticEntity.
 * Excludes PII email/phone from attributes.
 *
 * @param customer - Raw NetSuite customer record
 * @returns Compact SemanticEntity
 */
export function transformCustomer(customer: NetSuiteCustomer): SemanticEntity {
  return {
    id: `netsuite:customer:${customer.id}`,
    type: 'customer',
    label: customer.companyName ?? customer.entityId,
    attributes: {
      entityId: customer.entityId,
      subsidiary: customer.subsidiary?.refName ?? null,
      status: customer.status?.refName ?? null,
    },
    relationships: [],
    lastModified: new Date(customer.lastModifiedDate),
    sourceId: `netsuite:customer:${customer.id}`,
  };
}

/**
 * Transform a NetSuite vendor to a SemanticEntity.
 *
 * @param vendor - Raw NetSuite vendor record
 * @returns Compact SemanticEntity
 */
export function transformVendor(vendor: NetSuiteVendor): SemanticEntity {
  return {
    id: `netsuite:vendor:${vendor.id}`,
    type: 'vendor',
    label: vendor.companyName ?? vendor.entityId,
    attributes: {
      entityId: vendor.entityId,
      subsidiary: vendor.subsidiary?.refName ?? null,
    },
    relationships: [],
    lastModified: new Date(vendor.lastModifiedDate),
    sourceId: `netsuite:vendor:${vendor.id}`,
  };
}

/**
 * Transform a NetSuite inventory item to a SemanticEntity.
 *
 * @param item - Raw NetSuite item record
 * @returns Compact SemanticEntity
 */
export function transformItem(item: NetSuiteItem): SemanticEntity {
  return {
    id: `netsuite:item:${item.id}`,
    type: 'item',
    label: item.displayName ?? item.itemId,
    attributes: {
      itemId: item.itemId,
      itemType: item.itemType,
      description: item.salesDescription ?? null,
      basePrice: item.basePrice ?? null,
      subsidiary: item.subsidiary?.refName ?? null,
    },
    relationships: [],
    lastModified: new Date(item.lastModifiedDate),
    sourceId: `netsuite:item:${item.id}`,
  };
}

/**
 * Transform a NetSuite transaction to a SemanticEntity.
 *
 * @param txn - Raw NetSuite transaction record
 * @returns Compact SemanticEntity
 */
export function transformTransaction(txn: NetSuiteTransaction): SemanticEntity {
  const relationships: SemanticEntity['relationships'] = [];
  if (txn.entity) {
    relationships.push({ type: 'involves', targetId: `netsuite:customer:${txn.entity.id}` });
  }

  return {
    id: `netsuite:transaction:${txn.id}`,
    type: 'transaction',
    label: `${txn.type} ${txn.transactionNumber ?? txn.id}`,
    attributes: {
      transactionType: txn.type,
      status: txn.status?.refName ?? null,
      amount: txn.amount ?? null,
      currency: txn.currency?.refName ?? null,
      tranDate: txn.tranDate,
    },
    relationships,
    lastModified: new Date(txn.lastModifiedDate),
    sourceId: `netsuite:transaction:${txn.id}`,
  };
}
