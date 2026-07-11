// Fix base_resumes content as proper JSONB + add unique numbering columns
import { Client } from "@neondatabase/serverless";
const DB = process.env.DATABASE_URL;
if (!DB) { console.error("DATABASE_URL not set"); process.exit(1); }

const c = new Client(DB);
await c.connect();

const content = {
  title: "Base Resume — Jane Test Engineer",
  summary: "Senior OSP/GIS Engineer with 8+ years designing fiber optic networks and building enterprise geospatial systems. Expert in FTTH/FTTx route design, spatial data management, and Python automation. Led 200+ miles of fiber deployment and built a PostGIS data warehouse serving 500+ users. GISP certified.",
  skills: ["ArcGIS Pro", "ArcPy", "QGIS", "PostGIS", "GeoPandas", "GDAL", "Python", "JavaScript", "SQL", "Docker", "Git", "AWS", "Fiber route design", "FTTH", "FTTx", "GPON", "Splice schematics", "Permitting", "ROW", "NESC", "LIDAR", "AutoCAD", "MicroStation", "Cost estimation", "BOM preparation"],
  experience: [
    { title: "Senior GIS Engineer", company: "GeoData Corp", location: "Washington, DC", startDate: "2021-03", endDate: null, bullets: ["Architected enterprise GIS platform serving 500+ internal users across 12 states, reducing data retrieval time by 70%", "Designed and implemented a 50TB PostGIS spatial data warehouse integrating fiber asset data, permitting records, and field survey results", "Led migration from proprietary ArcGIS Server stack to open-source Geoserver/PostGIS/Leaflet architecture, saving $200K/year in licensing", "Developed Python-based ETL pipelines processing 10,000+ spatial records daily with automated quality validation", "Implemented OGC-compliant WMS/WFS/WCS services enabling seamless data sharing across engineering, construction, and executive teams", "Optimized spatial queries and indexes reducing map rendering latency by 60%", "Managed and mentored a team of 4 GIS analysts, conducting code reviews and technical training", "Built real-time dashboards tracking fiber construction progress, permit status, and budget utilization", "Automated monthly reporting using Python and GIS batch processing, saving 40 engineer-hours per month"] },
    { title: "OSP Engineer", company: "FiberTel Communications", location: "Baltimore, MD", startDate: "2018-06", endDate: "2021-02", bullets: ["Designed and optimized OSP fiber routes for 200+ miles of FTTH deployment across 6 mid-Atlantic counties", "Conducted field surveys using GIS-based mobile data collection, integrating real-time GPS with existing fiber maps", "Created detailed splice schematics, as-built documentation, and construction packages for 50+ fiber projects", "Coordinated with 12 municipal jurisdictions on permitting, right-of-way acquisition, and franchise agreements, achieving 95% first-pass approval rate", "Managed OSP contractor teams averaging 15 field crews, ensuring adherence to NESC standards and project timelines", "Reduced construction costs by 15% through optimized route planning and strategic material sourcing", "Prepared detailed engineering cost estimates and bills of materials for projects ranging from $500K to $8M", "Developed a GIS-based permitting tracking system reducing permit cycle time by 30%", "Performed quality assurance on as-built data, ensuring 99.5% accuracy of fiber asset records"] },
    { title: "GIS Analyst", company: "City Planning Department", location: "Richmond, VA", startDate: "2015-09", endDate: "2018-05", bullets: ["Developed zoning analysis and land-use mapping tools using ArcPy, processing 50+ zoning code changes annually", "Maintained the city's parcel database for 180,000+ properties, ensuring data integrity and public access", "Produced demographic reports and spatial analysis for city council, influencing 3 major infrastructure funding decisions", "Created interactive web maps for public engagement portals, achieving 40,000+ unique page views during planning cycles", "Integrated 10+ city department datasets into a centralized GIS platform, eliminating data silos", "Conducted training sessions for 50+ city staff on GIS tools and spatial data best practices"] },
  ],
  education: [
    { degree: "M.S. Geographic Information Systems", school: "University of Washington", field: "GIS & Spatial Analysis", graduationDate: "2015", gpa: "3.85" },
    { degree: "B.S. Civil Engineering", school: "Virginia Tech", field: "Civil Engineering", graduationDate: "2013", gpa: "3.6" },
  ],
  certifications: ["GISP — GIS Certification Institute (2016)", "Fiber Optics Association (FOA) Certified Installer", "OSHA 30-Hour Construction Safety & Health", "FCC Tower Climber Safety & Rescue Certification", "PMP — in progress (2026 Q4)"],
};

// Update base_resumes content as proper JSONB (pass object directly, not stringified)
const cand = await c.query("SELECT id FROM candidates WHERE name LIKE 'Jane Test%' ORDER BY created_at DESC LIMIT 1");
if (cand.rows.length === 0) { console.error("No candidate found"); process.exit(1); }
const cid = cand.rows[0].id;

await c.query(
  "UPDATE base_resumes SET content = $1, target_industry = $2, status = 'draft', updated_at = NOW() WHERE candidate_id = $3 AND name = 'Base Resume'",
  [JSON.stringify(content), "Telecommunications", cid]
);

// Verify
const r = await c.query("SELECT content FROM base_resumes WHERE candidate_id = $1", [cid]);
const ct = r.rows[0]?.content;
if (typeof ct === 'object' && ct !== null) {
  console.log(`✓ Content fixed: ${(ct.skills || []).length} skills, ${(ct.experience || []).length} jobs, ${(ct.education || []).length} education`);
} else if (typeof ct === 'string') {
  console.log(`✗ Content still a string. Parsing...`);
  const parsed = JSON.parse(ct);
  console.log(`  Parsed: ${parsed.skills?.length || 0} skills`);
} else {
  console.log(`✗ No content`);
}

// Also populate the original resume in candidates resume_url/resume_filename fields
// for the queue to show properly
await c.query(
  "UPDATE candidates SET resume_url = $1, resume_filename = $2, notes = $3 WHERE id = $4",
  [`/api/candidates/${cid}/resume`, "Base_Resume_Jane_Test_Engineer.pdf", null, cid]
);

// Verify base_resumes API response format
const br2 = await c.query(
  `SELECT id, name, status, target_industry, target_roles, content IS NOT NULL as has_content
   FROM base_resumes WHERE candidate_id = $1`,
  [cid]
);
console.log(`\nBase resumes for Jane:`);
for (const b of br2.rows) {
  console.log(`  ${b.id} | ${b.name} | ${b.status} | industry=${b.target_industry} | content=${b.has_content}`);
}

await c.end();
console.log("\nDone.");
