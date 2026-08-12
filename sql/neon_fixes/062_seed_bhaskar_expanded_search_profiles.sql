-- Expanded search contracts for active candidate #10038.
-- These are ingestion inputs only; they do not claim that Bhaskar has experience
-- with every search term. The additional rules keep adjacent searches reviewable.

WITH candidate_row AS (
  SELECT id
  FROM candidates
  WHERE candidate_number = 10038
    AND lower(trim(name)) = 'bhaskar roy'
    AND lower(coalesce(status, '')) = 'active'
  LIMIT 1
), profile_data (resume_name, keywords, additional_rules) AS (
  VALUES
  (
    'Resume_Bhaskar_Roy(OSP)-1',
    ARRAY[
      'OSP Design Engineer', 'Outside Plant Engineer', 'OSP Engineer',
      'Fiber Design Engineer', 'FTTH Design Engineer', 'FTTx Design Engineer',
      'Fiber Optic Design Engineer', 'Telecom Design Engineer', 'Telecommunications Engineer',
      'OSP Planning Engineer', 'OSP Project Engineer', 'OSP Construction Engineer',
      'Outside Plant Designer', 'OSP Designer', 'OSP CAD Designer', 'OSP CAD Drafter',
      'Fiber Design Technician', 'Fiber Engineering Technician', 'OSP Engineering Technician',
      'OSP Field Engineer', 'OSP Field Technician', 'OSP QC Engineer', 'OSP QA/QC Technician',
      'OSP Design Specialist', 'OSP Engineering Specialist', 'OSP Documentation Specialist',
      'Fiber Network Planner', 'Fiber Route Planner', 'Fiber Infrastructure Designer',
      'Broadband Design Engineer', 'Broadband Network Designer', 'Fiber Construction Coordinator',
      'Fiber Construction Technician', 'Fiber Permitting Engineer', 'Fiber Permit Coordinator',
      'Telecom Permit Coordinator', 'Permit Design Engineer', 'Permit Drafter',
      'ROW Permit Technician', 'Right of Way Coordinator', 'Joint Use Engineer',
      'Joint Use Designer', 'Make Ready Engineer', 'Make Ready Designer',
      'Pole Attachment Designer', 'Aerial Fiber Design Engineer', 'Underground Fiber Designer',
      'Fiber As-Built Technician', 'Fiber QA/QC Technician', 'Fiber Quantity Estimator',
      'OSP Estimator', 'Telecom Design Technician', 'Telecom GIS Analyst',
      'Utility GIS Technician', 'Construction-Ready Fiber Designer', 'Field Verification Technician',
      'AutoCAD', 'AutoCAD 2D', 'AutoCAD 3D', 'Spatial Manager', 'GIS integration',
      'FTTx', 'FTTH', 'XGS-PON', 'GPON', 'fiber optic design', 'fiber route design',
      'outside plant design', 'OSP network design', 'broadband network design',
      'aerial fiber', 'underground fiber', 'aerial plant', 'underground plant',
      'duct bank', 'duct bank design', 'conduit design', 'conduit alignment',
      'handhole layout', 'handhole spacing', 'bore path', 'HDD bore', 'directional bore',
      'pole attachment', 'joint use', 'make ready', 'pole loading', 'ROW alignment',
      'right of way', 'permit package', 'utility permitting', 'NESC', 'DOT compliance',
      'municipal standards', 'jurisdictional compliance', 'HLD', 'LLD', 'high level design',
      'low level design', 'construction drawings', 'construction-ready drawings',
      'splice matrix', 'splitter layout', '1:32 splitter', 'F1 distribution', 'F2 distribution',
      'F3 distribution', 'F4 distribution', 'port assignment', 'fiber counts',
      'redline integration', 'as-built drawings', 'as-built conversion', 'field sketches',
      'GPS data', 'georeferenced drawings', 'GIS basemap', 'BOM', 'BOQ', 'material takeoff',
      'fiber footage estimating', 'conduit footage estimating', 'waste factor',
      'procurement planning', 'drawing QA/QC', 'spatial accuracy', 'CAD standards',
      'layer management', 'Xrefs', 'DWG control', 'drafting standards'
    ],
    $$Reject roles requiring more than 5 years of experience unless the posting clearly accepts a junior or early-career candidate. Reject senior, lead, principal, manager, director, and construction-management roles when they require more than 5 years. Reject roles requiring a PE license, telecom construction-superintendent responsibility, or direct field crew management. Prioritize OSP design, fiber design, route planning, AutoCAD, permitting, ROW, joint use, pole attachments, HLD/LLD, QA/QC, as-builts, GIS/CAD, BOM/BOQ, and construction-ready documentation. Treat GIS, Civil 3D, MicroStation, and field verification as adjacent matches; do not require them when the posting is primarily OSP design. Candidate is open to U.S. relocation.$$
  )
  -- The "Resume_Bhaskar(CAD)" and "Resume_Bhaskar(Mechanical Engineering)"
  -- entries that used to follow here were removed 2026-08-12. Their base
  -- resumes (seeded by 061_seed_bhaskar_cad_mechanical_base_resumes.sql,
  -- now neutralized) were intentionally deleted and superseded by
  -- "Resume_Bhaskar_Roy (CAD Drafting)" / "Resume_Bhaskar_Roy (Mech
  -- Engineering)". The JOIN below already matches by base_resumes.name, so
  -- these entries could only ever create a search profile if a base resume
  -- with one of those exact retired names were ever created again - removed
  -- outright instead of leaving that latent possibility in place.
)
INSERT INTO candidate_resume_search_profiles
  (candidate_id, base_resume_id, keywords, additional_rules)
SELECT c.id, br.id, p.keywords, p.additional_rules
FROM candidate_row c
JOIN base_resumes br ON br.candidate_id = c.id
JOIN profile_data p ON p.resume_name = br.name
ON CONFLICT (base_resume_id) DO NOTHING;
