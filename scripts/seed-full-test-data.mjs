// Complete test data: fully detailed OSP/GIS engineer candidate, rich job posting, base resume.
// Overwrites the earlier minimal seed with full detail.

import { Client } from "@neondatabase/serverless";
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const c = new Client(DB_URL);
await c.connect();

// Clean up any previous test data
await c.query("DELETE FROM application_ai_stage_runs WHERE workflow_id IN (SELECT id FROM application_ai_workflows WHERE application_id IN (SELECT a.id FROM applications a JOIN candidates c ON a.candidate_id = c.id WHERE c.name LIKE 'Jane Test%'))");
await c.query("DELETE FROM application_ai_artifacts WHERE workflow_id IN (SELECT id FROM application_ai_workflows WHERE application_id IN (SELECT a.id FROM applications a JOIN candidates c ON a.candidate_id = c.id WHERE c.name LIKE 'Jane Test%'))");
await c.query("DELETE FROM application_ai_workflows WHERE application_id IN (SELECT a.id FROM applications a JOIN candidates c ON a.candidate_id = c.id WHERE c.name LIKE 'Jane Test%')");
await c.query("DELETE FROM application_resume_versions WHERE candidate_id IN (SELECT id FROM candidates WHERE name LIKE 'Jane Test%')");
await c.query("DELETE FROM applications WHERE candidate_id IN (SELECT id FROM candidates WHERE name LIKE 'Jane Test%')");
await c.query("DELETE FROM jobs WHERE title LIKE '%Senior GIS/OSP%'");
await c.query("DELETE FROM candidates WHERE name LIKE 'Jane Test%'");

console.log("Cleaned up old test data");

// ── 1. Create candidate with FULL parsed profile ──
const cand = await c.query(`
  INSERT INTO candidates (name, email, phone, city, country, notes, linkedin_url, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
  RETURNING id, name
`, [
  "Jane Test Engineer",
  "jane.test.engineer@example.com",
  "+1-555-0100",
  "Washington",
  "US",
  `OSP ENGINEER + GIS SPECIALIST — FULL BACKGROUND

PROFESSIONAL SUMMARY:
Senior OSP/GIS Engineer with 8+ years of combined experience in outside plant fiber optic network design and enterprise GIS platform development. Proven track record designing 200+ miles of FTTH routes, managing multi-million dollar infrastructure projects, and building spatial data systems serving 500+ users. Expert in ArcGIS/QGIS/PostGIS with strong Python automation skills.

TECHNICAL SKILLS:
GIS: ArcGIS Pro, ArcGIS Server, ArcPy, QGIS, PostGIS, GeoPandas, GDAL/OGR, Leaflet, OpenLayers, MapBox, GeoServer
OSP: Fiber route design, FTTH/FTTx, GPON, Active Ethernet, splice schematics, permitting, ROW acquisition, NESC standards
Programming: Python, JavaScript, SQL, R, Bash
Databases: PostgreSQL/PostGIS, SQLite, Oracle Spatial
Tools: AutoCAD, MicroStation, Google Earth Pro, LIDAR processing, Terraform, Docker, Git, CI/CD
Networking: OSPF, BGP, MPLS, VLAN, TCP/IP
Cloud: AWS (S3, EC2, RDS), Google Cloud

CERTIFICATIONS:
- GISP (GIS Certification Institute) — 2016
- Fiber Optics Association (FOA) Certified
- OSHA 30-Hour Construction Safety
- FCC Tower Climber Safety & Rescue
- Project Management Professional (PMP) — in progress`,
  "https://linkedin.com/in/jane-test-engineer",
]);
const candidateId = cand.rows[0].id;
console.log(`✓ Created: ${cand.rows[0].name} (${candidateId})`);

