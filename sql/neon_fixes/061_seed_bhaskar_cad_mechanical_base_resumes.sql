-- Seed two focused, evidence-grounded base resumes for active candidate Bhaskar Roy.
-- These are intentionally separate from the existing OSP resume so search and resume
-- tailoring can use the correct positioning without inventing controls experience.

WITH candidate_row AS (
  SELECT id
  FROM candidates
  WHERE candidate_number = 10038
    AND lower(trim(name)) = 'bhaskar roy'
    AND lower(coalesce(status, '')) = 'active'
  LIMIT 1
), resume_data AS (
  SELECT * FROM (VALUES
    (
      'Resume_Bhaskar(CAD)',
      'CAD, Telecom & Infrastructure Design',
      ARRAY[
        'CAD Designer', 'CAD Drafter', 'AutoCAD Designer', 'AutoCAD Drafter',
        'OSP Design Engineer', 'OSP CAD Designer', 'Fiber Design Engineer',
        'Utility CAD Designer', 'Telecom Design Engineer', 'Infrastructure Drafter',
        'GIS/CAD Technician', 'Design Documentation Specialist',
        'Mechanical CAD Technician', 'Mechanical Drafter', 'Project Designer'
      ]::text[],
      $$ {
        "header": {
          "name": "BHASKAR ROY",
          "location": "Mt. Pleasant, MI",
          "phone": "(586) 346-2939",
          "email": "bhaskarroy.aust@gmail.com",
          "linkedin": "https://www.linkedin.com/in/roy-bhaskar/",
          "availability": "Open to relocating anywhere within the United States"
        },
        "summary": "CAD and infrastructure design professional with experience producing AutoCAD construction drawings, utility and telecom layouts, georeferenced GIS/CAD plans, permit packages, as-built updates, BOM/BOQ estimates, and drawing QA/QC. Skilled in AutoCAD 2D/3D, Spatial Manager, HLD/LLD documentation, drafting standards, and multi-stakeholder project documentation.",
        "skills": [
          {"category": "CAD & Design Software", "items": ["AutoCAD 2D/3D", "Spatial Manager", "GIS integration", "CAD template standardization", "DWG file control", "Xrefs", "Layer management", "Annotation and scale review", "OSP blocks", "Plan-view and detail drawings"]},
          {"category": "OSP, Utility & Telecom Design", "items": ["FTTx/FTTH design", "XGS-PON architecture", "Aerial and underground fiber layouts", "Duct bank design", "Conduit alignments", "Handhole layouts", "Bore paths", "Pole attachments", "HLD/LLD documentation", "Splice matrices and splitter layouts"]},
          {"category": "Documentation & Compliance", "items": ["Construction-ready drawing packages", "Permit package preparation", "ROW alignment plans", "NESC/DOT compliance", "Jurisdictional requirements", "Redline integration", "As-built drawing conversion", "GIS basemap integration"]},
          {"category": "Estimating, QA/QC & Collaboration", "items": ["BOM/BOQ development", "Fiber and conduit footage estimating", "3–5% waste factor application", "Procurement planning", "Spatial accuracy review", "Drafting standards enforcement", "Drawing QA/QC", "Junior designer mentorship"]}
        ],
        "experience": [
          {"company": "SWOP TECHNOLOGIES", "title": "OSP Design Engineer", "location": "Charlotte, NC", "dates": "Jun 2025 – Present", "bullets": ["Designed more than 400,000 feet of XGS-PON fiber layouts in AutoCAD and produced construction drawings for FTTx deployments across multiple municipalities.", "Prepared more than 100 permit packages, alignment plans, ROW documentation, and NESC/DOT-compliant design materials.", "Developed BOMs and estimates for fiber footage, conduit runs, and handholes using a 3–5% waste factor; supported procurement planning for projects exceeding $3M.", "Designed underground and aerial routes, duct banks, bore locations, handhole spacing, and pole-attachment clearances; incorporated redlines into as-built drawings.", "Completed HLD/LLD documentation for a multi-phase residential deployment spanning more than 40 route miles and 500 homes.", "Created splice matrices and splitter layouts using F1–F4 distribution and 1:32 split architecture; mentored junior designers on drafting and QA/QC standards."]},
          {"company": "SKARION", "title": "OSP Design Engineering Apprentice", "location": "Fairfax, VA", "dates": "Jan 2025 – Jun 2025", "bullets": ["Produced construction-ready HLD/LLD packages for aerial and underground FTTH designs under senior engineer guidance.", "Drafted conduit alignments, handholes, ROW offsets, duct banks, bore paths, and pole attachments while applying NESC and local standards.", "Prepared BOQ/BOM documentation covering fiber counts, conduit footage, and handholes.", "Built permit submission packages and ROW alignment sheets, integrated GIS basemaps into CAD, and supported jurisdictional compliance.", "Performed QA/QC on layer structure and spatial accuracy; integrated redlines, updated as-builts, and maintained CAD templates."]},
          {"company": "BAYSHORE COMMUNICATION", "title": "OSP CAD Drafter", "location": "Tampa, FL", "dates": "Jun 2024 – Dec 2024", "bullets": ["Prepared more than 40 AutoCAD 2D plan-view and detail drawings for commercial utility relocation projects.", "Maintained drafting standards, DWG control, Xref setup, and layer organization across more than 60 files.", "Converted field sketches and GPS information into georeferenced drawings using Spatial Manager; documented underground conduit and redline as-builts.", "Performed QA/QC for annotation, scale, and drafting consistency; maintained OSP blocks and final as-built documentation."]}
        ],
        "projects": [
          {"name": "Multi-Phase Residential FTTx Deployment", "description": "Completed the full design lifecycle for a multi-phase residential deployment spanning more than 40 route miles and 500 homes, including HLD/LLD documentation, XGS-PON architecture, AutoCAD production, and FTTx layouts.", "technologies": ["AutoCAD", "FTTx/FTTH", "XGS-PON", "HLD/LLD"]},
          {"name": "Commercial Utility Relocation Drawing Package", "description": "Prepared more than 40 AutoCAD 2D plan-view and detail drawings while supporting drafting standards, DWG control, Xref setup, and layer organization across more than 60 files.", "technologies": ["AutoCAD 2D", "Spatial Manager", "DWG/Xref management"]}
        ],
        "education": [
          {"degree": "Master of Science in Engineering Management", "school": "Central Michigan University", "date": "May 2024"},
          {"degree": "Bachelor of Mechanical Engineering", "school": "Ahsanullah University of Science & Technology", "date": "Sep 2021"}
        ],
        "certifications": [],
        "formatting": {"styleId": "skarion_compact_professional"}
      } $$::jsonb
    ),
    (
      'Resume_Bhaskar(Mechanical Engineering)',
      'Mechanical Engineering, Project Engineering & Technical Design',
      ARRAY[
        'Mechanical Engineer', 'Entry-Level Mechanical Engineer', 'Mechanical Design Engineer',
        'Project Engineer', 'Mechanical Project Engineer', 'Engineering Project Coordinator',
        'Design Engineer', 'Manufacturing Engineer', 'Product Development Engineer',
        'Applications Engineer', 'Engineering Technician', 'Technical Project Coordinator',
        'Technical Documentation Engineer', 'Mechanical Drafter/Designer',
        'Infrastructure Project Engineer', 'Project Controls Coordinator'
      ]::text[],
      $$ {
        "header": {
          "name": "BHASKAR ROY",
          "location": "Mt. Pleasant, MI",
          "phone": "(586) 346-2939",
          "email": "bhaskarroy.aust@gmail.com",
          "linkedin": "https://www.linkedin.com/in/roy-bhaskar/",
          "availability": "Open to relocating anywhere within the United States"
        },
        "summary": "Mechanical Engineer with a Bachelor of Mechanical Engineering and a Master of Science in Engineering Management, bringing professional experience in CAD-based technical design, engineering documentation, bills of materials, quantity and cost estimating, procurement planning, quality review, compliance documentation, and project coordination. Skilled in AutoCAD 2D/3D and technical drawing production, with a strong foundation for entry-level mechanical design, project engineering, manufacturing support, and technical documentation roles.",
        "skills": [
          {"category": "Engineering Foundation", "items": ["Mechanical engineering fundamentals", "Engineering management", "Technical drawing interpretation", "Design lifecycle support", "Requirements and document tracking", "Engineering standards and compliance", "QA/QC", "Continuous improvement"]},
          {"category": "CAD & Technical Design", "items": ["AutoCAD 2D/3D", "Spatial Manager", "CAD templates", "DWG and Xref management", "Layer organization", "Plan-view and detail drawings", "Georeferenced CAD/GIS", "Redlines and as-built documentation", "HLD/LLD documentation"]},
          {"category": "Project & Operations", "items": ["BOM/BOQ development", "Quantity and material estimating", "Cost awareness", "Procurement planning", "Permit packages", "Document control", "Cross-functional communication", "Mentoring and review"]},
          {"category": "Applied Infrastructure Experience", "items": ["Utilities and telecom infrastructure", "FTTx/FTTH", "Aerial and underground layouts", "Conduit and duct bank planning", "Field/GPS data integration", "NESC/DOT and jurisdictional compliance", "Construction-ready documentation"]}
        ],
        "experience": [
          {"company": "SWOP TECHNOLOGIES", "title": "OSP Design Engineer", "location": "Charlotte, NC", "dates": "Jun 2025 – Present", "bullets": ["Deliver engineering design packages for XGS-PON and FTTx deployments, including more than 400,000 feet of AutoCAD fiber layouts across multiple municipalities.", "Coordinate technical documentation for more than 100 permit packages, alignment plans, ROW materials, and NESC/DOT-compliant construction documents.", "Develop BOMs and quantity estimates for fiber, conduit, and handholes; apply a 3–5% waste factor and support procurement planning for projects exceeding $3M.", "Plan and document underground and aerial routes, duct banks, bore locations, handhole spacing, and pole-attachment clearances; convert field redlines into as-built records.", "Supported a multi-phase residential deployment spanning more than 40 route miles and 500 homes through HLD/LLD documentation and design coordination.", "Created splice matrices and splitter layouts and mentored junior designers on technical documentation, drafting quality, and delivery standards."]},
          {"company": "SKARION", "title": "OSP Design Engineering Apprentice", "location": "Fairfax, VA", "dates": "Jan 2025 – Jun 2025", "bullets": ["Supported senior engineers with construction-ready HLD/LLD packages for aerial and underground FTTH infrastructure.", "Produced technical layouts for conduit alignments, handholes, ROW offsets, duct banks, bore paths, and pole attachments while applying applicable standards.", "Prepared BOQ/BOM materials, fiber counts, conduit quantities, and handhole requirements to support project planning.", "Integrated GIS basemaps into CAD and prepared permit submission materials, ROW alignment sheets, and jurisdictional documentation.", "Performed document QA/QC, maintained layer and template standards, incorporated redlines, and updated as-built records."]},
          {"company": "BAYSHORE COMMUNICATION", "title": "OSP CAD Drafter", "location": "Tampa, FL", "dates": "Jun 2024 – Dec 2024", "bullets": ["Produced more than 40 AutoCAD 2D plan-view and detail drawings for commercial utility relocation work.", "Managed drafting standards, DWG control, Xrefs, and layer organization across more than 60 technical files.", "Converted field sketches and GPS information into georeferenced drawings using Spatial Manager and documented underground conduit layouts.", "Reviewed annotations, scale, and drawing consistency and maintained final redline and as-built documentation."]}
        ],
        "projects": [
          {"name": "Multi-Phase Residential Infrastructure Deployment", "description": "Supported the full design lifecycle for a deployment spanning more than 40 route miles and 500 homes, coordinating technical layouts, HLD/LLD documentation, material quantities, and construction documentation.", "technologies": ["AutoCAD", "FTTx/FTTH", "XGS-PON", "HLD/LLD"]},
          {"name": "Commercial Utility Relocation Technical Documentation", "description": "Produced more than 40 plan-view and detail drawings and maintained document-control practices across more than 60 files, including Xrefs, layers, field updates, and as-built records.", "technologies": ["AutoCAD 2D", "Spatial Manager", "Technical documentation"]}
        ],
        "education": [
          {"degree": "Master of Science in Engineering Management", "school": "Central Michigan University", "date": "May 2024"},
          {"degree": "Bachelor of Mechanical Engineering", "school": "Ahsanullah University of Science & Technology", "date": "Sep 2021"}
        ],
        "certifications": [],
        "formatting": {"styleId": "skarion_compact_professional"}
      } $$::jsonb
    )
  ) AS t(name, target_industry, target_roles, content)
)
INSERT INTO base_resumes (candidate_id, name, target_industry, target_roles, style_id, status, content)
SELECT c.id, r.name, r.target_industry, r.target_roles, NULL, 'approved', r.content
FROM candidate_row c
CROSS JOIN resume_data r
WHERE NOT EXISTS (
  SELECT 1 FROM base_resumes existing
  WHERE existing.candidate_id = c.id AND existing.name = r.name
);
