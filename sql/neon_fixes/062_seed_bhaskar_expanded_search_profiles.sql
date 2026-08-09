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
  ),
  (
    'Resume_Bhaskar(CAD)',
    ARRAY[
      'CAD Designer', 'CAD Drafter', 'AutoCAD Designer', 'AutoCAD Drafter',
      'CAD Technician', 'AutoCAD Technician', 'CAD Operator', 'Drafting Technician',
      'Design Drafter', 'Junior CAD Designer', 'CAD Production Technician', 'CAD Detailer',
      'Engineering CAD Technician', 'Engineering Technician CAD', 'Technical Drawing Specialist',
      'Civil CAD Drafter', 'Civil CAD Technician', 'Civil Design Technician', 'Civil Designer',
      'Utility CAD Designer', 'Utility CAD Technician', 'Telecom CAD Technician',
      'OSP CAD Technician', 'OSP CAD Designer', 'Fiber CAD Drafter', 'Fiber Design Technician',
      'GIS/CAD Technician', 'GIS Mapping Technician', 'Infrastructure CAD Technician',
      'Infrastructure Drafter', 'Municipal CAD Technician', 'Construction Drafter',
      'Plan Production Drafter', 'Plan Set Drafter', 'Plan and Profile Drafter',
      'Construction Documents Drafter', 'Permit Plan Drafter', 'Permit Drafter',
      'As-Built Drafter', 'As-Built CAD Technician', 'Redline Drafter', 'Drawing Checker',
      'CAD QA/QC Technician', 'CAD Standards Technician', 'Drafting Coordinator',
      'Design Documentation Specialist', 'Document Control Coordinator', 'CAD Data Technician',
      'CAD Conversion Technician', 'DWG Technician', 'Survey CAD Technician',
      'Utility Mapping Technician', 'Quantity Takeoff Technician', 'Material Takeoff Technician',
      'Mechanical CAD Technician', 'Mechanical Drafter', 'Mechanical Designer',
      'Mechanical Design Technician', 'Manufacturing CAD Technician', 'BIM/CAD Technician',
      'AutoCAD', 'AutoCAD 2D', 'AutoCAD 3D', '2D drafting', '3D drafting',
      'Spatial Manager', 'GIS/CAD integration', 'CAD template standardization',
      'CAD standards', 'drafting standards', 'technical drawings', 'engineering drawings',
      'plan-view drawings', 'detail drawings', 'construction drawings', 'plan production',
      'drawing set', 'plan set', 'sheet set', 'permit drawings', 'permit package',
      'ROW plans', 'alignment plans', 'as-built drawings', 'redline updates',
      'field sketches', 'GPS to CAD', 'georeferenced CAD', 'GIS basemap',
      'DWG file control', 'Xref management', 'external references', 'layer management',
      'layer standards', 'annotation standards', 'scale review', 'CAD block library',
      'OSP blocks', 'utility relocation drawings', 'utility layouts', 'telecom layouts',
      'fiber layouts', 'FTTx', 'FTTH', 'XGS-PON', 'aerial layouts', 'underground layouts',
      'duct bank drawings', 'conduit drawings', 'handhole layouts', 'bore path drawings',
      'pole attachment drawings', 'HLD', 'LLD', 'splice matrix', 'splitter layout',
      'NESC', 'DOT compliance', 'jurisdictional standards', 'BOM', 'BOQ',
      'bill of materials', 'bill of quantities', 'quantity estimating', 'material takeoff',
      'fiber footage', 'conduit footage', 'waste factor', 'procurement planning',
      'drawing QA/QC', 'spatial accuracy', 'redline integration', 'as-built conversion',
      'MicroStation', 'Bentley MicroStation', 'Civil 3D', 'Bluebeam', 'Revit'
    ],
    $$Reject roles requiring more than 5 years of experience unless the posting clearly accepts a junior or early-career candidate. Reject senior, lead, principal, manager, director, and drafting-management roles when they require more than 5 years. Prioritize AutoCAD, CAD production, technical drawings, utility/telecom/infrastructure, OSP, permitting, plan sets, as-builts, redlines, QA/QC, GIS/CAD, BOM/BOQ, and document control. Treat Civil 3D, MicroStation, Bluebeam, Revit, and survey tools as secondary/adjacent keywords unless they are the primary requirement. Do not reject a role merely because it lists one secondary tool alongside AutoCAD. Candidate is open to U.S. relocation.$$ 
  ),
  (
    'Resume_Bhaskar(Mechanical Engineering)',
    ARRAY[
      'Mechanical Engineer', 'Entry-Level Mechanical Engineer', 'Junior Mechanical Engineer',
      'Mechanical Design Engineer', 'Mechanical Project Engineer', 'Project Engineer',
      'Junior Project Engineer', 'Engineering Project Coordinator', 'Engineering Coordinator',
      'Design Engineer', 'Junior Design Engineer', 'Manufacturing Engineer',
      'Entry-Level Manufacturing Engineer', 'Product Development Engineer',
      'Mechanical Applications Engineer', 'Applications Engineer', 'Engineering Technician',
      'Mechanical Engineering Technician', 'Mechanical Drafter', 'Mechanical Designer',
      'Mechanical CAD Technician', 'Technical Project Coordinator', 'Technical Documentation Engineer',
      'Engineering Documentation Specialist', 'Project Controls Coordinator',
      'Project Engineering Coordinator', 'Project Design Coordinator', 'Production Engineering Technician',
      'Process Documentation Engineer', 'Engineering Change Coordinator',
      'Configuration Management Coordinator', 'Document Control Engineer',
      'Quality Engineering Technician', 'Quality Documentation Specialist',
      'Infrastructure Project Engineer', 'Utility Project Engineer', 'Telecom Project Engineer',
      'Construction Project Engineer', 'Engineering Associate', 'Mechanical Engineering Associate',
      'CAD Design Engineer', 'CAD Engineer', 'Technical Designer', 'Design Documentation Specialist',
      'AutoCAD', 'AutoCAD 2D', 'AutoCAD 3D', 'mechanical CAD', 'technical drawing',
      'engineering drawing', 'design documentation', 'drawing production', 'plan production',
      'design lifecycle', 'engineering project support', 'project coordination',
      'requirements tracking', 'technical documentation', 'document control',
      'drawing review', 'design review', 'QA/QC', 'quality review', 'standards compliance',
      'redline review', 'as-built documentation', 'configuration documentation',
      'BOM', 'BOQ', 'bill of materials', 'bill of quantities', 'material estimating',
      'quantity estimating', 'material takeoff', 'cost estimating', 'cost awareness',
      'procurement planning', 'vendor coordination', 'material planning', 'project planning',
      'schedule tracking', 'project deliverables', 'cross-functional coordination',
      'engineering management', 'continuous improvement', 'technical communication',
      'CAD standards', 'CAD templates', 'DWG', 'Xrefs', 'layer management',
      'Spatial Manager', 'GIS/CAD', 'georeferenced drawings', 'field data integration',
      'construction-ready documentation', 'permit documentation', 'ROW documentation',
      'utility infrastructure', 'telecom infrastructure', 'FTTx', 'FTTH', 'fiber design',
      'OSP design', 'aerial and underground layouts', 'conduit design', 'duct bank design',
      'AutoCAD drafting', 'technical file management', 'engineering records',
      'manufacturing documentation', 'production drawings', 'work instructions',
      'engineering specifications', 'technical submittals', 'submittal review',
      'project controls', 'project reporting', 'risk tracking', 'issue tracking',
      'change tracking', 'stakeholder communication', 'engineering mentorship',
      'SolidWorks', 'Creo', 'Inventor', 'Revit', 'Civil 3D', 'MicroStation',
      'PLC', 'controls project engineer', 'automation project engineer'
    ],
    $$Prioritize entry-level and early-career mechanical design, project engineering, manufacturing support, engineering coordination, technical documentation, CAD, and infrastructure project roles. Reject roles requiring more than 5 years unless the posting clearly accepts a junior candidate. Reject senior, lead, principal, manager, director, and licensed-PE roles when the experience requirement exceeds 5 years. Reject roles where PLC programming, ladder logic, SCADA, robotics programming, machine controls commissioning, HVAC system design, FEA, CFD, or SolidWorks/Creo modeling is the primary day-one requirement; those keywords are only for adjacent roles where AutoCAD, documentation, project coordination, BOM/BOQ, or engineering management are substantial parts of the job. Prefer employers willing to train on industry-specific software. Candidate has a Mechanical Engineering bachelor's degree, an Engineering Management master's degree, and professional CAD/infrastructure design experience; do not represent telecom/OSP work as factory mechanical design. Candidate is open to U.S. relocation.$$ 
  )
)
INSERT INTO candidate_resume_search_profiles
  (candidate_id, base_resume_id, keywords, additional_rules)
SELECT c.id, br.id, p.keywords, p.additional_rules
FROM candidate_row c
JOIN base_resumes br ON br.candidate_id = c.id
JOIN profile_data p ON p.resume_name = br.name
ON CONFLICT (base_resume_id) DO NOTHING;
