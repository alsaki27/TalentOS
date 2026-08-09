-- Approved baseline search profiles for active candidate #10034.
-- These are review inputs for future ingestion automation; they do not run jobs.
WITH candidate_row AS (
  SELECT id
  FROM candidates
  WHERE candidate_number = 10034
    AND status = 'active'
  LIMIT 1
),
profile_data (resume_name, keywords, additional_rules) AS (
  VALUES
  (
    'Resume_Avirup(GIS)',
    ARRAY[
      'GIS Analyst', 'GIS Technician', 'GIS Specialist', 'GIS Data Analyst',
      'Geospatial Analyst', 'GIS Support Specialist', 'GIS Mapping Technician',
      'GIS QA/QC Analyst', 'Utility GIS Analyst', 'GIS Field Technician',
      'GIS Database Technician', 'GIS Automation Analyst', 'GIS Applications Analyst',
      'GIS Developer', 'GIS Coordinator', 'GIS Analyst I', 'GIS Technician I',
      'GIS Technician II', 'Mapping Technician', 'Geospatial Technician',
      'Cartographic Technician', 'Cartographer', 'GIS Production Specialist',
      'GIS Data Technician', 'GIS Quality Assurance Analyst', 'ArcGIS Pro',
      'ArcGIS Online', 'ArcGIS Enterprise', 'ArcPy', 'QGIS', 'ArcGIS Field Maps',
      'Survey123', 'ModelBuilder', 'Spatial Analysis', 'Geodatabase',
      'Enterprise Geodatabase', 'File Geodatabase', 'Feature Class', 'Geocoding',
      'Spatial Joins', 'Parcel Mapping', 'Utility Mapping', 'Land Use Mapping',
      'Zoning Mapping', 'Road Centerline Mapping', 'Infrastructure Mapping',
      'Web Maps', 'Dashboards', 'GPS Data Collection', 'Topology QA/QC',
      'Geometry Validation', 'Metadata', 'Coordinate Systems',
      'Projection Management', 'Attribute Rules', 'Shapefile', 'Field Verification',
      'Mobile GIS', 'Municipal GIS', 'Public Works GIS', 'GIS Data Conversion'
    ],
    $$Reject roles requiring more than 5 years of experience. Reject senior, lead, manager, principal, or director roles unless the posting clearly accepts candidates with 5 years or less. Prefer GIS roles involving ArcGIS, utility, municipal, infrastructure, field data, mapping, geodatabases, automation, or QA/QC. Reject roles focused primarily on data science, remote-sensing research, or unrelated software engineering. Candidate is open to U.S. relocation.$$ 
  ),
  (
    'Resume_Avirup(OSP)',
    ARRAY[
      'OSP Design Engineer', 'Outside Plant Engineer', 'OSP Engineer',
      'Fiber Design Engineer', 'FTTH Design Engineer', 'Fiber Optic Design Engineer',
      'Telecom Design Engineer', 'OSP Planning Engineer', 'OSP CAD Designer',
      'Fiber Network Engineer', 'Fiber Construction Engineer', 'Outside Plant Designer',
      'Telecommunications Engineer', 'Fiber Route Engineer', 'Aerial Fiber Design Engineer',
      'Underground Fiber Design Engineer', 'Joint Use Engineer', 'Make Ready Engineer',
      'Fiber Permitting Engineer', 'GIS Fiber Design Technician', 'OSP Project Engineer',
      'Fiber Design Technician', 'OSP Field Engineer', 'OSP QC Engineer',
      'OSP Engineering Technician', 'OSP CAD Drafter', 'OSP Design Engineering Specialist',
      'Permit Design Engineer', 'Permit Drafter', 'Fiber Engineering Technician',
      'FTTH Designer', 'FTTx Designer', 'Fiber Network Planner',
      'Broadband Design Engineer', 'Telecom Design Technician',
      'Fiber Construction Coordinator', 'Fiber Splice Engineer',
      'Fiber Splicing Technician', 'Splice Matrix Technician', 'HLD/LLD Designer',
      'Fiber Route Planner', 'Utility Fiber Designer', 'Telecom Permit Coordinator',
      'ROW Permit Technician', 'Joint Use Designer', 'Pole Attachment Designer',
      'Make Ready Designer', 'Fiber QA/QC Technician', 'Fiber As-Built Technician',
      'OSP Documentation Specialist', 'Fiber Quantity Estimator', 'OSP Estimator',
      'Cable Route Designer', 'Outside Plant CAD Technician', 'Telecom GIS Analyst',
      'Utility GIS Technician', 'Construction-Ready Fiber Designer',
      'Field Verification Technician', 'Fiber Network Implementation Engineer',
      'Fiber Infrastructure Designer'
    ],
    $$Reject roles requiring more than 5 years of experience. Reject senior, manager, principal, and construction-management roles unless the experience requirement is 5 years or less. Prefer design, drafting, permitting, GIS, route planning, QA/QC, field verification, and construction-ready documentation. Reject roles requiring a PE license unless the posting explicitly allows candidates without one. Candidate is open to U.S. relocation.$$ 
  ),
  (
    'Resume_Avirup(CAD)',
    ARRAY[
      'AutoCAD Drafter', 'CAD Technician', 'CAD Designer', 'Civil CAD Drafter',
      'Civil CAD Technician', 'Civil 3D Technician', 'Utility Drafter',
      'Telecom Drafter', 'Design Drafter', 'Drafting Technician', 'CAD Operator',
      'Engineering Technician CAD', 'Site Design Technician', 'Construction Drafter',
      'AutoCAD Technician', 'CAD Detailer', 'Junior CAD Designer', 'As-Built Drafter',
      'Permit Drafter', 'Land Development Drafter', 'Infrastructure CAD Technician',
      'GIS/CAD Technician', 'Civil Designer', 'Mapping Technician',
      'Plan Production Drafter', 'AutoCAD Civil 3D', 'AutoCAD 2D', 'AutoCAD 3D',
      'Civil 3D Drafter', 'Civil Design Technician', 'Land Development CAD Technician',
      'Municipal CAD Technician', 'Utility CAD Technician', 'Telecom CAD Technician',
      'OSP CAD Technician', 'Fiber CAD Drafter', 'Fiber Design Technician',
      'GIS Mapping Technician', 'Engineering CAD Technician', 'CAD Production Technician',
      'CAD QA/QC Technician', 'CAD Standards Technician', 'Plan Set Drafter',
      'Plan and Profile Drafter', 'Construction Documents Drafter',
      'Permit Plan Drafter', 'Redline Drafter', 'As-Built CAD Technician',
      'Survey CAD Technician', 'Parcel Mapping Technician', 'Utility Mapping Technician',
      'Drafting Coordinator', 'Drawing Checker', 'Technical Drawing Specialist',
      'CAD Data Technician', 'CAD Conversion Technician', 'DWG Technician',
      'PDF to CAD Technician', 'MicroStation Drafter', 'Bentley MicroStation Technician',
      'Bluebeam Technician', 'Sheet Set Technician', 'Quantity Takeoff Technician',
      'Material Takeoff Technician', 'BIM/CAD Technician', 'Document Control Coordinator',
      'Design Documentation Specialist', 'Infrastructure Drafter', 'Roadway Drafter',
      'Civil Infrastructure Drafter', 'Structural CAD Technician',
      'Mechanical CAD Technician', 'Electrical CAD Technician'
    ],
    $$Reject roles requiring more than 5 years of experience. Reject senior, lead, manager, principal, or director roles unless the posting accepts candidates with 5 years or less. Prefer junior, associate, technician, drafter, designer, and production roles involving AutoCAD, Civil 3D, utility, telecom, civil, infrastructure, GIS/CAD, permitting, construction drawings, as-builts, QA/QC, or quantity takeoffs. Do not reject a role merely because it mentions Revit, SolidWorks, MicroStation, or Bluebeam; treat those as secondary tools unless they are the primary requirement.$$ 
  )
)
INSERT INTO candidate_resume_search_profiles
  (candidate_id, base_resume_id, keywords, additional_rules)
SELECT c.id, br.id, p.keywords, p.additional_rules
FROM candidate_row c
JOIN base_resumes br ON br.candidate_id = c.id
JOIN profile_data p ON p.resume_name = br.name
ON CONFLICT (base_resume_id) DO NOTHING;
