// Fix: populate base resume content + update pipeline button to include credentials
// 1. Update the base_resumes content
import { Client } from "@neondatabase/serverless";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const c = new Client(DB_URL);
await c.connect();

const fullContent = {
  title: "Base Resume — Jane Test Engineer — OSP/GIS",
  summary: "Senior OSP/GIS Engineer with 8+ years designing fiber optic networks and building enterprise geospatial systems. Expert in FTTH/FTTx route design, spatial data management, and Python automation. Led 200+ miles of fiber deployment and built a PostGIS data warehouse serving 500+ users. GISP certified with strong cross-functional leadership experience.",
  skills: ["ArcGIS Pro", "ArcGIS Server", "ArcPy", "QGIS", "PostGIS", "GeoPandas", "GDAL/OGR", "Leaflet", "OpenLayers", "MapBox", "GeoServer", "Python", "JavaScript", "SQL", "R", "Bash", "PostgreSQL", "SQLite", "Oracle Spatial", "AutoCAD", "MicroStation", "Google Earth Pro", "Terraform", "Docker", "Git", "CI/CD", "AWS S3", "AWS EC2", "AWS RDS", "Google Cloud", "Fiber route design", "FTTH", "FTTx", "GPON", "Active Ethernet", "Splice schematics", "Permitting", "ROW acquisition", "NESC standards", "LIDAR processing", "Cost estimation", "BOM preparation"],
  experience: [
    { title: "Senior GIS Engineer", company: "GeoData Corp", location: "Washington, DC", startDate: "2021-03", endDate: null, bullets: ["Architected and built an enterprise GIS platform serving 500+ internal users across 12 states, reducing data retrieval time by 70%", "Designed and implemented a 50TB PostGIS spatial data warehouse integrating fiber asset data, permitting records, and field survey results", "Led the migration from proprietary ArcGIS Server stack to an open-source Geoserver/PostGIS/Leaflet architecture, saving $200K/year in licensing", "Developed Python-based ETL pipelines processing 10,000+ spatial records daily with automated quality validation", "Implemented OGC-compliant WMS/WFS/WCS services enabling seamless data sharing across engineering, construction, and executive teams", "Optimized spatial queries and indexes reducing map rendering latency by 60%", "Managed and mentored a team of 4 GIS analysts, conducting code reviews and technical training", "Built real-time dashboards tracking fiber construction progress, permit status, and budget utilization"] },
    { title: "OSP Engineer", company: "FiberTel Communications", location: "Baltimore, MD", startDate: "2018-06", endDate: "2021-02", bullets: ["Designed and optimized OSP fiber routes for 200+ miles of FTTH deployment across 6 mid-Atlantic counties", "Conducted field surveys using GIS-based mobile data collection, integrating real-time GPS with existing fiber maps", "Created detailed splice schematics, as-built documentation, and construction packages for 50+ fiber projects", "Coordinated with 12 municipal jurisdictions on permitting, right-of-way acquisition, and franchise agreements, achieving 95% first-pass approval rate", "Managed OSP contractor teams averaging 15 field crews, ensuring adherence to NESC standards and project timelines", "Reduced construction costs by 15% through optimized route planning and strategic material sourcing", "Prepared detailed engineering cost estimates and bills of materials for projects ranging from $500K to $8M", "Developed a GIS-based permitting tracking system reducing permit cycle time by 30%"] },
    { title: "GIS Analyst", company: "City Planning Department", location: "Richmond, VA", startDate: "2015-09", endDate: "2018-05", bullets: ["Developed zoning analysis and land-use mapping tools using ArcPy, processing 50+ zoning code changes annually", "Maintained the city's parcel database for 180,000+ properties, ensuring data integrity and public access", "Produced demographic reports and spatial analysis for city council, influencing 3 major infrastructure funding decisions", "Created interactive web maps for public engagement portals, achieving 40,000+ unique page views during planning cycles"] },
  ],
  education: [
    { degree: "M.S. Geographic Information Systems", school: "University of Washington", field: "GIS & Spatial Analysis", graduationDate: "2015" },
    { degree: "B.S. Civil Engineering", school: "Virginia Tech", field: "Civil Engineering", graduationDate: "2013" },
  ],
  certifications: ["GISP — GIS Certification Institute (2016)", "Fiber Optics Association (FOA) Certified Installer", "OSHA 30-Hour Construction Safety & Health", "FCC Tower Climber Safety & Rescue"],
  projects: [
    { name: "Multi-State Fiber Asset Management System", description: "Designed and deployed a centralized PostGIS-based fiber asset management platform consolidating data from 6 operating regions, enabling real-time tracking of 10,000+ route miles of fiber infrastructure.", technologies: ["PostGIS", "Python", "Leaflet", "GeoServer", "AWS RDS"] },
    { name: "OSP Route Optimization Engine", description: "Built a Python-based route optimization tool integrating LIDAR elevation data, existing conduit maps, and permitting constraints to identify optimal fiber routes, reducing route design time by 40%.", technologies: ["Python", "GeoPandas", "LIDAR", "QGIS", "GDAL"] },
  ],
  linkedin_url: "https://linkedin.com/in/jane-test-engineer",
  github_url: "https://github.com/jane-test-engineer",
  languages: ["English (native)", "Spanish (professional working)"],
};

// Find the test candidate's base resume
const cand = await c.query("SELECT id FROM candidates WHERE name LIKE 'Jane Test%' ORDER BY created_at DESC LIMIT 1");
if (cand.rows.length === 0) { console.error("No test candidate found"); process.exit(1); }
const cid = cand.rows[0].id;

// Update the base_resumes content
await c.query(
  `UPDATE base_resumes SET content = $1, target_industry = $2, target_roles = $3, updated_at = NOW() WHERE candidate_id = $4 AND content IS NULL AND name = 'Base Resume'`,
  [JSON.stringify(fullContent), "Telecommunications", ["Senior GIS/OSP Engineer", "GIS Engineer", "OSP Engineer"], cid]
);

// Verify
const br = await c.query("SELECT id, name, updated_at FROM base_resumes WHERE candidate_id = $1 AND name = 'Base Resume'", [cid]);
console.log(`Base resume updated: ${br.rows[0]?.id} at ${br.rows[0]?.updated_at}`);

await c.end();
console.log("\nDone. Now fixing the queue page button to include credentials...");
