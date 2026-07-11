// Seed test data: fake candidate (OSP + GIS base resumes), fake job, application
// Then trigger the multi-agent workflow

import { Client } from "@neondatabase/serverless";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const c = new Client(DB_URL);
await c.connect();

// 1. Create test candidate
const cand = await c.query(`
  INSERT INTO candidates (name, email, phone, city, country, notes, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, NOW())
  RETURNING id, name
`, [
  "Jane Test Engineer",
  "jane.test@example.com",
  "+1-555-0100",
  "Washington",
  "US",
  'Test candidate: OSP + GIS engineer background'
]);
const candidateId = cand.rows[0].id;
console.log(`✓ Created candidate: ${cand.rows[0].name} (${candidateId})`);

// 2. Create a fake job
const job = await c.query(`
  INSERT INTO jobs (title, company, location, description_text, employment_type, seniority_level, salary_range, source_url, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
  RETURNING id, title
`, [
  "Senior GIS/OSP Engineer",
  "National Fiber Networks Inc.",
  "Remote — Eastern US",
  `Position: Senior GIS/OSP Engineer
	
National Fiber Networks is seeking a Senior GIS/OSP Engineer to lead our fiber infrastructure expansion across the mid-Atlantic region.

Required Qualifications:
• 5+ years of OSP engineering experience in telecommunications
• 3+ years of GIS analysis and spatial data management
• Proficiency with ArcGIS, QGIS, or similar GIS platforms
• Strong understanding of fiber optic network design principles
• Experience with permitting and right-of-way acquisition
• Familiarity with FTTH, FTTx, and small cell deployment
• Ability to read and interpret construction drawings and splice schematics

Preferred Qualifications:
• Experience with GPON and active Ethernet network architectures
• Python scripting for geospatial automation
• Knowledge of 5G small cell siting and densification
• Project management experience (PMP certification a plus)
• Experience with LIDAR data processing and analysis

Responsibilities:
• Design and optimize OSP fiber routes using GIS analysis
• Manage spatial database of fiber assets and infrastructure
• Coordinate with engineering, construction, and permitting teams
• Develop GIS tools and automation scripts for route planning
• Prepare engineering cost estimates and bills of materials
• Ensure compliance with industry standards (NESC, TIA/EIA)
• Support field engineering teams with GIS data and maps
• Present route designs and feasibility studies to stakeholders

Tools & Technologies:
ArcGIS Pro, QGIS, PostGIS, AutoCAD, GIS, Python, Google Earth, Small Cell, LIDAR

Keywords: OSP, outside plant, fiber optics, GIS, spatial analysis, FTTH, FTTx, 5G, small cell, permitting, ROW, splice, fiber, telecommunications`,
  "Full-time",
  "Senior",
  "$110,000 - $140,000",
  "https://example.com/jobs/nfn-senior-gis-osp",
]);
const jobId = job.rows[0].id;
console.log(`✓ Created job: ${job.rows[0].title} (${jobId})`);

// 3. Verify the existing key is active
const keyRes = await c.query(`SELECT id, label, is_enabled, provider FROM ai_api_keys LIMIT 1`);
if (keyRes.rows.length > 0) {
  console.log(`✓ Using AI key: ${keyRes.rows[0].label} (${keyRes.rows[0].provider}, enabled=${keyRes.rows[0].is_enabled})`);
}

// 4. Create an application linking them
const app = await c.query(`
  INSERT INTO applications (candidate_id, job_id, status, source_type, priority, created_at)
  VALUES ($1, $2, 'assigned', 'manual', 'high', NOW())
  RETURNING id
`, [candidateId, jobId]);
const appId = app.rows[0].id;
console.log(`✓ Created application: ${appId}`);

// 5. Create a base resume in application_resume_versions
const resumeContent = {
  summary: "GIS and OSP engineer with 8+ years of experience in fiber network design, spatial data management, and enterprise GIS platform development. Proven track record leading large-scale infrastructure projects from survey through as-built.",
  skills: ["Python", "R", "ArcGIS", "QGIS", "PostGIS", "GeoPandas", "GDAL", "Leaflet", "OpenLayers", "Django", "Flask", "SQL", "Docker", "Git", "CI/CD", "AWS", "Terraform", "AutoCAD", "MicroStation"],
  experience: [
    { title: "Senior GIS Engineer", company: "GeoData Corp", startDate: "2021-03", endDate: null, bullets: ["Built enterprise GIS platform serving 500+ users", "Designed PostGIS spatial data warehouse with 50TB capacity", "Led migration from ArcGIS Server to open-source stack", "Implemented OGC-compliant WMS/WFS/WCS services", "Reduced query latency 60% via spatial index optimization", "Developed Python automation pipelines for ETL processing", "Managed team of 4 GIS analysts"] },
    { title: "OSP Engineer", company: "FiberTel Communications", startDate: "2018-06", endDate: "2021-02", bullets: ["Designed OSP fiber routes for 200+ miles of FTTH deployment", "Conducted field surveys using GIS-based route planning", "Created splice schematics and as-built documentation", "Coordinated with permitting agencies across 12 jurisdictions", "Managed OSP contractor teams averaging 15 field crews", "Reduced construction costs 15% through optimized route planning", "Prepared detailed engineering cost estimates and BOMs"] },
    { title: "GIS Analyst", company: "City Planning Department", startDate: "2015-09", endDate: "2018-05", bullets: ["Developed zoning analysis tools using ArcPy", "Maintained parcel database for 180,000+ properties", "Produced demographic reports for city council", "Created web maps for public engagement portals"] },
  ],
  education: [
    { degree: "MS Geographic Information Systems", school: "University of Washington", graduationDate: "2015" },
    { degree: "BS Civil Engineering", school: "Virginia Tech", graduationDate: "2013" },
  ],
  certifications: ["GISP", "OSPFiber 101"],
};
const resume = await c.query(`
  INSERT INTO application_resume_versions (application_id, title, content, source_type, created_at)
  VALUES ($1, 'Base Resume - Jane Test Engineer', $2, 'base', NOW())
  RETURNING id
`, [appId, JSON.stringify(resumeContent)]);
console.log(`✓ Created resume version: ${resume.rows[0].id}`);

// 6. Verify everything
const verify = await c.query(`
  SELECT a.id as app_id, a.status, c.name as candidate, j.title as job
  FROM applications a
  JOIN candidates c ON a.candidate_id = c.id
  JOIN jobs j ON a.job_id = j.id
  WHERE a.id = $1
`, [appId]);
console.log(`\n=== TEST DATA READY ===`);
console.log(`Application: ${verify.rows[0].app_id}`);
console.log(`Candidate: ${verify.rows[0].candidate}`);
console.log(`Job: ${verify.rows[0].job}`);
console.log(`Status: ${verify.rows[0].status}`);
console.log(`\nTo trigger workflow via hosted API:`);
console.log(`  curl -X POST "https://talentos.workers.dev/api/applications/${appId}/ai-workflow"`);

await c.end();
