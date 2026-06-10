-- Seed script for iris_demo_source database
-- Creates a realistic small-business dataset for Slice 2 demo and eval harness.
-- Run against the iris_demo_source database (create it first):
--   createdb iris_demo_source && psql iris_demo_source < scripts/seed-business-db.sql

-- ─── Companies (20) ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS companies (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  industry    TEXT NOT NULL,
  employees   INTEGER,
  annual_revenue_usd BIGINT,
  city        TEXT,
  country     TEXT DEFAULT 'US',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

TRUNCATE companies RESTART IDENTITY CASCADE;

INSERT INTO companies (name, industry, employees, annual_revenue_usd, city) VALUES
  ('Acme Corp',          'Technology',          120,  18000000,  'New York'),
  ('Initech',            'IT Services',          50,   8000000,  'Austin'),
  ('Globex',             'Manufacturing',       500,  95000000,  'Chicago'),
  ('Pinnacle Solutions', 'Consulting',           75,  12000000,  'San Francisco'),
  ('Vertex Analytics',   'Data Analytics',       30,   5000000,  'Boston'),
  ('Summit Ventures',    'Finance',             200,  45000000,  'New York'),
  ('NovaTech',           'Software',             85,  22000000,  'Seattle'),
  ('BlueSky Industries', 'Aerospace',           300,  78000000,  'Houston'),
  ('Cascade Digital',    'Digital Marketing',    40,   7000000,  'Portland'),
  ('Meridian Health',    'Healthcare',          150,  35000000,  'Atlanta'),
  ('Quantum Systems',    'Defense',             250,  60000000,  'Arlington'),
  ('Horizon Retail',     'Retail',              180,  28000000,  'Dallas'),
  ('Apex Financial',     'Financial Services',   90,  42000000,  'Chicago'),
  ('Stellar Media',      'Media',                60,  11000000,  'Los Angeles'),
  ('Forge Manufacturing','Manufacturing',        420,  88000000,  'Detroit'),
  ('Clarity Consulting', 'Consulting',           55,   9000000,  'Denver'),
  ('Orbit Software',     'Software',            110,  31000000,  'Austin'),
  ('Pacific Logistics',  'Logistics',           380,  65000000,  'Oakland'),
  ('Ember Energy',       'Energy',              220,  52000000,  'Houston'),
  ('Zenith Capital',     'Private Equity',       35, 120000000,  'New York');

-- ─── Contacts (50) ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT NOT NULL,
  title       TEXT,
  phone       TEXT,
  stage       TEXT NOT NULL DEFAULT 'lead',   -- lead / prospect / customer
  owner       TEXT,                            -- sales rep name
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

TRUNCATE contacts RESTART IDENTITY CASCADE;

INSERT INTO contacts (company_id, first_name, last_name, email, title, phone, stage, owner) VALUES
  -- Acme Corp (id=1) — 3 contacts
  (1, 'Alice',    'Johnson',  'alice.johnson@acme-corp.com',       'VP Engineering',     '212-555-0101', 'customer',  'Sarah Kim'),
  (1, 'Marcus',   'Webb',     'marcus.webb@acme-corp.com',         'CTO',                '212-555-0102', 'customer',  'Sarah Kim'),
  (1, 'Diana',    'Patel',    'diana.patel@acme-corp.com',         'Head of Operations', '212-555-0103', 'prospect',  'Tom Garcia'),
  -- Initech (id=2) — 2 contacts
  (2, 'Bob',      'Chen',     'bob.chen@initech-corp.com',         'CEO',                '512-555-0201', 'customer',  'Tom Garcia'),
  (2, 'Priya',    'Sharma',   'priya.sharma@initech-corp.com',     'COO',                '512-555-0202', 'prospect',  'Tom Garcia'),
  -- Globex (id=3) — 3 contacts
  (3, 'Carl',     'Morrison', 'carl.morrison@globex.com',          'Procurement Director','312-555-0301', 'customer', 'Sarah Kim'),
  (3, 'Elena',    'Torres',   'elena.torres@globex.com',           'CFO',                '312-555-0302', 'customer',  'Sarah Kim'),
  (3, 'Frank',    'Nguyen',   'frank.nguyen@globex.com',           'VP Supply Chain',    '312-555-0303', 'lead',      'Alex Brown'),
  -- Pinnacle Solutions (id=4) — 2 contacts
  (4, 'Grace',    'Lee',      'grace.lee@pinnacle-sol.com',        'Managing Partner',   '415-555-0401', 'customer',  'Alex Brown'),
  (4, 'Henry',    'Adams',    'henry.adams@pinnacle-sol.com',      'Senior Consultant',  '415-555-0402', 'prospect',  'Alex Brown'),
  -- Vertex Analytics (id=5) — 2 contacts
  (5, 'Isabel',   'Cruz',     'isabel.cruz@vertex-analytics.com',  'Data Science Lead',  '617-555-0501', 'lead',      'Sarah Kim'),
  (5, 'James',    'Foster',   'james.foster@vertex-analytics.com', 'CEO',                '617-555-0502', 'prospect',  'Tom Garcia'),
  -- Summit Ventures (id=6) — 3 contacts
  (6, 'Karen',    'Mitchell', 'karen.mitchell@summit-ventures.com','Managing Director',  '212-555-0601', 'customer',  'Sarah Kim'),
  (6, 'Leon',     'Wright',   'leon.wright@summit-ventures.com',   'VP Investments',     '212-555-0602', 'customer',  'Tom Garcia'),
  (6, 'Mia',      'Taylor',   'mia.taylor@summit-ventures.com',    'Head of Research',   '212-555-0603', 'prospect',  'Alex Brown'),
  -- NovaTech (id=7) — 2 contacts
  (7, 'Nathan',   'Brooks',   'nathan.brooks@novatech.io',         'CEO',                '206-555-0701', 'customer',  'Sarah Kim'),
  (7, 'Olivia',   'Reed',     'olivia.reed@novatech.io',           'CTO',                '206-555-0702', 'prospect',  'Tom Garcia'),
  -- BlueSky Industries (id=8) — 3 contacts
  (8, 'Peter',    'Collins',  'peter.collins@bluesky-ind.com',     'COO',                '713-555-0801', 'customer',  'Alex Brown'),
  (8, 'Quinn',    'Evans',    'quinn.evans@bluesky-ind.com',       'VP Engineering',     '713-555-0802', 'customer',  'Sarah Kim'),
  (8, 'Rachel',   'Hayes',    'rachel.hayes@bluesky-ind.com',      'Program Director',   '713-555-0803', 'lead',      'Tom Garcia'),
  -- Cascade Digital (id=9) — 2 contacts
  (9, 'Samuel',   'Price',    'samuel.price@cascade-digital.com',  'Founder',            '503-555-0901', 'prospect',  'Alex Brown'),
  (9, 'Tanya',    'Ross',     'tanya.ross@cascade-digital.com',    'Head of Growth',     '503-555-0902', 'lead',      'Sarah Kim'),
  -- Meridian Health (id=10) — 3 contacts
  (10,'Ulrich',   'Stone',    'ulrich.stone@meridian-health.com',  'CMO',                '404-555-1001', 'customer',  'Tom Garcia'),
  (10,'Victoria', 'Hall',     'victoria.hall@meridian-health.com', 'VP Product',         '404-555-1002', 'customer',  'Sarah Kim'),
  (10,'Walter',   'Young',    'walter.young@meridian-health.com',  'IT Director',        '404-555-1003', 'prospect',  'Alex Brown'),
  -- Quantum Systems (id=11) — 2 contacts
  (11,'Xena',     'Wallace',  'xena.wallace@quantum-sys.com',      'CTO',                '703-555-1101', 'customer',  'Sarah Kim'),
  (11,'Yusuf',    'Bennett',  'yusuf.bennett@quantum-sys.com',     'Contracts Manager',  '703-555-1102', 'customer',  'Tom Garcia'),
  -- Horizon Retail (id=12) — 2 contacts
  (12,'Zoe',      'Parker',   'zoe.parker@horizon-retail.com',     'CMO',                '214-555-1201', 'customer',  'Alex Brown'),
  (12,'Aaron',    'Griffin',  'aaron.griffin@horizon-retail.com',  'Director of IT',     '214-555-1202', 'prospect',  'Sarah Kim'),
  -- Apex Financial (id=13) — 3 contacts
  (13,'Bella',    'Campbell', 'bella.campbell@apex-financial.com', 'CFO',                '312-555-1301', 'customer',  'Tom Garcia'),
  (13,'Carlos',   'Rodriguez','carlos.rodriguez@apex-financial.com','Head of Tech',      '312-555-1302', 'customer',  'Sarah Kim'),
  (13,'Dana',     'Phillips', 'dana.phillips@apex-financial.com',  'Risk Officer',       '312-555-1303', 'prospect',  'Alex Brown'),
  -- Stellar Media (id=14) — 2 contacts
  (14,'Ethan',    'Turner',   'ethan.turner@stellar-media.com',    'CEO',                '310-555-1401', 'customer',  'Tom Garcia'),
  (14,'Fiona',    'Clark',    'fiona.clark@stellar-media.com',     'Head of Content',    '310-555-1402', 'lead',      'Sarah Kim'),
  -- Forge Manufacturing (id=15) — 3 contacts
  (15,'George',   'Lewis',    'george.lewis@forge-mfg.com',        'COO',                '313-555-1501', 'customer',  'Alex Brown'),
  (15,'Hannah',   'Walker',   'hannah.walker@forge-mfg.com',       'VP Operations',      '313-555-1502', 'customer',  'Sarah Kim'),
  (15,'Ivan',     'Allen',    'ivan.allen@forge-mfg.com',          'Procurement Manager','313-555-1503', 'prospect',  'Tom Garcia'),
  -- Clarity Consulting (id=16) — 2 contacts
  (16,'Julia',    'Scott',    'julia.scott@clarity-consulting.com','Senior Partner',      '720-555-1601', 'customer',  'Alex Brown'),
  (16,'Kevin',    'King',     'kevin.king@clarity-consulting.com', 'Project Lead',       '720-555-1602', 'lead',      'Sarah Kim'),
  -- Orbit Software (id=17) — 2 contacts
  (17,'Laura',    'Baker',    'laura.baker@orbit-sw.com',          'CTO',                '512-555-1701', 'customer',  'Tom Garcia'),
  (17,'Michael',  'Nelson',   'michael.nelson@orbit-sw.com',       'VP Sales',           '512-555-1702', 'prospect',  'Alex Brown'),
  -- Pacific Logistics (id=18) — 2 contacts
  (18,'Nina',     'Carter',   'nina.carter@pacific-logistics.com', 'VP Operations',      '510-555-1801', 'customer',  'Sarah Kim'),
  (18,'Oscar',    'Murphy',   'oscar.murphy@pacific-logistics.com','Head of Tech',       '510-555-1802', 'customer',  'Tom Garcia'),
  -- Ember Energy (id=19) — 2 contacts
  (19,'Paula',    'Rivera',   'paula.rivera@ember-energy.com',     'CEO',                '713-555-1901', 'customer',  'Alex Brown'),
  (19,'Quentin',  'Cook',     'quentin.cook@ember-energy.com',     'CFO',                '713-555-1902', 'prospect',  'Sarah Kim'),
  -- Zenith Capital (id=20) — 3 contacts
  (20,'Rose',     'Morgan',   'rose.morgan@zenith-cap.com',        'Managing Partner',   '212-555-2001', 'customer',  'Tom Garcia'),
  (20,'Steven',   'Bell',     'steven.bell@zenith-cap.com',        'Head of Deals',      '212-555-2002', 'customer',  'Alex Brown'),
  (20,'Tina',     'Murphy',   'tina.murphy@zenith-cap.com',        'LP Relations',       '212-555-2003', 'lead',      'Sarah Kim');

-- ─── Deals (30) ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deals (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  contact_id  INTEGER NOT NULL REFERENCES contacts(id),
  name        TEXT NOT NULL,
  amount_usd  INTEGER NOT NULL,
  stage       TEXT NOT NULL DEFAULT 'prospecting',
  -- prospecting / qualification / proposal / negotiation / closed_won / closed_lost
  owner       TEXT,
  close_date  DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

TRUNCATE deals RESTART IDENTITY CASCADE;

INSERT INTO deals (company_id, contact_id, name, amount_usd, stage, owner, close_date) VALUES
  -- Acme Corp deals
  (1,  1,  'Acme Platform Upgrade',         85000,  'closed_won',    'Sarah Kim',  '2026-03-15'),
  (1,  2,  'Acme DevOps Toolchain',         42000,  'closed_won',    'Sarah Kim',  '2026-02-28'),
  (1,  3,  'Acme Ops Automation Pilot',     18000,  'negotiation',   'Tom Garcia', '2026-07-10'),
  -- Initech deals
  (2,  4,  'Initech Security Suite',        34000,  'closed_won',    'Tom Garcia', '2026-01-20'),
  (2,  5,  'Initech Cloud Migration',       27500,  'proposal',      'Tom Garcia', '2026-08-01'),
  -- Globex deals (large deals for superlative questions)
  (3,  6,  'Globex Enterprise Platform',   145000,  'closed_won',    'Sarah Kim',  '2026-04-30'),
  (3,  7,  'Globex Supply Chain AI',        93000,  'negotiation',   'Sarah Kim',  '2026-07-31'),
  (3,  8,  'Globex ERP Integration',        56000,  'proposal',      'Alex Brown', '2026-09-15'),
  -- Pinnacle deals
  (4,  9,  'Pinnacle Analytics Platform',   38500,  'closed_won',    'Alex Brown', '2026-03-01'),
  (4, 10,  'Pinnacle CRM Implementation',   22000,  'qualification', 'Alex Brown', '2026-08-15'),
  -- Vertex Analytics
  (5, 11,  'Vertex Data Warehouse',         29000,  'proposal',      'Sarah Kim',  '2026-08-30'),
  -- Summit Ventures
  (6, 13,  'Summit Portfolio Dashboard',    67000,  'closed_won',    'Sarah Kim',  '2026-02-10'),
  (6, 14,  'Summit Risk Analytics',         44000,  'negotiation',   'Tom Garcia', '2026-07-20'),
  -- NovaTech
  (7, 16,  'NovaTech SaaS Platform',        51000,  'closed_won',    'Sarah Kim',  '2026-01-15'),
  (7, 17,  'NovaTech API Integration',      19500,  'qualification', 'Tom Garcia', '2026-09-01'),
  -- BlueSky Industries
  (8, 18,  'BlueSky MES Upgrade',          112000,  'negotiation',   'Alex Brown', '2026-07-25'),
  (8, 19,  'BlueSky Compliance Suite',      48000,  'proposal',      'Sarah Kim',  '2026-09-10'),
  -- Quantum Systems (large deal)
  (11,26, 'Quantum Security Platform',     128000,  'closed_won',    'Sarah Kim',  '2026-05-01'),
  -- Horizon Retail
  (12,28, 'Horizon POS Modernization',      37000,  'closed_won',    'Alex Brown', '2026-03-20'),
  -- Apex Financial
  (13,30, 'Apex Compliance Automation',     62000,  'negotiation',   'Tom Garcia', '2026-07-15'),
  (13,31, 'Apex Trading Analytics',         41000,  'proposal',      'Sarah Kim',  '2026-08-20'),
  -- Stellar Media
  (14,33, 'Stellar Content Platform',       23000,  'closed_won',    'Tom Garcia', '2026-02-28'),
  -- Forge Manufacturing
  (15,35, 'Forge Production Optimization',  77000,  'closed_won',    'Alex Brown', '2026-04-10'),
  (15,36, 'Forge Inventory AI',             33000,  'qualification', 'Sarah Kim',  '2026-09-30'),
  -- Orbit Software
  (17,40, 'Orbit Core Platform License',    58000,  'closed_won',    'Tom Garcia', '2026-03-05'),
  -- Pacific Logistics
  (18,43, 'Pacific Route Optimizer',        46000,  'closed_won',    'Sarah Kim',  '2026-02-15'),
  (18,44, 'Pacific Warehouse Management',   39000,  'proposal',      'Tom Garcia', '2026-08-25'),
  -- Ember Energy
  (19,45, 'Ember Grid Analytics',           71000,  'closed_won',    'Alex Brown', '2026-04-20'),
  -- Zenith Capital
  (20,47, 'Zenith Deal Flow Platform',      95000,  'negotiation',   'Tom Garcia', '2026-07-30'),
  (20,48, 'Zenith LP Reporting Suite',      52000,  'closed_won',    'Alex Brown', '2026-03-25');