// ── 2. Create RICH job posting ──
const job = await c.query(`
  INSERT INTO jobs (title, company, location, description_text, employment_type, seniority_level, salary_range, source_url, raw_description, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
  RETURNING id, title
`, [
  "Senior GIS/OSP Engineer",
  "National Fiber Networks Inc.",
  "Remote — Eastern US (DC, MD, VA, PA preferred)",
  `Position: Senior GIS/OSP Engineer — National Fiber Networks Inc.

National Fiber Networks is a leading telecommunications infrastructure company specializing in fiber optic broadband deployment across the mid-Atlantic and southeastern United States. We are seeking a Senior GIS/OSP Engineer to lead our fiber infrastructure expansion team.

ABOUT THE ROLE:
This is a hands-on technical leadership position combining outside plant fiber engineering with advanced geospatial analysis. You will design and optimize OSP fiber routes, manage our spatial database of fiber assets, and develop GIS automation tools. You will work closely with construction, permitting, and field engineering teams.

REQUIRED QUALIFICATIONS:
• 5+ years of OSP engineering experience in telecommunications/fiber optics
• 3+ years of GIS analysis and spatial data management experience
• Proficiency with ArcGIS Pro, QGIS, or equivalent GIS platforms
• Strong understanding of fiber optic network design principles (FTTH, FTTx, GPON)
• Experience with permitting, right-of-way (ROW) acquisition, and jurisdictional coordination
• Ability to read and interpret construction drawings, splice schematics, and as-built documentation
• Experience preparing engineering cost estimates and bills of materials (BOM)
• Knowledge of NESC, TIA/EIA, and industry standards
• Bachelor's degree in Civil Engineering, GIS, Geography, or related field

PREFERRED QUALIFICATIONS:
• Experience with GPON and active Ethernet network architectures
• Python scripting for geospatial data processing and automation
• Knowledge of 5G small cell siting and densification strategies
• Project management experience (PMP certification a plus)
• Experience with LIDAR data processing, analysis, and integration
• Familiarity with AutoCAD and MicroStation
• Master's degree in GIS or related field

RESPONSIBILITIES:
• Design and optimize OSP fiber routes using GIS-based analysis and field survey data
• Manage and maintain spatial database of fiber optic assets, splice points, and infrastructure
• Coordinate with engineering, construction, and permitting teams on route selection
• Develop GIS tools, scripts, and automation for route planning and feasibility analysis
• Prepare detailed engineering cost estimates, bills of materials, and construction packages
• Ensure compliance with NESC, TIA/EIA, and company design standards
• Support field engineering teams with GIS data, maps, and spatial analysis
• Present route designs, feasibility studies, and cost analyses to stakeholders
• Conduct field visits for route verification and as-built data collection
• Mentor junior GIS analysts and OSP designers

TOOLS & TECHNOLOGIES:
ArcGIS Pro, QGIS, PostGIS, AutoCAD, MicroStation, Python, Google Earth Pro, LIDAR, Small Cell,
GPON, Active Ethernet, FTTH, FTTx, 5G, NESC, TIA/EIA, ROW, Splice, Fiber, Telecommunications

KEYWORDS FOR ATS:
OSP, outside plant, fiber optics, GIS, spatial analysis, FTTH, FTTx, GPON, 5G, small cell,
permitting, right-of-way, ROW, splice schematic, fiber optic network design, telecommunications,
broadband, ArcGIS, QGIS, PostGIS, Python automation, LIDAR, cost estimation, BOM`,
  "Full-time",
  "Senior",
  "$115,000 - $145,000",
  "https://example.com/jobs/nfn-senior-gis-osp-engineer",
  `Senior GIS/OSP Engineer at National Fiber Networks. OSP fiber design, GIS spatial analysis, FTTH/GPON/5G. ArcGIS, QGIS, PostGIS, Python.
Required: 5+ years OSP engineering, 3+ years GIS, fiber design, permitting, ROW, cost estimation. 
Preferred: GPON, active Ethernet, Python, PMP, LIDAR, AutoCAD, MicroStation.
Remote Eastern US. $115K-$145K.`,
]);
const jobId = job.rows[0].id;
console.log(`✓ Created job: ${job.rows[0].title} (${jobId})`);

// ── 3. Create application ──
const app = await c.query(`
  INSERT INTO applications (candidate_id, job_id, status, source_type, priority, created_at)
  VALUES ($1, $2, 'assigned', 'manual', 'high', NOW())
  RETURNING id
`, [candidateId, jobId]);
const appId = app.rows[0].id;
console.log(`✓ Created application: ${appId}`);

