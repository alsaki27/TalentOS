// src/lib/jobAgentRoleLibrary.ts
// Pure data module — no AI, no DB.
// Role titles organized by group (A–L) for the Apify Job Agent.
//
// NOTE: Groups A–L are now fully populated. Groups A–C came from the handover
// reference (2026-07-08). Groups D–L were added per the full title specification.

export interface RoleGroup {
  id: string;
  label: string;
  resumeFamily: string;
  titles: string[];
}

const ROLE_GROUPS: RoleGroup[] = [
  {
    id: "A",
    label: "OSP / Fiber",
    resumeFamily: "osp_fiber",
    titles: [
      "OSP Design Engineer", "Outside Plant Engineer", "OSP Engineer",
      "Fiber Design Engineer", "FTTH Design Engineer", "Fiber Optic Design Engineer",
      "Telecom Design Engineer", "Splice Engineer", "Fiber Splicing Engineer",
      "OSP Planning Engineer", "OSP CAD Designer", "Fiber Network Engineer",
      "Fiber Construction Engineer", "Outside Plant Designer",
      "Telecommunications Engineer", "Fiber Route Engineer",
      "Aerial Fiber Design Engineer", "Underground Fiber Design Engineer",
      "Joint Use Engineer", "Make Ready Engineer", "Fiber Permitting Engineer",
      "GIS Fiber Design Technician", "OSP Project Engineer",
      "Fiber Design Technician", "OSP Field Engineer",
      "Fiber Construction Manager", "OSP Estimator",
      "Telecom Infrastructure Engineer", "Broadband Design Engineer",
      "FTTx Design Engineer", "Fiber Network Planner", "OSP QC Engineer",
      "Fiber Splice Technician", "Broadband Network Engineer", "Fiber Engineer",
    ],
  },
  {
    id: "B",
    label: "CAD / Drafting",
    resumeFamily: "autocad_drafting",
    titles: [
      "AutoCAD Drafter", "CAD Technician", "CAD Designer", "Drafter",
      "Drafter I", "Design Drafter", "Civil CAD Drafter",
      "Electrical CAD Drafter", "Mechanical CAD Drafter", "Structural Drafter",
      "CAD Operator", "Engineering Technician CAD", "Utility Drafter",
      "Land Surveying Drafter", "Piping Designer", "Site Design Technician",
      "BIM Technician", "Construction Drafter", "Telecom Drafter",
      "Drafting Technician",
    ],
  },
  {
    id: "C",
    label: "GIS / Geospatial",
    resumeFamily: "gis_geospatial",
    titles: [
      "GIS Analyst", "GIS Technician", "GIS Specialist", "GIS Coordinator",
      "GIS Developer", "GIS Mapping Technician", "Geospatial Analyst",
      "GIS Data Analyst", "GIS Analyst I", "GIS Technician I",
      "Utility GIS Analyst", "Telecom GIS Analyst", "GIS Field Technician",
      "Cartographer", "Remote Sensing Analyst", "GIS Database Technician",
      "GIS QA/QC Analyst", "Land Records GIS Analyst",
      "Environmental GIS Analyst", "GIS Support Specialist",
    ],
  },
  {
    id: "D",
    label: "Mechanical / Manufacturing / Product CAD",
    resumeFamily: "mechanical_cad",
    titles: [
      "Mechanical Drafter", "Mechanical Designer", "Mechanical CAD Technician",
      "Product Design Drafter", "Product Development Designer",
      "Manufacturing Drafter", "Tool Design Drafter", "Tooling Designer",
      "Fixture Designer", "Jig and Fixture Designer", "Sheet Metal Drafter",
      "Weldment Drafter", "SolidWorks Drafter", "SolidWorks Designer",
      "Inventor Drafter", "3D CAD Modeler",
    ],
  },
  {
    id: "E",
    label: "Electrical / Controls / PCB CAD",
    resumeFamily: "electrical_cad",
    titles: [
      "Electrical Drafter", "Electrical Designer", "Electrical Design Technician",
      "Controls Drafter", "Instrumentation Drafter",
      "Instrumentation Designer", "Wiring Harness Designer", "Harness Drafter",
      "Panel Designer", "Schematic Drafter", "Power Distribution Drafter",
      "PCB Designer", "PCB Layout Designer",
    ],
  },
  {
    id: "F",
    label: "Civil / Land Development CAD",
    resumeFamily: "civil_cad",
    titles: [
      "Civil Drafter", "Civil Designer", "Civil 3D Technician",
      "Land Development Drafter", "Site Civil Drafter", "Roadway Drafter",
      "Highway Drafter", "Transportation Drafter", "Stormwater Drafter",
      "Grading Drafter", "Subdivision Drafter", "Municipal Drafter",
    ],
  },
  {
    id: "G",
    label: "Structural / Steel / Rebar Detailing",
    resumeFamily: "structural_cad",
    titles: [
      "Structural Steel Detailer", "Steel Detailer",
      "Miscellaneous Steel Detailer", "Rebar Detailer", "Concrete Detailer",
      "Precast Detailer", "Structural Designer", "Structural CAD Technician",
      "Tekla Detailer", "SDS2 Detailer",
    ],
  },
  {
    id: "H",
    label: "Architectural / Building / Interiors",
    resumeFamily: "architectural_cad",
    titles: [
      "Architectural Drafter", "Architectural Designer",
      "Architectural CAD Technician", "Revit Drafter", "Revit Technician",
      "Revit Designer", "Building Designer", "Residential Drafter",
      "Millwork Drafter", "Casework Designer", "Kitchen and Bath Designer",
      "Space Planner",
    ],
  },
  {
    id: "I",
    label: "MEP / HVAC / Plumbing / Fire Protection",
    resumeFamily: "mep_cad",
    titles: [
      "MEP Drafter", "MEP Designer", "HVAC Drafter", "HVAC Designer",
      "Plumbing Drafter", "Plumbing Designer", "Fire Protection Drafter",
      "Fire Sprinkler Designer", "Fire Sprinkler Drafter", "Ductwork Drafter",
    ],
  },
  {
    id: "J",
    label: "Piping / Process / Industrial Plant",
    resumeFamily: "piping_industrial_cad",
    titles: [
      "Piping Drafter", "Process Piping Drafter", "Plant Design Drafter",
      "Plant Layout Designer", "P&ID Drafter", "Industrial Drafter",
    ],
  },
  {
    id: "K",
    label: "Utility / Energy / Renewables",
    resumeFamily: "utility_energy",
    titles: [
      "Utility Designer", "Utility CAD Designer", "Substation Drafter",
      "Transmission Drafter", "Distribution Designer", "Solar Designer",
      "Solar Drafter", "Solar PV Designer", "Renewable Energy Drafter",
    ],
  },
  {
    id: "L",
    label: "Cross-industry Entry-level",
    resumeFamily: "cross_industry_entry",
    titles: [
      "Junior Drafter", "Associate Designer", "Design Technician",
      "Detailing Technician", "Layout Designer", "Drafting Intern",
      "CAD Intern",
    ],
  },
];

