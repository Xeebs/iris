import type { SemanticEntity } from '@iris/connector-sdk';

export interface SalesforceContact {
  Id: string;
  FirstName: string | null;
  LastName: string;
  Email: string | null;
  Phone: string | null;
  Title: string | null;
  AccountId: string | null;
  OwnerId: string | null;
  LeadSource: string | null;
  LastModifiedDate: string;
}

export interface SalesforceAccount {
  Id: string;
  Name: string;
  Industry: string | null;
  Website: string | null;
  Phone: string | null;
  BillingCity: string | null;
  BillingCountry: string | null;
  NumberOfEmployees: number | null;
  AnnualRevenue: number | null;
  OwnerId: string | null;
  LastModifiedDate: string;
}

export interface SalesforceOpportunity {
  Id: string;
  Name: string;
  AccountId: string | null;
  StageName: string;
  Amount: number | null;
  CloseDate: string;
  Probability: number | null;
  OwnerId: string | null;
  LeadSource: string | null;
  LastModifiedDate: string;
}

/**
 * @param contact - Raw Salesforce Contact object
 * @returns SemanticEntity representation
 */
export function transformContact(contact: SalesforceContact): SemanticEntity {
  const firstName = contact.FirstName ?? '';
  const label = `${firstName} ${contact.LastName}`.trim() || `Contact ${contact.Id}`;

  return {
    id: `salesforce:contact:${contact.Id}`,
    type: 'contact',
    label,
    attributes: {
      email: contact.Email,
      phone: contact.Phone,
      title: contact.Title,
      leadSource: contact.LeadSource,
      ownerId: contact.OwnerId,
    },
    relationships: contact.AccountId
      ? [{ type: 'belongs_to', targetId: `salesforce:account:${contact.AccountId}` }]
      : [],
    lastModified: new Date(contact.LastModifiedDate),
    sourceId: `salesforce:contact:${contact.Id}`,
  };
}

/**
 * @param account - Raw Salesforce Account object
 * @returns SemanticEntity representation
 */
export function transformAccount(account: SalesforceAccount): SemanticEntity {
  return {
    id: `salesforce:account:${account.Id}`,
    type: 'account',
    label: account.Name,
    attributes: {
      industry: account.Industry,
      website: account.Website,
      phone: account.Phone,
      city: account.BillingCity,
      country: account.BillingCountry,
      employees: account.NumberOfEmployees,
      annualRevenue: account.AnnualRevenue,
      ownerId: account.OwnerId,
    },
    relationships: [],
    lastModified: new Date(account.LastModifiedDate),
    sourceId: `salesforce:account:${account.Id}`,
  };
}

/**
 * @param opp - Raw Salesforce Opportunity object
 * @returns SemanticEntity representation
 */
export function transformOpportunity(opp: SalesforceOpportunity): SemanticEntity {
  return {
    id: `salesforce:opportunity:${opp.Id}`,
    type: 'opportunity',
    label: opp.Name,
    attributes: {
      stage: opp.StageName,
      amount: opp.Amount,
      closeDate: opp.CloseDate,
      probability: opp.Probability,
      leadSource: opp.LeadSource,
      ownerId: opp.OwnerId,
    },
    relationships: opp.AccountId
      ? [{ type: 'belongs_to', targetId: `salesforce:account:${opp.AccountId}` }]
      : [],
    lastModified: new Date(opp.LastModifiedDate),
    sourceId: `salesforce:opportunity:${opp.Id}`,
  };
}