// ── 4. Create FULL base resume in application_resume_versions ──
const baseResumeContent = {
  title: "Jane Test Engineer",
  summary: "Senior OSP/GIS Engineer with 8+ years designing fiber optic networks and building enterprise geospatial systems. Expert in FTTH/FTTx route design, spatial data management, and Python automation. Led 200+ miles of fiber deployment and built a PostGIS data warehouse serving 500+ users. GISP certified with strong cross-functional leadership experience.",
  skills: [
    "ArcGIS Pro", "ArcGIS Server", "ArcPy", "QGIS", "PostGIS", "GeoPandas",
    "GDAL/OGR", "Leaflet", "OpenLayers", "MapBox", "GeoServer",
    "Python", "JavaScript", "SQL", "R", "Bash",
    "PostgreSQL", "SQLite", "Oracle Spatial",
    "AutoCAD", "MicroStation", "Google Earth Pro",
    "Terraform", "Docker", "Git", "CI/CD",
    "AWS S3", "AWS EC2", "AWS RDS", "Google Cloud",
    "Fiber route design", "FTTH", "FTTx", "GPON", "Active Ethernet",
    "Splice schematics", "Permitting", "ROW acquisition", "NESC standards",
    "LIDAR processing", "Cost estimation", "BOM preparation",
    "OSPF", "BGP", "MPLS", "VLAN", "TCP/IP",
  ],
  experience: [
    {
      title: "Senior GIS Engineer",
      company: "GeoData Corp",
      location: "Washington, DC",
      startDate: "2021-03",
      endDate: null,
      bullets: [
        "Architected and built an enterprise GIS platform serving 500+ internal users across 12 states, reducing data retrieval time by 70%",
        "Designed and implemented a 50TB PostGIS spatial data warehouse integrating fiber asset data, permitting records, and field survey results",
        "Led the migration from proprietary ArcGIS Server stack to an open-source Geoserver/PostGIS/Leaflet architecture, saving $200K/year in licensing",
        "Developed Python-based ETL pipelines processing 10,000+ spatial records daily with automated quality validation",
        "Implemented OGC-compliant WMS/WFS/WCS services enabling seamless data sharing across engineering, construction, and executive teams",
        "Optimized spatial queries and indexes reducing map rendering latency by 60%",
        "Managed and mentored a team of 4 GIS analysts, conducting code reviews and technical training",
        "Built real-time dashboards tracking fiber construction progress, permit status, and budget utilization",
        "Automated monthly reporting using Python and GIS batch processing, saving 40 engineer-hours per month",
      ],
    },
    {
      title: "OSP Engineer",
      company: "FiberTel Communications",
      location: "Baltimore, MD",
      startDate: "2018-06",
      endDate: "2021-02",
      bullets: [
        "Designed and optimized OSP fiber routes for 200+ miles of FTTH deployment across 6 mid-Atlantic counties",
        "Conducted field surveys using GIS-based mobile data collection, integrating real-time GPS with existing fiber maps",
        "Created detailed splice schematics, as-built documentation, and construction packages for 50+ fiber projects",
        "Coordinated with 12 municipal jurisdictions on permitting, right-of-way acquisition, and franchise agreements, achieving 95% first-pass approval rate",
        "Managed OSP contractor teams averaging 15 field crews, ensuring adherence to NESC standards and project timelines",
        "Reduced construction costs by 15% through optimized route planning and strategic material sourcing",
        "Prepared detailed engineering cost estimates and bills of materials for projects ranging from $500K to $8M",
        "Developed a GIS-based permitting tracking system reducing permit cycle time by 30%",
        "Performed quality assurance on as-built data, ensuring 99.5% accuracy of fiber asset records",
      ],
    },
    {
      title: "GIS Analyst",
      company: "City Planning Department",
      location: "Richmond, VA",
      startDate: "2015-09",
      endDate: "2018-05",
      bullets: [
        "Developed zoning analysis and land-use mapping tools using ArcPy, processing 50+ zoning code changes annually",
        "Maintained the city's parcel database for 180,000+ properties, ensuring data integrity and public access",
        "Produced demographic reports and spatial analysis for city council, influencing 3 major infrastructure funding decisions",
        "Created interactive web maps for public engagement portals, achieving 40,000+ unique page views during planning cycles",
        "Integrated 10+ city department datasets into a centralized GIS platform, eliminating data silos",
        "Conducted training sessions for 50+ city staff on GIS tools and spatial data best practices",
      ],
    },
  ],
  education: [
    {
      degree: "Master of Science in Geographic Information Systems",
      school: "University of Washington",
      field: "GIS & Spatial Analysis",
      graduationDate: "2015",
      gpa: "3.85",
      honors: "Graduate Research Fellowship",
    },
    {
      degree: "Bachelor of Science in Civil Engineering",
      school: "Virginia Tech",
      field: "Civil Engineering",
      graduationDate: "2013",
      gpa: "3.6",
      honors: "Dean's List",
    },
  ],
  certifications: [
    "GISP — GIS Certification Institute (2016)",
    "Fiber Optics Association (FOA) Certified Installer",
    "OSHA 30-Hour Construction Safety & Health",
    "FCC Tower Climber Safety & Rescue Certification",
    "Project Management Professional (PMP) — in progress (expected 2026 Q4)",
  ],
  projects: [
    {
      name: "Multi-State Fiber Asset Management System",
      description: "Designed and deployed a centralized PostGIS-based fiber asset management platform consolidating data from 6 operating regions, enabling real-time tracking of 10,000+ route miles of fiber infrastructure.",
      technologies: ["PostGIS", "Python", "Leaflet", "GeoServer", "AWS RDS"],
    },
    {
      name: "OSP Route Optimization Engine",
      description: "Built a Python-based route optimization tool integrating LIDAR elevation data, existing conduit maps, and permitting constraints to identify optimal fiber routes, reducing route design time by 40%.",
      technologies: ["Python", "GeoPandas", "LIDAR", "QGIS", "GDAL"],
    },
    {
      name: "Permitting Tracking Dashboard",
      description: "Developed a real-time GIS dashboard tracking permit applications across 12 jurisdictions, with automated status updates and bottleneck alerts, reducing permit cycle time by 30%.",
      technologies: ["ArcGIS Pro", "Python", "PostgreSQL", "WebSockets", "React"],
    },
  ],
  linkedin_url: "https://linkedin.com/in/jane-test-engineer",
  github_url: "https://github.com/jane-test-engineer",
  portfolio_url: null,
  location: "Washington, DC / Remote Eastern US",
  languages: ["English (native)", "Spanish (professional working)"],
};