const GROUP_BY_ID = new Map(ROLE_GROUPS.map((g) => [g.id, g]));
const GROUP_BY_TITLE = new Map<string, RoleGroup>();
for (const group of ROLE_GROUPS) {
  for (const title of group.titles) {
    GROUP_BY_TITLE.set(title.trim().toLowerCase(), group);
  }
}

export function getAllGroups(): RoleGroup[] {
  return ROLE_GROUPS.map((g) => ({ ...g }));
}

export function getGroupById(groupId: string): RoleGroup | undefined {
  const g = GROUP_BY_ID.get(groupId.toUpperCase());
  return g ? { ...g } : undefined;
}

export function getGroupForSearchQuery(query: string): RoleGroup | undefined {
  return GROUP_BY_TITLE.get(query.trim().toLowerCase());
}

export function getTitlesForGroups(groupIds: string[]): string[] {
  const ids = new Set(groupIds.map((id) => id.toUpperCase()));
  const titles: string[] = [];
  for (const group of ROLE_GROUPS) {
    if (ids.has(group.id)) titles.push(...group.titles);
  }
  return titles;
}

export function getGroupLabel(groupId: string): string {
  return getGroupById(groupId)?.label ?? groupId;
}

export function getResumeFamilyForGroup(groupId: string): string {
  return getGroupById(groupId)?.resumeFamily ?? "general";
}

export function getGroupIds(): string[] {
  return ROLE_GROUPS.map((g) => g.id);
}

export function getTotalTitleCount(): number {
  return ROLE_GROUPS.reduce((sum, g) => sum + g.titles.length, 0);
}

export function validateRoleGroups(groups: string[]): string[] {
  const valid = getGroupIds();
  return groups.map((g) => g.toUpperCase()).filter((g) => valid.includes(g));
}

// ── Combined groups for daily cron (3 mega-groups, each from 4 sub-groups) ──

export interface CombinedGroup {
  id: string;
  label: string;
  subGroupIds: string[];
  titles: string[];
  totalTitles: number;
}

const COMBINED_GROUPS: { id: string; label: string; subGroupIds: string[] }[] = [
  { id: "CA", label: "OSP & Infrastructure",      subGroupIds: ["A", "G", "J", "K"] },
  { id: "CB", label: "All CAD Disciplines",        subGroupIds: ["B", "D", "E", "F"] },
  { id: "CC", label: "GIS & Building Design",      subGroupIds: ["C", "H", "I", "L"] },
];

export function getCombinedGroups(): CombinedGroup[] {
  return COMBINED_GROUPS.map((cg) => {
    const titles = getTitlesForGroups(cg.subGroupIds);
    return { ...cg, titles, totalTitles: titles.length };
  });
}

export function getAllTitlesFromCombinedGroups(): string[] {
  const all = new Set<string>();
  for (const cg of COMBINED_GROUPS) {
    for (const title of getTitlesForGroups(cg.subGroupIds)) {
      all.add(title);
    }
  }
  return Array.from(all);
}