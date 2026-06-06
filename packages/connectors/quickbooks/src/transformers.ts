import type { SemanticEntity } from '@iris/connector-sdk';

// ─── Raw QuickBooks API types ─────────────────────────────────────────────────

export type QBRef = {
  value: string;
  name?: string;
};

export type QBMetadata = {
  CreateTime: string;
  LastUpdatedTime: string;
};

export type QBCustomer = {
  Id: string;
  DisplayName: string;
  CompanyName?: string;
  Active: boolean;
  Balance?: number;
  CurrencyRef?: QBRef;
  MetaData: QBMetadata;
};

export type QBVendor = {
  Id: string;
  DisplayName: string;
  CompanyName?: string;
  Active: boolean;
  Balance?: number;
  CurrencyRef?: QBRef;
  MetaData: QBMetadata;
};

export type QBLine = {
  Amount: number;
  DetailType: string;
  SalesItemLineDetail?: { ItemRef?: QBRef };
  AccountBasedExpenseLineDetail?: { AccountRef?: QBRef };
};

export type QBInvoice = {
  Id: string;
  DocNumber?: string;
  CustomerRef: QBRef;
  TotalAmt: number;
  Balance: number;
  DueDate?: string;
  TxnDate: string;
  CurrencyRef?: QBRef;
  EmailStatus?: string;
  MetaData: QBMetadata;
};

export type QBExpense = {
  Id: string;
  PaymentType?: string;
  EntityRef?: QBRef;
  TotalAmt: number;
  TxnDate: string;
  CurrencyRef?: QBRef;
  Line?: QBLine[];
  MetaData: QBMetadata;
};

// ─── Transformers ─────────────────────────────────────────────────────────────

/**
 * Transform a QuickBooks customer to a SemanticEntity.
 *
 * @param customer - Raw QuickBooks customer object
 * @returns Compact SemanticEntity suitable for embedding and retrieval
 */
export function transformCustomer(customer: QBCustomer): SemanticEntity {
  return {
    id: `quickbooks:customer:${customer.Id}`,
    type: 'customer',
    label: customer.DisplayName,
    attributes: {
      companyName: customer.CompanyName ?? null,
      active: customer.Active,
      balance: customer.Balance ?? null,
      currency: customer.CurrencyRef?.name ?? null,
    },
    relationships: [],
    lastModified: new Date(customer.MetaData.LastUpdatedTime),
    sourceId: `quickbooks:customer:${customer.Id}`,
  };
}

/**
 * Transform a QuickBooks vendor to a SemanticEntity.
 *
 * @param vendor - Raw QuickBooks vendor object
 * @returns Compact SemanticEntity
 */
export function transformVendor(vendor: QBVendor): SemanticEntity {
  return {
    id: `quickbooks:vendor:${vendor.Id}`,
    type: 'vendor',
    label: vendor.DisplayName,
    attributes: {
      companyName: vendor.CompanyName ?? null,
      active: vendor.Active,
      balance: vendor.Balance ?? null,
      currency: vendor.CurrencyRef?.name ?? null,
    },
    relationships: [],
    lastModified: new Date(vendor.MetaData.LastUpdatedTime),
    sourceId: `quickbooks:vendor:${vendor.Id}`,
  };
}

/**
 * Transform a QuickBooks invoice to a SemanticEntity.
 *
 * @param invoice - Raw QuickBooks invoice object
 * @returns Compact SemanticEntity
 */
export function transformInvoice(invoice: QBInvoice): SemanticEntity {
  return {
    id: `quickbooks:invoice:${invoice.Id}`,
    type: 'invoice',
    label: `Invoice ${invoice.DocNumber ?? invoice.Id}`,
    attributes: {
      totalAmount: invoice.TotalAmt,
      balance: invoice.Balance,
      txnDate: invoice.TxnDate,
      dueDate: invoice.DueDate ?? null,
      currency: invoice.CurrencyRef?.name ?? null,
      emailStatus: invoice.EmailStatus ?? null,
    },
    relationships: [
      { type: 'billed_to', targetId: `quickbooks:customer:${invoice.CustomerRef.value}` },
    ],
    lastModified: new Date(invoice.MetaData.LastUpdatedTime),
    sourceId: `quickbooks:invoice:${invoice.Id}`,
  };
}

/**
 * Transform a QuickBooks expense to a SemanticEntity.
 *
 * @param expense - Raw QuickBooks expense/purchase object
 * @returns Compact SemanticEntity
 */
export function transformExpense(expense: QBExpense): SemanticEntity {
  const relationships: SemanticEntity['relationships'] = [];
  if (expense.EntityRef) {
    relationships.push({ type: 'paid_to', targetId: `quickbooks:vendor:${expense.EntityRef.value}` });
  }

  return {
    id: `quickbooks:expense:${expense.Id}`,
    type: 'expense',
    label: `Expense ${expense.Id}`,
    attributes: {
      paymentType: expense.PaymentType ?? null,
      totalAmount: expense.TotalAmt,
      txnDate: expense.TxnDate,
      currency: expense.CurrencyRef?.name ?? null,
    },
    relationships,
    lastModified: new Date(expense.MetaData.LastUpdatedTime),
    sourceId: `quickbooks:expense:${expense.Id}`,
  };
}