// Create target_jobs entry first (FK constraint)
const tj = await c.query(`
  INSERT INTO target_jobs (candidate_id, job_id, raw_description, created_at)
  VALUES ($1, $2, 'Senior GIS/OSP Engineer at National Fiber Networks', NOW())
  RETURNING id
`, [candidateId, jobId]);
const targetJobId = tj.rows[0].id;
console.log(`✓ Created target_job: ${targetJobId}`);

const resume = await c.query(`
  INSERT INTO application_resume_versions (candidate_id, target_job_id, title, content, source_type, status, created_at)
  VALUES ($1, $2, 'Base Resume — Jane Test Engineer — OSP/GIS', $3, 'base_resume', 'draft', NOW())
  RETURNING id
`, [candidateId, targetJobId, JSON.stringify(baseResumeContent)]);
console.log(`✓ Created base resume: ${resume.rows[0].id}`);

// ── 5. Verify ──
const verify = await c.query(`
  SELECT a.id as app_id, c.name, j.title, rv.title as resume_title
  FROM applications a
  JOIN candidates c ON a.candidate_id = c.id
  JOIN jobs j ON a.job_id = j.id
  LEFT JOIN application_resume_versions rv ON rv.candidate_id = a.candidate_id AND rv.source_type = 'base'
  WHERE a.id = $1
`, [appId]);
const v = verify.rows[0];
console.log(`\n✔ ${v.name}`);
console.log(`  Job: ${v.j.title}`);
console.log(`  Resume: ${v.resume_title}`);
console.log(`  App ID: ${v.app_id}`);

await c.end();

console.log(`\nReady. Sign in and click "▶ AI Pipeline" at:`);
console.log(`https://skarion-talent-os.skarion-talentos.workers.dev/application-queue`);
