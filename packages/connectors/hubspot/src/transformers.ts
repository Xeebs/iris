import type { SemanticEntity } from '@iris/connector-sdk';

export interface HubSpotContact {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    company?: string;
    phone?: string;
    lifecyclestage?: string;
    hubspot_owner_id?: string;
    hs_lead_status?: string;
    lastmodifieddate?: string;
    associatedcompanyid?: string;
  };
}

export interface HubSpotCompany {
  id: string;
  properties: {
    name?: string;
    domain?: string;
    industry?: string;
    city?: string;
    country?: string;
    numberofemployees?: string;
    annualrevenue?: string;
    hs_lastmodifieddate?: string;
    hubspot_owner_id?: string;
  };
}

export interface HubSpotDeal {
  id: string;
  properties: {
    dealname?: string;
    amount?: string;
    dealstage?: string;
    pipeline?: string;
    closedate?: string;
    hs_lastmodifieddate?: string;
    hubspot_owner_id?: string;
    associatedcompanyid?: string;
  };
}

/**
 * @param contact - Raw HubSpot contact object from the API
 * @returns SemanticEntity representation of the contact
 */
export function transformContact(contact: HubSpotContact): SemanticEntity {
  const p = contact.properties;
  const firstName = p.firstname ?? '';
  const lastName = p.lastname ?? '';
  const label = `${firstName} ${lastName}`.trim() || `Contact ${contact.id}`;

  return {
    id: `hubspot:contact:${contact.id}`,
    type: 'contact',
    label,
    attributes: {
      company: p.company ?? null,
      stage: p.lifecyclestage ?? null,
      leadStatus: p.hs_lead_status ?? null,
      owner: p.hubspot_owner_id ?? null,
      phone: p.phone ?? null,
    },
    relationships: p.associatedcompanyid
      ? [{ type: 'belongs_to', targetId: `hubspot:company:${p.associatedcompanyid}` }]
      : [],
    lastModified: p.lastmodifieddate ? new Date(p.lastmodifieddate) : new Date(0),
    sourceId: `hubspot:contact:${contact.id}`,
  };
}

/**
 * @param company - Raw HubSpot company object from the API
 * @returns SemanticEntity representation of the company
 */
export function transformCompany(company: HubSpotCompany): SemanticEntity {
  const p = company.properties;
  const label = p.name ?? `Company ${company.id}`;

  return {
    id: `hubspot:company:${company.id}`,
    type: 'company',
    label,
    attributes: {
      domain: p.domain ?? null,
      industry: p.industry ?? null,
      city: p.city ?? null,
      country: p.country ?? null,
      employees: p.numberofemployees ? Number(p.numberofemployees) : null,
      revenue: p.annualrevenue ? Number(p.annualrevenue) : null,
      owner: p.hubspot_owner_id ?? null,
    },
    relationships: [],
    lastModified: p.hs_lastmodifieddate ? new Date(p.hs_lastmodifieddate) : new Date(0),
    sourceId: `hubspot:company:${company.id}`,
  };
}

/**
 * @param deal - Raw HubSpot deal object from the API
 * @returns SemanticEntity representation of the deal
 */
export function transformDeal(deal: HubSpotDeal): SemanticEntity {
  const p = deal.properties;
  const label = p.dealname ?? `Deal ${deal.id}`;
  // Derived semantic attribute: HubSpot stage names don't contain the word
  // "open", but users ask about open/closed deals — make it retrievable.
  const status = p.dealstage === 'closedwon' || p.dealstage === 'closedlost' ? 'closed' : 'open';

  return {
    id: `hubspot:deal:${deal.id}`,
    type: 'deal',
    label,
    attributes: {
      amount: p.amount ? Number(p.amount) : null,
      stage: p.dealstage ?? null,
      status: p.dealstage ? status : null,
      pipeline: p.pipeline ?? null,
      closeDate: p.closedate ?? null,
      owner: p.hubspot_owner_id ?? null,
    },
    relationships: p.associatedcompanyid
      ? [{ type: 'belongs_to', targetId: `hubspot:company:${p.associatedcompanyid}` }]
      : [],
    lastModified: p.hs_lastmodifieddate ? new Date(p.hs_lastmodifieddate) : new Date(0),
    sourceId: `hubspot:deal:${deal.id}`,
  };
}
